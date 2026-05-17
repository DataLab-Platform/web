/**
 * Unit tests for :mod:`utils/consoleLog` — the unseen-warning/-error
 * counter and the ``document.title`` prefix that drive the persistent
 * error indicator in the menu bar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  __resetConsoleLogForTests,
  getUnseenConsoleErrorCount,
  getUnseenConsoleErrorBreakdown,
  installConsoleCapture,
  markConsoleErrorsSeen,
  useConsoleErrors,
  useConsoleErrorTitlePrefix,
} from "../../../src/utils/consoleLog";

describe("consoleLog — unseen counter", () => {
  beforeEach(() => {
    installConsoleCapture(); // idempotent
    __resetConsoleLogForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts at zero", () => {
    expect(getUnseenConsoleErrorCount()).toBe(0);
    expect(getUnseenConsoleErrorBreakdown()).toEqual({
      errors: 0,
      warnings: 0,
    });
  });

  it("counts warn and error but ignores log/info/debug", () => {
    console.log("noise");
    console.info("noise");
    console.debug("noise");
    expect(getUnseenConsoleErrorCount()).toBe(0);

    console.warn("careful");
    console.error("boom");
    console.error("kaboom");
    expect(getUnseenConsoleErrorCount()).toBe(3);
    expect(getUnseenConsoleErrorBreakdown()).toEqual({
      errors: 2,
      warnings: 1,
    });
  });

  it("markConsoleErrorsSeen() resets unseen and only future entries re-increment", () => {
    console.error("first");
    console.warn("second");
    expect(getUnseenConsoleErrorCount()).toBe(2);

    markConsoleErrorsSeen();
    expect(getUnseenConsoleErrorCount()).toBe(0);

    console.error("third");
    expect(getUnseenConsoleErrorCount()).toBe(1);
  });

  it("survives ring-buffer trimming past MAX_ENTRIES", () => {
    // Push more than MAX_ENTRIES (1000) error entries — the oldest are
    // evicted but the counter must not under-count what remains.
    for (let i = 0; i < 1200; i++) console.error(`err ${i}`);
    // Buffer caps at 1000, so at most 1000 unseen entries remain.
    expect(getUnseenConsoleErrorCount()).toBe(1000);

    markConsoleErrorsSeen();
    expect(getUnseenConsoleErrorCount()).toBe(0);

    console.error("after-seen");
    expect(getUnseenConsoleErrorCount()).toBe(1);
  });
});

describe("useConsoleErrors hook", () => {
  beforeEach(() => {
    installConsoleCapture();
    __resetConsoleLogForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-renders when warn/error entries are added and when acknowledged", () => {
    const { result } = renderHook(() => useConsoleErrors());
    expect(result.current.unseen).toBe(0);

    act(() => {
      console.error("oops");
    });
    expect(result.current.unseen).toBe(1);
    expect(result.current.errors).toBe(1);
    expect(result.current.warnings).toBe(0);

    act(() => {
      console.warn("hmm");
    });
    expect(result.current.unseen).toBe(2);
    expect(result.current.warnings).toBe(1);

    act(() => {
      result.current.markSeen();
    });
    expect(result.current.unseen).toBe(0);
  });
});

describe("useConsoleErrorTitlePrefix", () => {
  beforeEach(() => {
    installConsoleCapture();
    __resetConsoleLogForTests();
    document.title = "DataLab Web";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.title = "";
  });

  it("prefixes the document title while unseen > 0 and removes it after markSeen", () => {
    const { result } = renderHook(() => {
      useConsoleErrorTitlePrefix();
      return useConsoleErrors();
    });
    expect(document.title).toBe("DataLab Web");

    act(() => {
      console.error("oops");
    });
    expect(document.title).toBe("(!) DataLab Web");

    // A second error must not double-prefix.
    act(() => {
      console.error("again");
    });
    expect(document.title).toBe("(!) DataLab Web");

    act(() => {
      result.current.markSeen();
    });
    expect(document.title).toBe("DataLab Web");
  });

  it("removes the prefix on unmount", () => {
    const { unmount } = renderHook(() => useConsoleErrorTitlePrefix());
    act(() => {
      console.error("oops");
    });
    expect(document.title).toBe("(!) DataLab Web");
    unmount();
    expect(document.title).toBe("DataLab Web");
  });
});
