import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArrayPreview } from "../../../src/components/ArrayPreview";
import { ToastProvider } from "../../../src/components/Toast";
import type { ObjectStats, RuntimeApi } from "../../../src/runtime/runtime";

const STATS: ObjectStats = {
  kind: "signal",
  n_points: 20,
  x_dtype: "float64",
  y_dtype: "float64",
  x_min: 0,
  x_max: 19,
  y_min: 0,
  y_max: 361,
  y_mean: 123.5,
  y_std: 0,
  y_median: 90.5,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ArrayPreview", () => {
  it("uses the preloaded preview and keeps full data lazy", async () => {
    const signalPreview = {
      size: 20,
      indices: [0, 1, 18, 19],
      x: [0, 1, 18, 19],
      y: [0, 1, 324, 361],
    };
    const getSignalData = vi.fn(async () => ({
      id: "signal-1",
      title: "Signal",
      size: 20,
      xlabel: "X",
      ylabel: "Y",
      xunit: "",
      yunit: "",
      x: new Float64Array(20),
      y: new Float64Array(20),
    }));
    const runtime = {
      getSignalData,
      setSignalData: vi.fn(),
    } as unknown as RuntimeApi;

    render(
      <ToastProvider>
        <ArrayPreview
          runtime={runtime}
          oid="signal-1"
          stats={STATS}
          signalPreview={signalPreview}
          refreshNonce={0}
          onApplied={vi.fn()}
        />
      </ToastProvider>,
    );

    await screen.findByText("361");
    expect(getSignalData).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit data…" }));
    await waitFor(() => expect(getSignalData).toHaveBeenCalledTimes(1));
  });
});
