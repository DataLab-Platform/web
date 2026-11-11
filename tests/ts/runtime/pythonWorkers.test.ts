/**
 * Life cycle of the Python workers of the Macros and Notebooks panels:
 * shared by successive mounts of a panel, terminated when a new generation
 * is requested (workspace replaced) or when the kernel restarts, and
 * restarted once with a fresh worker when they fail to start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeWorker } from "./fakeWorker";
import {
  panelNotebookRuntime,
  NotebookRuntime,
} from "../../../src/notebook/NotebookRuntime";
import {
  MacroRuntime,
  panelMacroRuntime,
} from "../../../src/runtime/MacroRuntime";
import { GenerationPool } from "../../../src/runtime/workerPool";
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

describe("GenerationPool", () => {
  it("shares an instance per generation and disposes the previous one", () => {
    const created: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
    const pool = new GenerationPool<object, { dispose: () => void }>(() => {
      const item = { dispose: vi.fn() };
      created.push(item);
      return item;
    });
    const key = {};
    const first = pool.acquire(key, 0);
    expect(pool.acquire(key, 0)).toBe(first);
    const second = pool.acquire(key, 1);
    expect(second).not.toBe(first);
    expect(created[0].dispose).toHaveBeenCalledTimes(1);
    expect(created[1].dispose).not.toHaveBeenCalled();
    // Another key has its own instance.
    expect(pool.acquire({}, 1)).not.toBe(second);
  });

  it("keeps an instance in which no code ran for the next generation", () => {
    let pristine = true;
    const item = { dispose: vi.fn(), isPristine: () => pristine };
    const pool = new GenerationPool<object, typeof item>(() => item);
    const key = {};
    pool.acquire(key, 0);
    expect(pool.acquire(key, 1)).toBe(item);
    expect(item.dispose).not.toHaveBeenCalled();
    pristine = false;
    pool.acquire(key, 2);
    expect(item.dispose).toHaveBeenCalledTimes(1);
  });
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

  it("restarts an idle kernel with a fresh worker", async () => {
    const kernel = new NotebookRuntime(runtime);
    const preload = kernel.preload();
    const first = last();
    first.emit({ type: "ready" });
    await preload;
    expect(kernel.getStatus()).toBe("idle");

    const restart = kernel.restart();
    expect(first.terminated).toBe(true);
    const second = last();
    expect(second).not.toBe(first);
    second.emit({ type: "ready" });
    await restart;
    expect(FakeWorker.alive()).toEqual([second]);
  });

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

  it("keeps the panel kernel across remounts until a new generation", async () => {
    const workspace = {} as RuntimeApi;
    const first = panelNotebookRuntime(workspace, 0);
    const preload = first.preload();
    last().emit({ type: "ready" });
    await preload;
    // The panel mounted afresh (workspace reset): same kernel.
    expect(panelNotebookRuntime(workspace, 0)).toBe(first);
    expect(FakeWorker.alive()).toHaveLength(1);
    // No cell ran yet: another workspace keeps this fresh kernel.
    expect(first.isPristine()).toBe(true);
    expect(panelNotebookRuntime(workspace, 1)).toBe(first);
    // A cell runs, then another workspace is opened: the kernel is
    // terminated and replaced.
    void first.executeCell("c1", "x = 1", {});
    await flush();
    expect(first.isPristine()).toBe(false);
    const second = panelNotebookRuntime(workspace, 2);
    expect(second).not.toBe(first);
    expect(FakeWorker.alive()).toEqual([]);
    void second.preload();
    expect(FakeWorker.alive()).toHaveLength(1);
  });

  it("is pristine again after a restart", async () => {
    const kernel = new NotebookRuntime(runtime);
    const preload = kernel.preload();
    last().emit({ type: "ready" });
    await preload;
    void kernel.executeCell("c1", "x = 1", {});
    await flush();
    last().emit({ type: "cell_finished", ok: true, execCount: 1 });
    expect(kernel.isPristine()).toBe(false);
    const restart = kernel.restart();
    last().emit({ type: "ready" });
    await restart;
    expect(kernel.isPristine()).toBe(true);
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

  it("terminates the workers of the previous generation once a macro ran", async () => {
    const workspace = {} as RuntimeApi;
    const first = panelMacroRuntime(workspace, 0);
    const preload = first.preload();
    last().emit({ type: "ready" });
    await preload;
    expect(panelMacroRuntime(workspace, 0)).toBe(first);
    expect(FakeWorker.alive()).toHaveLength(2);
    // No macro ran yet: kept for another workspace.
    expect(panelMacroRuntime(workspace, 1)).toBe(first);
    await first.run("x = 1", "m", {});
    FakeWorker.instances[0].emit({ type: "finished", ok: true });
    expect(first.isPristine()).toBe(false);
    expect(panelMacroRuntime(workspace, 2)).not.toBe(first);
    expect(FakeWorker.alive()).toEqual([]);
  });
});
