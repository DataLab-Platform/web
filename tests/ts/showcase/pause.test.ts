import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PauseController,
  ShowcaseAborted,
  sleep,
} from "../../../src/showcase/pause";

describe("PauseController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds for the requested time", async () => {
    const pause = new PauseController();
    let done = false;
    void pause.hold(500).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(450);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
  });

  it("does not count paused time", async () => {
    const pause = new PauseController();
    let done = false;
    void pause.hold(300).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    pause.setPaused(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(done).toBe(false);
    expect(pause.toggle()).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(done).toBe(true);
  });

  it("notifies pause changes once per change", () => {
    const pause = new PauseController();
    const seen: boolean[] = [];
    const unsubscribe = pause.onChange((paused) => seen.push(paused));
    pause.setPaused(true);
    pause.setPaused(true);
    pause.toggle();
    unsubscribe();
    pause.toggle();
    expect(seen).toEqual([true, false]);
  });

  it("waits while paused only", async () => {
    const pause = new PauseController();
    await expect(pause.waitWhilePaused()).resolves.toBeUndefined();
    pause.setPaused(true);
    let resumed = false;
    void pause.waitWhilePaused().then(() => {
      resumed = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(resumed).toBe(false);
    pause.setPaused(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(resumed).toBe(true);
  });

  it("aborts holds and sleeps", async () => {
    const pause = new PauseController();
    const controller = new AbortController();
    const hold = pause.hold(10_000, controller.signal);
    const nap = sleep(10_000, controller.signal);
    controller.abort();
    await expect(hold).rejects.toBeInstanceOf(ShowcaseAborted);
    await expect(nap).rejects.toBeInstanceOf(ShowcaseAborted);
    await expect(sleep(10, controller.signal)).rejects.toBeInstanceOf(
      ShowcaseAborted,
    );
  });
});
