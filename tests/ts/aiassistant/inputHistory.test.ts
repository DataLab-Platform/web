/**
 * Tests for the AI Assistant input history (localStorage-backed).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { InputHistory } from "../../../src/aiassistant/inputHistory";

const TEST_KEY = "test.aiassistant.inputHistory";

beforeEach(() => {
  localStorage.removeItem(TEST_KEY);
});

describe("InputHistory", () => {
  it("starts empty", () => {
    const h = new InputHistory(50, TEST_KEY);
    expect(h.getItems()).toEqual([]);
    expect(h.previous("")).toBeNull();
    expect(h.next()).toBeNull();
  });

  it("ignores blank entries", () => {
    const h = new InputHistory(50, TEST_KEY);
    h.add("");
    h.add("   ");
    h.add("\n\n");
    expect(h.getItems()).toEqual([]);
  });

  it("appends and dedupes earlier identical entries", () => {
    const h = new InputHistory(50, TEST_KEY);
    h.add("a");
    h.add("b");
    h.add("a"); // moves "a" to the end
    expect(h.getItems()).toEqual(["b", "a"]);
  });

  it("trims to maxSize", () => {
    const h = new InputHistory(2, TEST_KEY);
    h.add("a");
    h.add("b");
    h.add("c");
    expect(h.getItems()).toEqual(["b", "c"]);
  });

  it("navigates previous / next and restores the draft", () => {
    const h = new InputHistory(50, TEST_KEY);
    h.add("first");
    h.add("second");
    h.add("third");

    expect(h.previous("draft")).toBe("third");
    expect(h.previous("draft")).toBe("second");
    expect(h.previous("draft")).toBe("first");
    // Past the oldest: stays on first.
    expect(h.previous("draft")).toBe("first");

    expect(h.next()).toBe("second");
    expect(h.next()).toBe("third");
    // Past the newest: restore the original draft.
    expect(h.next()).toBe("draft");
    // Navigation is now reset.
    expect(h.next()).toBeNull();
  });

  it("persists across instances via localStorage", () => {
    const h1 = new InputHistory(50, TEST_KEY);
    h1.add("alpha");
    h1.add("beta");

    const h2 = new InputHistory(50, TEST_KEY);
    expect(h2.getItems()).toEqual(["alpha", "beta"]);
  });

  it("clear empties everything", () => {
    const h = new InputHistory(50, TEST_KEY);
    h.add("x");
    h.clear();
    expect(h.getItems()).toEqual([]);
    expect(localStorage.getItem(TEST_KEY)).toBe("[]");
  });
});
