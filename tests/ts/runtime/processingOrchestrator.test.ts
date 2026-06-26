/**
 * Unit tests for {@link ProcessingOrchestrator} — the main-thread glue that
 * runs a feature as extract (kernel) → compute (worker) → commit (kernel),
 * with cancellation by terminating the compute worker.
 *
 * Both collaborators are faked: a stub runtime records the extract/commit
 * calls, and a fake {@link ComputeWorkerClient} factory hands out controllable
 * clients. No Pyodide, no real worker — just the orchestration logic.
 */
import { describe, expect, it, vi } from "vitest";

import {
  ProcessingOrchestrator,
  ProcessingCancelledError,
  type ProcessingRuntime,
} from "../../../src/runtime/ProcessingOrchestrator";
import {
  ComputeWorkerClient,
  type ComputeWorkerLike,
} from "../../../src/runtime/ComputeWorkerClient";
import type {
  ComputeEvent,
  ComputeRequest,
  SerializedResultItem,
} from "../../../src/runtime/computeProtocol";

class FakeComputeWorker implements ComputeWorkerLike {
  terminated = false;
  hold = false;
  items: SerializedResultItem[] = [["s", "OUT"]];
  private listener: ((ev: { data: unknown }) => void) | null = null;

  postMessage(message: unknown): void {
    // Auto-reply to a ``run`` here: the client has already registered the
    // pending call (it sets the table entry before posting), so the reply
    // resolves deterministically. ``hold`` keeps the run pending so a test
    // can cancel it.
    const msg = message as ComputeRequest;
    if (msg.type === "run" && !this.hold) {
      const { id } = msg;
      queueMicrotask(() =>
        this.emit({ type: "result", id, ok: true, items: this.items }),
      );
    }
  }
  addEventListener(
    type: "message" | "error",
    listener: (ev: { data: unknown }) => void,
  ): void {
    if (type === "message") this.listener = listener;
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(event: ComputeEvent): void {
    this.listener?.({ data: event });
  }
}

/** Build a booted client backed by a controllable fake worker. */
function bootedClient(hold = false): {
  client: ComputeWorkerClient;
  worker: FakeComputeWorker;
} {
  const worker = new FakeComputeWorker();
  worker.hold = hold;
  const client = new ComputeWorkerClient(worker);
  const ready = client.init("C");
  worker.emit({ type: "ready" });
  void ready;
  return { client, worker };
}

function stubRuntime(): ProcessingRuntime & {
  extract: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
} {
  const extract = vi.fn(async () => ({
    sources_b64: ["SRC"],
    operand_b64: null,
  }));
  const commit = vi.fn(async () => ["new1"]);
  return {
    extract,
    commit,
    extractFeatureInputs:
      extract as unknown as ProcessingRuntime["extractFeatureInputs"],
    commitFeatureResults:
      commit as unknown as ProcessingRuntime["commitFeatureResults"],
  };
}

describe("ProcessingOrchestrator", () => {
  it("runs extract → compute → commit and returns the new ids", async () => {
    const runtime = stubRuntime();
    const { client } = bootedClient();
    const factory = vi.fn(async () => client);
    const orch = new ProcessingOrchestrator(runtime, "fr", factory, 0);

    await expect(
      orch.runFeature({ featureId: "normalize", sourceIds: ["s1"] }),
    ).resolves.toEqual(["new1"]);
    expect(runtime.extract).toHaveBeenCalledWith("normalize", ["s1"], null);
    expect(runtime.commit).toHaveBeenCalledWith(
      "normalize",
      ["s1"],
      [["s", "OUT"]],
      null,
      null,
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("reuses the same compute worker across runs", async () => {
    const runtime = stubRuntime();
    const { client } = bootedClient();
    const factory = vi.fn(async () => client);
    const orch = new ProcessingOrchestrator(runtime, "C", factory, 0);

    await orch.runFeature({ featureId: "f", sourceIds: ["s"] });
    await orch.runFeature({ featureId: "f", sourceIds: ["s"] });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("cancel() rejects the in-flight run and never commits", async () => {
    const runtime = stubRuntime();
    const { client } = bootedClient(true); // hold: run stays pending
    const factory = vi.fn(async () => client);
    const orch = new ProcessingOrchestrator(runtime, "C", factory, 0);

    const promise = orch.runFeature({
      featureId: "moving_median",
      sourceIds: ["img"],
    });
    // Let extract + ensureClient + the run() post flush before cancelling.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    orch.cancel();

    await expect(promise).rejects.toBeInstanceOf(ProcessingCancelledError);
    expect(runtime.commit).not.toHaveBeenCalled();
  });

  it("spawns a fresh worker after a cancel", async () => {
    const runtime = stubRuntime();
    const first = bootedClient(true); // held → cancellable
    const second = bootedClient(); // auto-replies
    const factory = vi
      .fn<[], Promise<ComputeWorkerClient>>()
      .mockResolvedValueOnce(first.client)
      .mockResolvedValueOnce(second.client);
    const orch = new ProcessingOrchestrator(runtime, "C", factory, 0);

    const p1 = orch.runFeature({ featureId: "f", sourceIds: ["s"] });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    orch.cancel();
    await expect(p1).rejects.toBeInstanceOf(ProcessingCancelledError);

    await expect(
      orch.runFeature({ featureId: "f", sourceIds: ["s"] }),
    ).resolves.toEqual(["new1"]);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
