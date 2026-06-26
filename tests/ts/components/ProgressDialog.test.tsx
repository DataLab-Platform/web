/**
 * Tests for the progress dialog's **indeterminate** mode, used to show a
 * "computation in progress" indicator for a single opaque operation (one long
 * Sigima call) that has no measurable per-step progress.
 */
import { useEffect } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";

import {
  ProgressProvider,
  useProgress,
  type RunWithProgressFn,
} from "../../../src/components/ProgressDialog";

/** Drive ``runWithProgress`` once on mount with a step gated by *gate*. */
function Trigger({
  indeterminate,
  gate,
}: {
  indeterminate: boolean;
  gate: Promise<void>;
}) {
  const run: RunWithProgressFn = useProgress();
  useEffect(() => {
    void run({
      title: "Computing: Moving median",
      total: 1,
      minDuration: 0, // show immediately, no flash-avoidance delay in the test
      cancellable: false,
      indeterminate,
      step: async () => {
        await gate;
        return "id1";
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

describe("ProgressDialog — indeterminate mode", () => {
  it("shows an animated bar with no count and no Cancel button", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    render(
      <ProgressProvider>
        <Trigger indeterminate gate={gate} />
      </ProgressProvider>,
    );

    // The dialog appears with the computation title.
    await screen.findByText("Computing: Moving median");
    // Indeterminate bar is rendered…
    expect(
      document.querySelector(".progress-bar-fill.indeterminate"),
    ).not.toBeNull();
    // …and the count/percentage meta is hidden (nothing to measure).
    expect(screen.queryByText("0 / 1")).toBeNull();
    // Not cancellable: no Cancel button.
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();

    // Let the gated step finish (wrapped so the closing state update is
    // flushed inside ``act``).
    await act(async () => {
      open();
    });
  });

  it("keeps the determinate bar (count + percentage) when not indeterminate", async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    render(
      <ProgressProvider>
        <Trigger indeterminate={false} gate={gate} />
      </ProgressProvider>,
    );

    await screen.findByText("Computing: Moving median");
    // Determinate: the meta shows the step count, and the bar is the plain fill.
    expect(screen.getByText("0 / 1")).toBeInTheDocument();
    expect(
      document.querySelector(".progress-bar-fill.indeterminate"),
    ).toBeNull();

    await act(async () => {
      open();
    });
  });
});
