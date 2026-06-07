/**
 * Unit tests for {@link WorkerRuntimeProxy} — the main-thread client that
 * implements ``RuntimeApi`` by forwarding to the kernel worker.
 *
 * These tests drive the proxy through a **fake worker**: a tiny in-memory
 * transport that records outgoing messages and lets the test push events
 * back, so the whole protocol (method forwarding, error propagation,
 * mutation fan-out, dialog bridge, synchronous mirror, ready handshake) is
 * validated deterministically without booting Pyodide.
 */
import { describe, expect, it, vi } from "vitest";

import {
  WorkerRuntimeProxy,
  type WorkerLike,
} from "../../../src/runtime/WorkerRuntimeProxy";
import type {
  KernelEvent,
  KernelRequest,
  KernelMirror,
} from "../../../src/runtime/workerProtocol";

/** A controllable in-memory stand-in for a ``Worker``. */
class FakeWorker implements WorkerLike {
  readonly sent: KernelRequest[] = [];
  readonly transfers: (Transferable[] | undefined)[] = [];
  terminated = false;
  private listener: ((ev: { data: unknown }) => void) | null = null;
  private errorListener:
    | ((ev: { message?: string; filename?: string }) => void)
    | null = null;

  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.sent.push(message as KernelRequest);
    this.transfers.push(transfer);
  }

  addEventListener(
    type: "message" | "error",
    listener: (ev: { data: unknown }) => void,
  ): void {
    if (type === "message") this.listener = listener;
    else this.errorListener = listener as (ev: { message?: string }) => void;
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate the worker pushing an event to the main thread. */
  emit(event: KernelEvent): void {
    this.listener?.({ data: event });
  }

  /** Simulate an uncaught worker ``error`` event (e.g. module load crash). */
  emitError(message: string): void {
    this.errorListener?.({ message });
  }

  /** The last request the proxy posted. */
  last(): KernelRequest {
    return this.sent[this.sent.length - 1];
  }
}

const MIRROR: KernelMirror = {
  storageMode: "disk",
  diskStoreBytes: 4096,
  spilledCount: 3,
  memoryUsage: {
    wasmBytes: 123,
    dataBytes: 45,
    jsUsedBytes: null,
    jsLimitBytes: null,
  },
};

function setup() {
  const worker = new FakeWorker();
  const proxy = new WorkerRuntimeProxy(worker);
  return { worker, proxy, runtime: proxy.asRuntime() };
}

describe("WorkerRuntimeProxy", () => {
  it("is not thenable, so awaiting the façade does not forward `then`", async () => {
    const { worker, runtime } = setup();
    // Regression guard: if the Proxy exposed a ``then`` function it would
    // look like a thenable, and ``await createWorkerRuntime()`` would call
    // ``runtime.then(resolve, reject)`` — forwarding two functions across
    // ``postMessage`` and throwing ``DataCloneError``. The façade must
    // report no ``then``.
    expect((runtime as unknown as { then?: unknown }).then).toBeUndefined();
    const same = await Promise.resolve(runtime);
    expect(same).toBe(runtime);
    // No ``then`` (or any) call must have crossed the bridge.
    expect(worker.sent.some((m) => m.type === "call")).toBe(false);
  });

  it("surfaces a worker error event as a boot-failure rejection", async () => {
    const worker = new FakeWorker();
    const proxy = new WorkerRuntimeProxy(worker);
    const ready = proxy.init("C", { group: "G", untitled: "U" });
    worker.emitError("Unexpected token (kernelWorker.ts:1)");
    await expect(ready).rejects.toThrow(/Unexpected token/);
  });

  it("resolves init only after the worker reports ready", async () => {
    const worker = new FakeWorker();
    const proxy = new WorkerRuntimeProxy(worker);
    let resolved = false;
    const ready = proxy
      .init("C", { group: "Group", untitled: "Untitled" })
      .then(() => {
        resolved = true;
      });
    expect(worker.last()).toEqual({
      type: "init",
      lang: "C",
      labels: { group: "Group", untitled: "Untitled" },
    });
    expect(resolved).toBe(false);
    worker.emit({ type: "ready", mirror: MIRROR });
    await ready;
    expect(resolved).toBe(true);
  });

  it("rejects init on a boot error", async () => {
    const worker = new FakeWorker();
    const proxy = new WorkerRuntimeProxy(worker);
    const ready = proxy.init("C", { group: "G", untitled: "U" });
    worker.emit({ type: "boot-error", error: "micropip failed" });
    await expect(ready).rejects.toThrow("micropip failed");
  });

  it("forwards a method call and resolves with the worker's value", async () => {
    const { worker, runtime } = setup();
    const promise = (runtime.listSignals as () => Promise<unknown>)();
    const req = worker.last();
    expect(req).toMatchObject({
      type: "call",
      method: "listSignals",
      args: [],
    });
    const id = (req as { id: number }).id;
    worker.emit({ type: "result", id, ok: true, value: [{ id: "s1" }] });
    await expect(promise).resolves.toEqual([{ id: "s1" }]);
  });

  it("passes arguments through to the worker", async () => {
    const { worker, runtime } = setup();
    void (runtime.renameObject as (a: string, b: string) => Promise<void>)(
      "oid-1",
      "New name",
    );
    expect(worker.last()).toMatchObject({
      type: "call",
      method: "renameObject",
      args: ["oid-1", "New name"],
    });
  });

  it("transfers ArrayBuffers in the arguments instead of cloning them", () => {
    const { worker, runtime } = setup();
    const data = new Float64Array([1, 2, 3, 4]);
    void (
      runtime.addImageFromArray as (p: {
        title: string;
        data: Float64Array;
        width: number;
        height: number;
        dtype: string;
      }) => Promise<string>
    )({ title: "t", data, width: 2, height: 2, dtype: "float64" });
    // The call's transfer list must carry the array's underlying buffer so
    // postMessage moves it zero-copy rather than structured-cloning it.
    const transfer = worker.transfers[worker.transfers.length - 1];
    expect(transfer).toContain(data.buffer);
  });

  it("passes no transferables for argument-free calls", () => {
    const { worker, runtime } = setup();
    void (runtime.listSignals as () => Promise<unknown>)();
    const transfer = worker.transfers[worker.transfers.length - 1];
    expect(transfer).toEqual([]);
  });

  it("rejects the call promise when the worker reports an error", async () => {
    const { worker, runtime } = setup();
    const promise = (runtime.getObject as (id: string) => Promise<unknown>)(
      "missing",
    );
    const id = (worker.last() as { id: number }).id;
    worker.emit({ type: "result", id, ok: false, error: "no such object" });
    await expect(promise).rejects.toThrow("no such object");
  });

  it("reflects a mirror pushed before the result when the call resolves", async () => {
    // The kernel worker posts the refreshed mirror *before* the result, so
    // a synchronous accessor read right after ``await`` sees the new value
    // rather than lagging one round-trip. Emulate that ordering.
    const { worker, runtime } = setup();
    const promise = (runtime.deleteAllObjects as (k: string) => Promise<void>)(
      "image",
    );
    const id = (worker.last() as { id: number }).id;
    worker.emit({ type: "mirror", mirror: { ...MIRROR, spilledCount: 6 } });
    worker.emit({ type: "result", id, ok: true, value: undefined });
    await promise;
    expect(runtime.getSpilledCount()).toBe(6);
  });

  it("fans workspace mutations out to subscribers and supports unsubscribe", () => {
    const { worker, runtime } = setup();
    const listener = vi.fn();
    const unsubscribe = runtime.onWorkspaceMutation(listener);
    worker.emit({ type: "mutation", name: "apply_feature" });
    expect(listener).toHaveBeenCalledWith("apply_feature");
    unsubscribe();
    worker.emit({ type: "mutation", name: "delete_object" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("bridges a dialog request to the registered handler and answers", async () => {
    const { worker, runtime } = setup();
    const handler = vi.fn(async () => ({ ok: true, value: 42 }));
    runtime.setDialogHandler(handler);
    worker.emit({
      type: "dialog-request",
      id: 7,
      kind: "confirm",
      payload: { q: 1 },
    });
    // Let the async handler settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith("confirm", { q: 1 });
    expect(worker.sent).toContainEqual({
      type: "dialog-response",
      id: 7,
      ok: true,
      value: { ok: true, value: 42 },
    });
  });

  it("answers a dialog request with an error when no handler is set", async () => {
    const { worker } = setup();
    worker.emit({
      type: "dialog-request",
      id: 9,
      kind: "confirm",
      payload: null,
    });
    await Promise.resolve();
    expect(worker.sent).toContainEqual({
      type: "dialog-response",
      id: 9,
      ok: false,
      error: "no dialog handler registered",
    });
  });

  it("serves synchronous accessors from defaults, then from the mirror", () => {
    const { worker, runtime } = setup();
    // Before any mirror push: zeroed defaults.
    expect(runtime.getStorageMode()).toBe("ram");
    expect(runtime.getDiskStoreBytes()).toBe(0);
    expect(runtime.getSpilledCount()).toBe(0);
    expect(runtime.getMemoryUsage()).toEqual({
      wasmBytes: null,
      dataBytes: null,
      jsUsedBytes: null,
      jsLimitBytes: null,
    });
    // After a mirror push: the cached snapshot.
    worker.emit({ type: "mirror", mirror: MIRROR });
    expect(runtime.getStorageMode()).toBe("disk");
    expect(runtime.getDiskStoreBytes()).toBe(4096);
    expect(runtime.getSpilledCount()).toBe(3);
    expect(runtime.getMemoryUsage()).toEqual(MIRROR.memoryUsage);
  });

  it("disposes the worker and rejects in-flight calls", async () => {
    const { worker, proxy, runtime } = setup();
    const promise = (runtime.listImages as () => Promise<unknown>)();
    proxy.dispose();
    expect(worker.terminated).toBe(true);
    await expect(promise).rejects.toThrow("runtime worker disposed");
  });
});
