/**
 * ``?close=1`` (web interlude of DataLab desktop): after one pass, the
 * showcase keeps its end card and closes the window; when the browser
 * refuses, a discreet "You can close this window" end state stays.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShowcaseScenario } from "../../../src/showcase/engine";

const played: string[] = [];

vi.mock("../../../src/showcase/index", () => {
  const scenario: ShowcaseScenario = {
    id: "x",
    title: () => "Demo",
    run: async () => {
      played.push("x");
    },
  };
  return {
    getShowcaseScenarios: async () => [scenario],
    selectScenarios: (all: ShowcaseScenario[]) => ({
      scenarios: all,
      unknown: [],
    }),
  };
});

import type { ActionDescriptor, ActionState } from "../../../src/actions/types";
import type { RuntimeApi } from "../../../src/runtime/runtime";
import {
  isShowcaseActive,
  type ShowcaseHost,
} from "../../../src/showcase/launch";
import { DEFAULT_RELOAD_EVERY } from "../../../src/showcase/options";
import { startShowcase } from "../../../src/showcase/player";

function host(): ShowcaseHost {
  return {
    runtime: {} as RuntimeApi,
    getActions: () => [] as ActionDescriptor[],
    getActionState: () => ({}) as ActionState,
    getPluginRecords: () => [],
    resetWorkspace: vi.fn(async () => undefined),
  };
}

function options(close: boolean) {
  return {
    ids: null,
    loop: false,
    // Fast pace: the title and end cards last a few hundred ms.
    speed: 0.05,
    check: false,
    reloadEvery: DEFAULT_RELOAD_EVERY,
    fromUrl: true,
    close,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-showcase");
  played.length = 0;
});

describe("showcase player — close=1", () => {
  it("plays one pass, then closes the window", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const status = await startShowcase(host(), options(true));
    expect(played).toEqual(["x"]);
    expect(close).toHaveBeenCalledTimes(1);
    // jsdom keeps the window open, as a browser refusing to close it:
    // the end card stays, with a discreet hint for the operator.
    expect(status?.state).toBe("done");
    expect(document.querySelector(".showcase-card-title")).toHaveTextContent(
      "Try DataLab Web now",
    );
    expect(document.querySelector(".showcase-badge")).toHaveTextContent(
      "You can close this window.",
    );
    expect(document.documentElement.getAttribute("data-showcase")).toBe("idle");
    expect(isShowcaseActive()).toBe(true);
  });

  it("never closes the window without close=1", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const status = await startShowcase(host(), options(false));
    expect(status?.state).toBe("done");
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector(".showcase-overlay")).toBeNull();
    expect(isShowcaseActive()).toBe(false);
  });
});
