import { describe, expect, it, vi } from "vitest";

import {
  ProcessingPreviewController,
  type ProcessingPreviewState,
} from "../../../src/runtime/ProcessingPreviewController";
import type {
  ProcessingPreviewResult,
  RuntimeApi,
} from "../../../src/runtime/runtime";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function signalResult(value: number): ProcessingPreviewResult {
  return {
    kind: "signal",
    data: {
      id: "preview",
      uuid: null,
      title: "preview",
      size: 2,
      xlabel: "",
      ylabel: "",
      xunit: "",
      yunit: "",
      x: new Float64Array([0, 1]),
      y: new Float64Array([value, value]),
    },
  };
}

function request(n: number, sourceId = "s1") {
  return {
    featureId: "moving_average",
    sourceId,
    params: { n },
  };
}

function fakeRuntime() {
  const pending: ReturnType<typeof deferred<ProcessingPreviewResult>>[] = [];
  const previewFeature = vi.fn(() => {
    const call = deferred<ProcessingPreviewResult>();
    pending.push(call);
    return call.promise;
  });
  const releasePreviewResult = vi.fn(async () => undefined);
  return {
    runtime: { previewFeature, releasePreviewResult } as unknown as RuntimeApi,
    previewFeature,
    releasePreviewResult,
    pending,
  };
}

describe("ProcessingPreviewController", () => {
  it("keeps one active and only the latest pending request", async () => {
    const { runtime, previewFeature, pending } = fakeRuntime();
    const states: ProcessingPreviewState[] = [];
    const controller = new ProcessingPreviewController(
      (state) => states.push(state),
      runtime,
    );

    controller.setEnabled(true);
    controller.request(request(3));
    controller.markDirty();
    controller.request(request(5));
    controller.markDirty();
    controller.request(request(7));

    expect(previewFeature).toHaveBeenCalledTimes(1);
    pending[0].resolve(signalResult(3));
    await vi.waitFor(() => expect(previewFeature).toHaveBeenCalledTimes(2));
    expect(previewFeature).toHaveBeenLastCalledWith(
      "moving_average",
      "s1",
      {
        n: 7,
      },
      expect.any(String),
    );
    expect(states).toContainEqual(
      expect.objectContaining({ status: "result", current: false }),
    );

    pending[1].resolve(signalResult(7));
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: "result", current: true }),
    );
  });

  it("detaches a current result token exactly once", async () => {
    const { runtime, pending, releasePreviewResult } = fakeRuntime();
    const controller = new ProcessingPreviewController(
      () => undefined,
      runtime,
    );
    controller.setEnabled(true);
    controller.request(request(3));
    pending[0].resolve(signalResult(3));
    await vi.waitFor(() =>
      expect(controller.takeCurrentResult()).not.toBeNull(),
    );

    expect(controller.takeCurrentResult()).toBeNull();
    controller.close();
    expect(releasePreviewResult).not.toHaveBeenCalled();
  });

  it("releases a current result when the source is invalidated", async () => {
    const { runtime, previewFeature, pending, releasePreviewResult } =
      fakeRuntime();
    const states: ProcessingPreviewState[] = [];
    const controller = new ProcessingPreviewController(
      (state) => states.push(state),
      runtime,
    );
    controller.setEnabled(true);
    controller.request(request(3));
    const token = previewFeature.mock.calls[0][3];
    pending[0].resolve(signalResult(3));
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: "result", current: true }),
    );

    controller.invalidateSource();

    expect(controller.takeCurrentResult()).toBeNull();
    expect(releasePreviewResult).toHaveBeenCalledWith(token);
  });

  it("ignores an invalidated response and stale error", async () => {
    const { runtime, pending } = fakeRuntime();
    const states: ProcessingPreviewState[] = [];
    const controller = new ProcessingPreviewController(
      (state) => states.push(state),
      runtime,
    );
    controller.setEnabled(true);
    controller.request(request(3));

    controller.invalidate();
    pending[0].reject(new Error("stale"));
    await Promise.resolve();
    await Promise.resolve();

    expect(states.some((state) => state.status === "error")).toBe(false);
  });

  it("drops a pending request as soon as newer values are dirty", async () => {
    const { runtime, previewFeature, pending } = fakeRuntime();
    const controller = new ProcessingPreviewController(
      () => undefined,
      runtime,
    );
    controller.setEnabled(true);
    controller.request(request(3));
    controller.request(request(5));
    controller.markDirty();

    pending[0].resolve(signalResult(3));
    await Promise.resolve();
    await Promise.resolve();

    expect(previewFeature).toHaveBeenCalledTimes(1);
  });

  it("runs a fresh request after source invalidation", async () => {
    const { runtime, previewFeature, pending } = fakeRuntime();
    const states: ProcessingPreviewState[] = [];
    const controller = new ProcessingPreviewController(
      (state) => states.push(state),
      runtime,
    );
    controller.setEnabled(true);
    controller.request(request(3));
    controller.invalidateSource();
    controller.request(request(5));

    pending[0].resolve(signalResult(3));
    await vi.waitFor(() => expect(previewFeature).toHaveBeenCalledTimes(2));
    expect(states.some((state) => state.status === "result")).toBe(false);

    pending[1].resolve(signalResult(5));
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: "result", current: true }),
    );
  });

  it("keeps a cancelled calculation active until it actually settles", async () => {
    const { runtime, previewFeature, pending } = fakeRuntime();
    const firstStates: ProcessingPreviewState[] = [];
    const secondStates: ProcessingPreviewState[] = [];
    const first = new ProcessingPreviewController(
      (state) => firstStates.push(state),
      runtime,
    );
    const second = new ProcessingPreviewController(
      (state) => secondStates.push(state),
      runtime,
    );

    first.setEnabled(true);
    first.request(request(3));
    first.close();
    second.setEnabled(true);
    second.request(request(9, "s2"));

    expect(previewFeature).toHaveBeenCalledTimes(1);
    pending[0].resolve(signalResult(3));
    await vi.waitFor(() => expect(previewFeature).toHaveBeenCalledTimes(2));
    expect(firstStates).toEqual([{ status: "computing" }]);

    pending[1].resolve(signalResult(9));
    await vi.waitFor(() =>
      expect(secondStates.at(-1)).toMatchObject({
        status: "result",
        current: true,
      }),
    );
  });

  it("recovers the shared queue after a current failure", async () => {
    const { runtime, previewFeature, pending, releasePreviewResult } =
      fakeRuntime();
    const states: ProcessingPreviewState[] = [];
    const controller = new ProcessingPreviewController(
      (state) => states.push(state),
      runtime,
    );
    controller.setEnabled(true);
    controller.request(request(3));
    controller.request(request(5));

    pending[0].reject(new Error("failed"));
    await vi.waitFor(() => expect(previewFeature).toHaveBeenCalledTimes(2));
    expect(releasePreviewResult).toHaveBeenCalledWith(
      previewFeature.mock.calls[0][3],
    );
    pending[1].resolve(signalResult(5));
    await vi.waitFor(() =>
      expect(states.at(-1)).toMatchObject({ status: "result", current: true }),
    );
  });
});
