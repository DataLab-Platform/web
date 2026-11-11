import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActionDescriptor, ActionState } from "../../../src/actions/types";
import type { RuntimeApi } from "../../../src/runtime/runtime";
import {
  CheckpointError,
  dispatchHoverTransition,
  insertIntoField,
  menuItemMatches,
  parseKeys,
  ShowcaseContext,
} from "../../../src/showcase/engine";
import type { ShowcaseHost } from "../../../src/showcase/launch";
import { ShowcaseOverlay } from "../../../src/showcase/overlay";

function menuItem(label: string, path?: string): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "menu-item";
  if (path) li.title = path;
  const span = document.createElement("span");
  span.className = "menu-label";
  span.textContent = label;
  li.appendChild(span);
  return li;
}

function host(actions: ActionDescriptor[] = []): ShowcaseHost {
  return {
    runtime: {} as RuntimeApi,
    getActions: () => actions,
    getActionState: () => ({}) as ActionState,
    getPluginRecords: () => [],
    resetWorkspace: async () => undefined,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("menuItemMatches", () => {
  it("matches leaves by their canonical menu path", () => {
    const fft = menuItem(
      "Transformée de Fourier",
      "Processing/Fourier analysis/FFT",
    );
    expect(menuItemMatches(fft, "FFT")).toBe(true);
    expect(menuItemMatches(fft, "Fourier analysis")).toBe(false);
  });

  it("matches labels exactly, ignoring a trailing ellipsis", () => {
    expect(menuItemMatches(menuItem("Windowing…"), "Windowing")).toBe(true);
    expect(
      menuItemMatches(menuItem("Fourier analysis"), "Fourier analysis…"),
    ).toBe(true);
    expect(menuItemMatches(menuItem("Fourier analysis"), "Fourier")).toBe(
      false,
    );
  });

  it("matches leaves by their action id", () => {
    const gauss = menuItem("Gaussienne", "Create/Gaussienne");
    gauss.dataset.actionId = "create.signal.gauss";
    expect(menuItemMatches(gauss, "create.signal.gauss")).toBe(true);
    expect(menuItemMatches(gauss, "create.signal.sinc")).toBe(false);
  });

  it("tests regular expressions against the label", () => {
    expect(menuItemMatches(menuItem("Cardinal sine"), /sine$/)).toBe(true);
    expect(
      menuItemMatches(menuItem("Cosine", "Create/Cosine"), /^Create/),
    ).toBe(false);
  });
});

describe("parseKeys", () => {
  it("parses modifiers, letters and named keys", () => {
    expect(parseKeys("Control+k")).toEqual({
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    });
    expect(parseKeys("Shift+Enter")).toMatchObject({
      key: "Enter",
      code: "Enter",
      shiftKey: true,
    });
    expect(parseKeys("Escape")).toMatchObject({
      key: "Escape",
      ctrlKey: false,
    });
    expect(parseKeys("7").code).toBe("Digit7");
    expect(parseKeys("+").key).toBe("+");
  });
});

describe("insertIntoField", () => {
  it("inserts at the caret and emits an input event", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.value = "ac";
    input.setSelectionRange(1, 1);
    const data: (string | null)[] = [];
    input.addEventListener("input", (event) =>
      data.push((event as InputEvent).data),
    );
    insertIntoField(input, "b");
    expect(input.value).toBe("abc");
    expect(input.selectionStart).toBe(2);
    expect(data).toEqual(["b"]);
  });
});

describe("dispatchHoverTransition", () => {
  it("fires out/leave on the previous element and over/enter on the next", () => {
    const parent = document.createElement("div");
    const a = document.createElement("span");
    const b = document.createElement("span");
    parent.append(a, b);
    document.body.appendChild(parent);
    const seen: string[] = [];
    for (const [name, el] of [
      ["parent", parent],
      ["a", a],
      ["b", b],
    ] as const) {
      for (const type of [
        "mouseout",
        "mouseleave",
        "mouseover",
        "mouseenter",
      ]) {
        el.addEventListener(type, (event) => {
          if (event.currentTarget === event.target)
            seen.push(`${name}:${type}`);
        });
      }
    }
    dispatchHoverTransition(a, b, { x: 1, y: 1 });
    expect(seen).toEqual([
      "a:mouseout",
      "a:mouseleave",
      "b:mouseover",
      "b:mouseenter",
    ]);
  });
});

describe("ShowcaseContext (check mode)", () => {
  it("does not wait and enforces checkpoints", async () => {
    const ctx = new ShowcaseContext(host(), { speed: 0 });
    expect(ctx.check).toBe(true);
    await ctx.hold(60_000);
    await ctx.checkpoint(() => true, "always true");
    await expect(ctx.checkpoint(false, "never true")).rejects.toBeInstanceOf(
      CheckpointError,
    );
    await expect(ctx.waitFor(() => false, 120, "a miracle")).rejects.toThrow(
      /a miracle/,
    );
  });

  it("runs enabled registry actions only", async () => {
    const run = vi.fn();
    const actions = [
      { id: "demo.ok", enabled: () => true, run },
      { id: "demo.off", enabled: () => false, run },
    ] as unknown as ActionDescriptor[];
    const ctx = new ShowcaseContext(host(actions), { speed: 0 });
    await ctx.runAction("demo.ok");
    expect(run).toHaveBeenCalledTimes(1);
    await expect(ctx.runAction("demo.off")).rejects.toThrow(/disabled/);
    await expect(ctx.runAction("demo.missing")).rejects.toThrow(/Unknown/);
  });
});

describe("ShowcaseContext pointer gestures (check mode)", () => {
  function track(el: Element, log: string[], name: string): void {
    for (const type of ["mousedown", "mousemove", "mouseup", "click"]) {
      el.addEventListener(type, (event) => {
        const mouse = event as MouseEvent;
        log.push(
          `${name}:${type}:${mouse.clientX},${mouse.clientY}:${mouse.buttons}`,
        );
      });
    }
  }

  it("clickAt releases on the element on top and clicks the common ancestor", async () => {
    const plot = document.createElement("div");
    document.body.appendChild(plot);
    let cover: HTMLElement | null = null;
    // Like Plotly, the press adds a full-page drag cover that gets the release.
    plot.addEventListener("mousedown", () => {
      cover = document.createElement("div");
      document.body.appendChild(cover);
    });
    const name = (target: EventTarget | null) =>
      target === plot
        ? "plot"
        : target === cover
          ? "cover"
          : target === document.body
            ? "body"
            : "other";
    const events: string[] = [];
    const listeners = new AbortController();
    for (const type of ["mousedown", "mouseup", "click"]) {
      document.addEventListener(
        type,
        (event) => events.push(`${type}@${name(event.target)}`),
        { signal: listeners.signal },
      );
    }
    document.elementsFromPoint = () => (cover ? [cover, plot] : [plot]);
    try {
      const ctx = new ShowcaseContext(host(), { speed: 0 });
      await ctx.clickAt({ x: 10, y: 20 });
    } finally {
      listeners.abort();
      delete (document as Partial<Document>).elementsFromPoint;
    }
    expect(events).toEqual(["mousedown@plot", "mouseup@cover", "click@body"]);
  });

  it("drag presses, moves with the button held and releases at the end", async () => {
    const plot = document.createElement("div");
    document.body.appendChild(plot);
    const log: string[] = [];
    track(plot, log, "plot");
    document.elementsFromPoint = () => [plot];
    try {
      const ctx = new ShowcaseContext(host(), { speed: 0 });
      await ctx.drag({ x: 1, y: 2 }, [
        { x: 5, y: 6 },
        { x: 9, y: 9 },
      ]);
    } finally {
      delete (document as Partial<Document>).elementsFromPoint;
    }
    expect(log).toEqual([
      "plot:mousemove:1,2:0",
      "plot:mousedown:1,2:1",
      "plot:mousemove:5,6:1",
      "plot:mousemove:9,9:1",
      "plot:mouseup:9,9:0",
      "plot:click:9,9:0",
    ]);
  });
});

describe("ShowcaseOverlay", () => {
  it("adds and removes its layer outside the React root", () => {
    const overlay = new ShowcaseOverlay();
    overlay.mount();
    expect(document.documentElement.dataset.showcase).toBe("autoplay");
    overlay.caption("Head", "Hello");
    overlay.card({ title: "Title", subtitle: "Subtitle" });
    const layer = document.querySelector(".showcase-overlay");
    expect(layer?.parentElement).toBe(document.body);
    expect(layer?.querySelector(".showcase-caption-text")?.textContent).toBe(
      "Hello",
    );
    expect(overlay.hasCard()).toBe(true);
    overlay.clearAll();
    expect(layer?.querySelector(".showcase-caption")).toBeNull();
    expect(overlay.hasCard()).toBe(false);
    overlay.unmount();
    expect(document.querySelector(".showcase-overlay")).toBeNull();
    expect(document.documentElement.dataset.showcase).toBeUndefined();
  });
});
