import { describe, expect, it } from "vitest";
import {
  preloadFilename,
  preloadPanelKind,
  resolvePanelKind,
  resolvePreloadUrl,
} from "../../../src/utils/preload";

const BASE = "https://datalab-platform.com/web/index.html";

describe("resolvePreloadUrl", () => {
  it("returns null when the parameter is absent", () => {
    expect(resolvePreloadUrl("", BASE)).toBeNull();
    expect(resolvePreloadUrl("?lang=fr", BASE)).toBeNull();
  });

  it("resolves relative URLs against the base", () => {
    const url = resolvePreloadUrl("?preload=demos/spectroscopy.h5", BASE);
    expect(url?.href).toBe(
      "https://datalab-platform.com/web/demos/spectroscopy.h5",
    );
  });

  it("accepts same-origin absolute URLs", () => {
    const url = resolvePreloadUrl(
      "?preload=https://datalab-platform.com/web/demos/ndt.h5",
      BASE,
    );
    expect(url?.href).toBe("https://datalab-platform.com/web/demos/ndt.h5");
  });

  it("rejects cross-origin URLs", () => {
    expect(
      resolvePreloadUrl("?preload=https://evil.example.com/x.h5", BASE),
    ).toBeNull();
    expect(
      resolvePreloadUrl("?preload=//evil.example.com/x.h5", BASE),
    ).toBeNull();
  });

  it("rejects non-http(s) schemes", () => {
    expect(resolvePreloadUrl("?preload=file:///etc/passwd", BASE)).toBeNull();
    // Scheme-relative data/blob URLs never share the page origin anyway.
    expect(resolvePreloadUrl("?preload=data:text/plain,x", BASE)).toBeNull();
  });

  it("keeps other query parameters out of the way", () => {
    const url = resolvePreloadUrl(
      "?lang=fr&preload=demos/a.h5&runtime=main",
      BASE,
    );
    expect(url?.pathname).toBe("/web/demos/a.h5");
  });
});

describe("preloadFilename", () => {
  it("extracts the last path segment", () => {
    const url = new URL("https://x.test/web/demos/spectroscopy.h5");
    expect(preloadFilename(url)).toBe("spectroscopy.h5");
  });

  it("falls back to workspace.h5 for empty paths", () => {
    expect(preloadFilename(new URL("https://x.test/"))).toBe("workspace.h5");
  });
});

describe("resolvePanelKind", () => {
  it("parses signal and image (case-insensitive)", () => {
    expect(resolvePanelKind("?panel=image")).toBe("image");
    expect(resolvePanelKind("?panel=Signal")).toBe("signal");
  });

  it("ignores absent or unknown values", () => {
    expect(resolvePanelKind("")).toBeNull();
    expect(resolvePanelKind("?panel=macro")).toBeNull();
    expect(resolvePanelKind("?preload=demos/a.h5")).toBeNull();
  });
});

describe("preloadPanelKind", () => {
  it("lets an explicit ?panel= win over content", () => {
    expect(preloadPanelKind("?panel=signal", { signals: 0, images: 3 })).toBe(
      "signal",
    );
  });

  it("switches to the only non-empty panel", () => {
    expect(preloadPanelKind("", { signals: 0, images: 3 })).toBe("image");
    expect(preloadPanelKind("", { signals: 2, images: 0 })).toBe("signal");
  });

  it("stays put for mixed or empty workspaces", () => {
    expect(preloadPanelKind("", { signals: 2, images: 3 })).toBeNull();
    expect(preloadPanelKind("", { signals: 0, images: 0 })).toBeNull();
  });
});
