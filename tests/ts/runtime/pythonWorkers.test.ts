/**
 * Start-up of the Python workers of the Macros and Notebooks panels: a
 * worker that fails or stalls while starting is replaced by a fresh one,
 * and every worker (live, starting or spare) is terminated when disposed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorker } from "./fakeWorker";
import { NotebookRuntime } from "../../../src/notebook/NotebookRuntime";
import { MacroRuntime } from "../../../src/runtime/MacroRuntime";
import {
  startWorker,
  waitForWorkerReady,
  WORKER_READY_TIMEOUT_MS,
  WORKER_RETRY_DELAY_MS,
  WORKER_START_ATTEMPTS,
  WorkerStartCancelled,
} from "../../../src/runtime/workerReady";
import type { RuntimeApi } from "../../../src/runtime/runtime";

/** Let pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function last(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1];
}

beforeEach(() => {
  FakeWorker.reset();
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("waitForWorkerReady", () => {
  it("resolves on ready and rejects on init_error", async () => {
    const ok = new FakeWorker("w");
    const ready = waitForWorkerReady(ok as unknown as Worker);
    ok.emit({ type: "ready" });
    await expect(ready).resolves.toBeUndefined();

    const bad = new FakeWorker("w");
    const failed = waitForWorkerReady(bad as unknown as Worker, {
      label: "kernel",
    });
    bad.emit({ type: "init_error", error: "ERR_CACHE_WRITE_FAILURE" });
    await expect(failed).rejects.toThrow(
      "kernel failed to start: ERR_CACHE_WRITE_FAILURE",
    );
  });

  it("times out when the worker never gets ready", async () => {
    vi.useFakeTimers();
    const stuck = new FakeWorker("w");
    const ready = waitForWorkerReady(stuck as unknown as Worker, {
      timeoutMs: 1000,
      label: "kernel",
    });
    const assertion = expect(ready).rejects.toThrow("kernel not ready");
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("is cancelled by its signal", async () => {
    const abort = new AbortController();
    const ready = waitForWorkerReady(new FakeWorker("w") as unknown as Worker, {
      signal: abort.signal,
    });
    abort.abort();
    await expect(ready).rejects.toBeInstanceOf(WorkerStartCancelled);
  });

  it("does not need window (the kernel worker starts macro workers)", async () => {
    const worker = new FakeWorker("w");
    vi.stubGlobal("window", undefined);
    const ready = waitForWorkerReady(worker as unknown as Worker, {
      timeoutMs: 1000,
    });
    worker.emit({ type: "ready" });
    await expect(ready).resolves.toBeUndefined();
  });
});

describe("startWorker", () => {
  it("retries once with a fresh worker after a failed start", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const spawned: FakeWorker[] = [];
    const started = startWorker({
      spawn: () => new FakeWorker("w") as unknown as Worker,
      onSpawn: (worker) => spawned.push(worker as unknown as FakeWorker),
      signal: new AbortController().signal,
      label: "kernel",
    });
    spawned[0].emit({ type: "init_error", error: "boom" });
    await flush();
    expect(spawned[0].terminated).toBe(true);
    await vi.advanceTimersByTimeAsync(WORKER_RETRY_DELAY_MS);
    expect(spawned).toHaveLength(2);
    spawned[1].emit({ type: "ready" });
    await expect(started).resolves.toBe(spawned[1]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("gives up after the last retry, terminating the stuck workers", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spawned: FakeWorker[] = [];
    const started = startWorker({
      spawn: () => new FakeWorker("w") as unknown as Worker,
      onSpawn: (worker) => spawned.push(worker as unknown as FakeWorker),
      signal: new AbortController().signal,
      label: "kernel",
    });
    const assertion = expect(started).rejects.toThrow("kernel not ready");
    await vi.advanceTimersByTimeAsync(
      WORKER_START_ATTEMPTS * WORKER_READY_TIMEOUT_MS +
        3 * WORKER_RETRY_DELAY_MS,
    );
    await assertion;
    expect(spawned).toHaveLength(WORKER_START_ATTEMPTS);
    expect(spawned.every((worker) => worker.terminated)).toBe(true);
  });
});

describe("NotebookRuntime", () => {
  const runtime = {} as RuntimeApi;

  it("shares one start between concurrent callers", async () => {
    const kernel = new NotebookRuntime(runtime);
    const a = kernel.preload();
    const b = kernel.preload();
    expect(FakeWorker.instances).toHaveLength(1);
    last().emit({ type: "ready" });
    await Promise.all([a, b]);
  });

  it("terminates a kernel still starting when disposed", async () => {
    const kernel = new NotebookRuntime(runtime);
    const preload = kernel.preload();
    kernel.dispose();
    // A cancelled start is not an error.
    await expect(preload).resolves.toBeUndefined();
    expect(FakeWorker.alive()).toEqual([]);
  });
});

describe("MacroRuntime", () => {
  const runtime = {} as RuntimeApi;

  it("starts a spare worker once ready and terminates both on dispose", async () => {
    const macro = new MacroRuntime(runtime);
    const preload = macro.preload();
    last().emit({ type: "ready" });
    await preload;
    expect(FakeWorker.alive()).toHaveLength(2);
    macro.dispose();
    expect(FakeWorker.alive()).toEqual([]);
  });

  it("promotes the ready spare worker when a macro is stopped", async () => {
    const macro = new MacroRuntime(runtime);
    const preload = macro.preload();
    const live = last();
    live.emit({ type: "ready" });
    await preload;
    const spare = last();
    spare.emit({ type: "ready" });
    await flush();
    await macro.run("x = 1", "m", {});
    macro.stop();
    expect(live.terminated).toBe(true);
    // The spare is now live and a new spare starts: no stopped worker
    // left running.
    expect(FakeWorker.alive()).toEqual([spare, last()]);
    expect(FakeWorker.instances).toHaveLength(3);
  });
});
