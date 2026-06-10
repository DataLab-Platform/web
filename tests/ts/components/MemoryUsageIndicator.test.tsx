/**
 * Tests for :class:`MemoryUsageIndicator` — the menu-bar button that
 * surfaces the live WASM/Python heap footprint and triggers a
 * garbage-collection pass when clicked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import {
  MemoryUsageIndicator,
  MEMORY_POLL_INTERVAL_MS,
} from "../../../src/components/MemoryUsageIndicator";
import type { DataLabRuntime } from "../../../src/runtime/runtime";
import type { MemoryUsage } from "../../../src/utils/memory";

const GiB = 1024 * 1024 * 1024;

/** Narrow no-break space (U+202F) joining value and unit. */
const NB = "\u202f";

/**
 * Build a fake runtime exposing only the methods the indicator uses.
 * ``getMemoryUsage`` reads a mutable holder so tests can change the
 * reported footprint between polls.
 */
function fakeRuntime(holder: { usage: MemoryUsage }): {
  runtime: DataLabRuntime;
} {
  const runtime = {
    getMemoryUsage: () => holder.usage,
  } as unknown as DataLabRuntime;
  return { runtime };
}

function usage(
  wasmBytes: number | null,
  jsUsedBytes: number | null = null,
  dataBytes: number | null = null,
): MemoryUsage {
  return { wasmBytes, dataBytes, jsUsedBytes, jsLimitBytes: null };
}

describe("MemoryUsageIndicator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders nothing before the runtime exposes its heap", () => {
    const { container } = render(<MemoryUsageIndicator runtime={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when wasmBytes is null", () => {
    const holder = { usage: usage(null) };
    const { runtime } = fakeRuntime(holder);
    const { container } = render(<MemoryUsageIndicator runtime={runtime} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the formatted heap size with the ok class below the warn threshold", () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    render(
      <MemoryUsageIndicator runtime={runtime} onRequestFreeMemory={vi.fn()} />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveClass("memory-usage-indicator");
    expect(button).not.toHaveClass("warn");
    expect(button).not.toHaveClass("critical");
    expect(
      button.querySelector(".memory-usage-indicator-value")?.textContent,
    ).toBe(`512${NB}MB`);
  });

  it("turns orange in the warn band and red past the critical threshold", () => {
    const warnHolder = { usage: usage(2 * GiB) };
    const { runtime: warnRuntime } = fakeRuntime(warnHolder);
    const { unmount } = render(<MemoryUsageIndicator runtime={warnRuntime} />);
    expect(screen.getByRole("button")).toHaveClass("warn");
    unmount();

    const critHolder = { usage: usage(3 * GiB) };
    const { runtime: critRuntime } = fakeRuntime(critHolder);
    render(<MemoryUsageIndicator runtime={critRuntime} />);
    expect(screen.getByRole("button")).toHaveClass("critical");
  });

  it("disables the Free memory menu item when no handler is supplied", () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    render(<MemoryUsageIndicator runtime={runtime} />);
    const indicator = screen.getByRole("button");
    // The indicator itself stays clickable (it opens the menu).
    expect(indicator).not.toBeDisabled();
    act(() => {
      indicator.click();
    });
    expect(
      screen.getByRole("menuitem", { name: /Free memory/ }),
    ).toBeDisabled();
  });

  it("opens a dropdown menu listing the memory actions on click", () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    render(
      <MemoryUsageIndicator
        runtime={runtime}
        onRequestFreeMemory={vi.fn()}
        onToggleStoreOnDisk={vi.fn()}
        diskStorageSupported
      />,
    );
    // No menu until the indicator is clicked.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    act(() => {
      screen.getByRole("button").click();
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Store data on disk/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Free memory/ }),
    ).toBeInTheDocument();
    // The persistent option and the one-shot action are visually
    // separated, so they don't read as two identical rows. The divider
    // is decorative (``aria-hidden``), hence the ``hidden`` query option.
    expect(screen.getByRole("separator", { hidden: true })).toBeInTheDocument();
  });

  it("hides the store-on-disk item when no toggle handler is supplied", () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    render(
      <MemoryUsageIndicator runtime={runtime} onRequestFreeMemory={vi.fn()} />,
    );
    act(() => {
      screen.getByRole("button").click();
    });
    expect(
      screen.queryByRole("menuitemcheckbox", { name: /Store data on disk/ }),
    ).not.toBeInTheDocument();
  });

  it("checkmarks the store-on-disk item only when enabled", () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    const { rerender } = render(
      <MemoryUsageIndicator
        runtime={runtime}
        onToggleStoreOnDisk={vi.fn()}
        diskStorageSupported
        storeOnDisk={false}
      />,
    );
    act(() => {
      screen.getByRole("button").click();
    });
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Store data on disk/ }),
    ).toHaveAttribute("aria-checked", "false");
    rerender(
      <MemoryUsageIndicator
        runtime={runtime}
        onToggleStoreOnDisk={vi.fn()}
        diskStorageSupported
        storeOnDisk
      />,
    );
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Store data on disk/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("disables the store-on-disk item when unsupported or busy", () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    const { rerender } = render(
      <MemoryUsageIndicator
        runtime={runtime}
        onToggleStoreOnDisk={vi.fn()}
        diskStorageSupported={false}
      />,
    );
    act(() => {
      screen.getByRole("button").click();
    });
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Store data on disk/ }),
    ).toBeDisabled();
    rerender(
      <MemoryUsageIndicator
        runtime={runtime}
        onToggleStoreOnDisk={vi.fn()}
        diskStorageSupported
        storageBusy
      />,
    );
    expect(
      screen.getByRole("menuitemcheckbox", { name: /Store data on disk/ }),
    ).toBeDisabled();
  });

  it("invokes the store-on-disk toggle when the item is clicked", async () => {
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    const onToggleStoreOnDisk = vi.fn();
    render(
      <MemoryUsageIndicator
        runtime={runtime}
        onToggleStoreOnDisk={onToggleStoreOnDisk}
        diskStorageSupported
      />,
    );
    act(() => {
      screen.getByRole("button").click();
    });
    await act(async () => {
      screen
        .getByRole("menuitemcheckbox", { name: /Store data on disk/ })
        .click();
    });
    expect(onToggleStoreOnDisk).toHaveBeenCalledTimes(1);
    // The menu closes after the action.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("invokes the free-memory handler and re-samples on click", async () => {
    const holder = { usage: usage(2.6 * GiB) };
    const { runtime } = fakeRuntime(holder);
    const onRequestFreeMemory = vi.fn(async () => {
      // Simulate the heap footprint dropping after reclamation. The
      // WASM heap does not actually shrink, but the indicator re-samples
      // and must reflect whatever the runtime now reports.
      holder.usage = usage(512 * 1024 * 1024);
    });
    render(
      <MemoryUsageIndicator
        runtime={runtime}
        onRequestFreeMemory={onRequestFreeMemory}
      />,
    );
    const indicator = screen.getByRole("button");
    expect(indicator).toHaveClass("critical");
    act(() => {
      indicator.click();
    });

    await act(async () => {
      screen.getByRole("menuitem", { name: /Free memory/ }).click();
    });

    expect(onRequestFreeMemory).toHaveBeenCalledTimes(1);
    // After the handler settles, the indicator re-samples and reflects
    // the new (lower) footprint.
    expect(
      screen.getByRole("button").querySelector(".memory-usage-indicator-value")
        ?.textContent,
    ).toBe(`512${NB}MB`);
  });

  it("re-samples on the polling interval", () => {
    vi.useFakeTimers();
    const holder = { usage: usage(512 * 1024 * 1024) };
    const { runtime } = fakeRuntime(holder);
    render(<MemoryUsageIndicator runtime={runtime} />);
    expect(
      screen.getByRole("button").querySelector(".memory-usage-indicator-value")
        ?.textContent,
    ).toBe(`512${NB}MB`);

    holder.usage = usage(2 * GiB);
    act(() => {
      vi.advanceTimersByTime(MEMORY_POLL_INTERVAL_MS);
    });
    expect(screen.getByRole("button")).toHaveClass("warn");
  });

  it("shows the data-loaded figure as the headline, coloured by the reserved heap", async () => {
    // Reserved heap sits in the critical band, but only 256 MB of data
    // is actually loaded: the headline must show the responsive data
    // figure while the colour still reflects the OOM-relevant heap.
    const holder = { usage: usage(3 * GiB) };
    const runtime = {
      getMemoryUsage: () => holder.usage,
      getDataMemoryBytes: async () => 256 * 1024 * 1024,
    } as unknown as DataLabRuntime;
    await act(async () => {
      render(<MemoryUsageIndicator runtime={runtime} />);
    });
    const button = screen.getByRole("button");
    expect(button).toHaveClass("critical");
    expect(
      button.querySelector(".memory-usage-indicator-value")?.textContent,
    ).toBe(`256${NB}MB`);
  });

  it("drops the headline when data is deleted even though the heap stays put", async () => {
    vi.useFakeTimers();
    let dataBytes = 1.3 * GiB;
    const holder = { usage: usage(3 * GiB) };
    const runtime = {
      getMemoryUsage: () => holder.usage,
      getDataMemoryBytes: async () => dataBytes,
    } as unknown as DataLabRuntime;
    render(<MemoryUsageIndicator runtime={runtime} />);
    // Let the initial async sample resolve.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByRole("button").querySelector(".memory-usage-indicator-value")
        ?.textContent,
    ).toBe(`1.3${NB}GB`);

    // Simulate deleting every object: data drops, reserved heap unchanged.
    dataBytes = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MEMORY_POLL_INTERVAL_MS);
    });
    expect(
      screen.getByRole("button").querySelector(".memory-usage-indicator-value")
        ?.textContent,
    ).toBe(`0${NB}B`);
    // Colour still reflects the reserved heap (still critical).
    expect(screen.getByRole("button")).toHaveClass("critical");
  });
});
