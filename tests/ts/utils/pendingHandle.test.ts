import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PendingHandle } from "../../../src/utils/pendingHandle";

interface Handle {
  name: string;
}

describe("PendingHandle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves at once with an available handle", async () => {
    const pending = new PendingHandle<Handle>("Panel");
    const handle = { name: "first" };
    pending.ref(handle);
    await expect(pending.wait(1000)).resolves.toBe(handle);
  });

  it("waits for the handle when it is not available yet", async () => {
    const pending = new PendingHandle<Handle>("Panel");
    const first = pending.wait(1000);
    const second = pending.wait(1000);
    const handle = { name: "first" };
    pending.ref(handle);
    await expect(first).resolves.toBe(handle);
    await expect(second).resolves.toBe(handle);
  });

  it("waits for the new handle of a remounted component", async () => {
    const pending = new PendingHandle<Handle>("Panel");
    pending.ref({ name: "first" });
    pending.ref(null);
    const waiting = pending.wait(1000);
    const handle = { name: "second" };
    pending.ref(handle);
    await expect(waiting).resolves.toBe(handle);
  });

  it("rejects when the handle is still unavailable after the timeout", async () => {
    const pending = new PendingHandle<Handle>("Macros panel");
    const waiting = pending.wait(2000);
    const outcome = expect(waiting).rejects.toThrow(
      "Macros panel is not available after 2 s",
    );
    await vi.advanceTimersByTimeAsync(2000);
    await outcome;
    // A late handle neither resolves the expired wait nor fails.
    pending.ref({ name: "late" });
    await expect(pending.wait(1000)).resolves.toEqual({ name: "late" });
  });
});
