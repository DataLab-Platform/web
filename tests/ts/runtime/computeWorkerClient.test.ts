/**
 * Unit tests for {@link ComputeWorkerClient} — the main-thread client that
 * drives the disposable compute worker.
 *
 * A **fake worker** (an in-memory transport that records outgoing messages
 * and lets the test push events back) validates the whole protocol — the
 * ready handshake, run request/reply, error propagation, and crucially the
 * **terminate-on-cancel** path — deterministically, without booting Pyodide.
 */
import { describe, expect, it } from "vitest";

import {
  ComputeWorkerClient,
  ProcessingCancelledError,
  type ComputeWorkerLike,
} from "../../../src/runtime/ComputeWorkerClient";
import type {
  ComputeEvent,
  ComputeRequest,
} from "../../../src/runtime/computeProtocol";

class FakeComputeWorker implements ComputeWorkerLike {
  readonly sent: ComputeRequest[] = [];
  terminated = false;
  private listener: ((ev: { data: unknown }) => void) | null = null;
  private errorListener:
    | ((ev: { message?: string; filename?: string }) => void)
    | null = null;

  postMessage(message: unknown): void {
    this.sent.push(message as ComputeRequest);
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

  emit(event: ComputeEvent): void {
    this.listener?.({ data: event });
  }

  emitError(message: string): void {
    this.errorListener?.({ message });
  }

  last(): ComputeRequest {
    return this.sent[this.sent.length - 1];
  }
}

function setup() {
  const worker = new FakeComputeWorker();
  const client = new ComputeWorkerClient(worker);
  return { worker, client };
}

describe("ComputeWorkerClient", () => {
  it("resolves init only after the worker reports ready", async () => {
    const { worker, client } = setup();
    let resolved = false;
    const ready = client.init("fr").then(() => {
      resolved = true;
    });
    expect(worker.last()).toEqual({ type: "init", lang: "fr" });
    expect(resolved).toBe(false);
    worker.emit({ type: "ready" });
    await ready;
    expect(resolved).toBe(true);
  });

  it("rejects init when the worker reports a boot error", async () => {
    const { worker, client } = setup();
    const ready = client.init("C");
    worker.emit({ type: "boot-error", error: "micropip failed" });
    await expect(ready).rejects.toThrow(/micropip failed/);
  });

  it("rejects init on an uncaught worker error event", async () => {
    const { worker, client } = setup();
    const ready = client.init("C");
    worker.emitError("Unexpected token (computeWorker.ts:1)");
    await expect(ready).rejects.toThrow(/Unexpected token/);
  });

  it("round-trips a run request and resolves with the serialised items", async () => {
    const { worker, client } = setup();
    await voidReady(worker, client);
    const promise = client.run({
      featureId: "normalize",
      sourceIds: ["s1"],
      sourcesB64: ["AAA="],
    });
    const req = worker.last();
    expect(req.type).toBe("run");
    if (req.type !== "run") throw new Error("expected run");
    expect(req.featureId).toBe("normalize");
    expect(req.params).toBeNull();
    expect(req.operandB64).toBeNull();
    worker.emit({
      type: "result",
      id: req.id,
      ok: true,
      items: [["s1", "BBB="]],
    });
    await expect(promise).resolves.toEqual([["s1", "BBB="]]);
  });

  it("forwards params and operand on the run request", async () => {
    const { worker, client } = setup();
    await voidReady(worker, client);
    void client.run({
      featureId: "difference",
      sourceIds: ["a"],
      sourcesB64: ["AAA="],
      params: { method: "x" },
      operandB64: "OP=",
    });
    const req = worker.last();
    if (req.type !== "run") throw new Error("expected run");
    expect(req.params).toEqual({ method: "x" });
    expect(req.operandB64).toBe("OP=");
  });

  it("rejects a run when the worker reports an error result", async () => {
    const { worker, client } = setup();
    await voidReady(worker, client);
    const promise = client.run({
      featureId: "boom",
      sourceIds: ["s1"],
      sourcesB64: ["AAA="],
    });
    const req = worker.last();
    if (req.type !== "run") throw new Error("expected run");
    worker.emit({ type: "result", id: req.id, ok: false, error: "kaboom" });
    await expect(promise).rejects.toThrow(/kaboom/);
  });

  it("cancel() terminates the worker and rejects the in-flight run", async () => {
    const { worker, client } = setup();
    await voidReady(worker, client);
    const promise = client.run({
      featureId: "moving_median",
      sourceIds: ["img"],
      sourcesB64: ["AAA="],
    });
    expect(worker.terminated).toBe(false);
    client.cancel();
    expect(worker.terminated).toBe(true);
    expect(client.isTerminated).toBe(true);
    await expect(promise).rejects.toBeInstanceOf(ProcessingCancelledError);
  });

  it("rejects new runs after the worker has been terminated", async () => {
    const { worker, client } = setup();
    await voidReady(worker, client);
    client.cancel();
    await expect(
      client.run({
        featureId: "normalize",
        sourceIds: ["s"],
        sourcesB64: ["A"],
      }),
    ).rejects.toBeInstanceOf(ProcessingCancelledError);
  });
});

/** Boot the client to ``ready`` so ``run`` can proceed. */
async function voidReady(
  worker: FakeComputeWorker,
  client: ComputeWorkerClient,
): Promise<void> {
  const ready = client.init("C");
  worker.emit({ type: "ready" });
  await ready;
}
