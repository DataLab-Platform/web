/**
 * Tests for the non-modal toast notifications: pushing a toast renders a
 * live-region status message, the close button dismisses it, and toasts
 * auto-dismiss after their duration elapses.
 */
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

import {
  ToastProvider,
  useToast,
  type ToastOptions,
} from "../../../src/components/Toast";

/** Push a single toast on mount. */
function Trigger({ options }: { options: ToastOptions }) {
  const push = useToast();
  useEffect(() => {
    push(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Toast", () => {
  it("renders the pushed message in a polite live region", async () => {
    render(
      <ToastProvider>
        <Trigger options={{ message: "Saved report.csv", kind: "success" }} />
      </ToastProvider>,
    );
    const toast = await screen.findByText("Saved report.csv");
    expect(toast).toBeTruthy();
    expect(toast.closest(".toast-success")).not.toBeNull();
    const region = document.querySelector(".toast-host");
    expect(region?.getAttribute("aria-live")).toBe("polite");
  });

  it("auto-dismisses after the duration elapses", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger options={{ message: "Transient", duration: 1000 }} />
      </ToastProvider>,
    );
    expect(screen.queryByText("Transient")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByText("Transient")).toBeNull();
  });

  it("dismisses when the close button is clicked", () => {
    render(
      <ToastProvider>
        <Trigger options={{ message: "Dismiss me" }} />
      </ToastProvider>,
    );
    expect(screen.queryByText("Dismiss me")).not.toBeNull();
    act(() => {
      screen.getByRole("button").click();
    });
    expect(screen.queryByText("Dismiss me")).toBeNull();
  });
});
