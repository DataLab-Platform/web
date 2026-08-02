import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MULTI_SELECTION_DEBOUNCE_MS,
  useSelectionView,
} from "../../../src/hooks/useSelectionView";
import type {
  RuntimeApi,
  SignalData,
  SignalViewSnapshot,
} from "../../../src/runtime/runtime";

const signal = (id: string): SignalData => ({
  id,
  uuid: null,
  title: id,
  size: 1,
  xlabel: "",
  ylabel: "",
  xunit: "",
  yunit: "",
  x: [0],
  y: [1],
});

const signalSnapshot = (id: string): SignalViewSnapshot => ({
  kind: "signal",
  current: signal(id),
  extras: [],
  annotations: { shapes: [], annotations: [] },
  roi: [],
  results: [],
  extra_results: [],
});

afterEach(() => vi.useRealTimers());

describe("useSelectionView", () => {
  it("loads a simple selection immediately and replaces the view atomically", async () => {
    const getSignalViewSnapshot = vi
      .fn()
      .mockResolvedValue(signalSnapshot("A"));
    const runtime = { getSignalViewSnapshot } as unknown as RuntimeApi;
    const { result } = renderHook(() =>
      useSelectionView({
        runtime,
        currentId: "A",
        selectedIds: ["A"],
        treeKind: "signal",
        refreshNonce: 0,
        maxImages: 16,
      }),
    );

    await waitFor(() => expect(result.current.data?.id).toBe("A"));
    expect(getSignalViewSnapshot).toHaveBeenCalledOnce();
    expect(result.current.imageData).toBeNull();
  });

  it("debounces a multi-selection by 75 ms", async () => {
    vi.useFakeTimers();
    const getSignalViewSnapshot = vi
      .fn()
      .mockResolvedValue(signalSnapshot("B"));
    const runtime = { getSignalViewSnapshot } as unknown as RuntimeApi;
    renderHook(() =>
      useSelectionView({
        runtime,
        currentId: "B",
        selectedIds: ["A", "B"],
        treeKind: "signal",
        refreshNonce: 0,
        maxImages: 16,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MULTI_SELECTION_DEBOUNCE_MS - 1);
    });
    expect(getSignalViewSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(getSignalViewSnapshot).toHaveBeenCalledWith("B", ["A", "B"]);
  });
});
