/**
 * Tests for the persistent label of the showcase overlay
 * (``ShowcaseContext.label``).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ActionState } from "../../../src/actions/types";
import type { RuntimeApi } from "../../../src/runtime/runtime";
import { ShowcaseContext } from "../../../src/showcase/engine";
import type { ShowcaseHost } from "../../../src/showcase/launch";
import { ShowcaseOverlay } from "../../../src/showcase/overlay";

const host: ShowcaseHost = {
  runtime: {} as RuntimeApi,
  getActions: () => [],
  getActionState: () => ({}) as ActionState,
  getPluginRecords: () => [],
  resetWorkspace: async () => undefined,
};

function sticker(): HTMLElement | null {
  return document.querySelector(".showcase-overlay > .showcase-sticker");
}

describe("ShowcaseContext.label", () => {
  const overlay = new ShowcaseOverlay();

  afterEach(() => overlay.unmount());

  it("shows a label kept across captions until the demo ends", async () => {
    overlay.mount();
    const ctx = new ShowcaseContext(host, { speed: 1, overlay });
    ctx.label("Replayed session");
    expect(sticker()?.textContent).toBe("Replayed session");
    overlay.caption("", "A caption");
    ctx.clearCaption();
    expect(sticker()?.textContent).toBe("Replayed session");
    ctx.endScenario();
    expect(sticker()).toBeNull();
  });

  it("can be removed early, and is a no-op in check mode", () => {
    overlay.mount();
    const ctx = new ShowcaseContext(host, { speed: 1, overlay });
    ctx.label("Simulated");
    ctx.label(null);
    expect(sticker()).toBeNull();
    const check = new ShowcaseContext(host, { speed: 0, overlay });
    check.label("Simulated");
    expect(sticker()).toBeNull();
  });
});
