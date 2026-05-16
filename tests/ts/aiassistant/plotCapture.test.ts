/**
 * Tests for ``src/aiassistant/plotCapture.ts``.
 *
 * Covers the panel registry (last-write-wins, unregistration on
 * unmount) and the ``capturePlotPng`` happy path with a stubbed
 * ``window.Plotly``.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetRegistryForTests,
  capturePlotPng,
  getMostRecentPanel,
  registerActivePlot,
  resolveGraphDiv,
} from "../../../src/aiassistant/plotCapture";

afterEach(() => {
  _resetRegistryForTests();
  vi.unstubAllGlobals();
});

describe("plotCapture", () => {
  it("getMostRecentPanel returns null when no plot is mounted", () => {
    expect(getMostRecentPanel()).toBeNull();
  });

  it("tracks the most recently registered panel", () => {
    const gd1 = document.createElement("div");
    const gd2 = document.createElement("div");
    registerActivePlot("signal", gd1);
    expect(getMostRecentPanel()).toBe("signal");
    registerActivePlot("image", gd2);
    expect(getMostRecentPanel()).toBe("image");
    expect(resolveGraphDiv("signal")).toBe(gd1);
    expect(resolveGraphDiv("image")).toBe(gd2);
  });

  it("unregisters the panel when called with null", () => {
    registerActivePlot("signal", document.createElement("div"));
    registerActivePlot("signal", null);
    expect(getMostRecentPanel()).toBeNull();
    expect(resolveGraphDiv("signal")).toBeNull();
  });

  it("capturePlotPng forwards to window.Plotly.toImage and returns a data URL", async () => {
    const gd = document.createElement("div");
    Object.defineProperty(gd, "clientWidth", {
      value: 640,
      configurable: true,
    });
    Object.defineProperty(gd, "clientHeight", {
      value: 480,
      configurable: true,
    });
    registerActivePlot("signal", gd);
    const toImage = vi.fn(async () => "data:image/png;base64,AAAA");
    vi.stubGlobal("window", { ...window, Plotly: { toImage } });
    const shot = await capturePlotPng({});
    expect(toImage).toHaveBeenCalledWith(
      gd,
      expect.objectContaining({ format: "png", width: 640, height: 480 }),
    );
    expect(shot.panel).toBe("signal");
    expect(shot.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(shot.pngBase64).toBe("AAAA");
  });

  it("capturePlotPng throws when no plot is mounted for the requested panel", async () => {
    await expect(capturePlotPng({ panel: "signal" })).rejects.toThrow(
      /No 'signal' plot/,
    );
  });
});
