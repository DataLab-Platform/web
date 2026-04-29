/**
 * Unit tests for the canvas-based colormap helper used by
 * :class:`MultiImagePlot`.  We don't try to validate exact RGB
 * fidelity against matplotlib (the polynomial fits are intentionally
 * approximate); instead we verify the invariants the multi-image grid
 * actually relies on: monotonic luminance ramp, correct extremes,
 * NaN → transparent, ``inverted`` flips the ramp, and unknown
 * colormap names fall back gracefully.
 */
import { describe, it, expect } from "vitest";
import { paintImageData } from "../../../src/utils/colormap";

/** Minimal stand-in for ``CanvasRenderingContext2D.createImageData``
 *  so the helper runs under jsdom (which lacks the 2D context). */
function fakeCtx() {
  return {
    createImageData(w: number, h: number) {
      return {
        width: w,
        height: h,
        data: new Uint8ClampedArray(w * h * 4),
        colorSpace: "srgb" as const,
      };
    },
  } as unknown as CanvasRenderingContext2D;
}

describe("paintImageData", () => {
  it("maps zmin/zmax to colormap endpoints (Viridis)", () => {
    const ctx = fakeCtx();
    const z = new Float32Array([0, 1]);
    const img = paintImageData(ctx, z, 2, 1, 0, 1, "Viridis", false);
    // Viridis goes from dark purple (low) to yellow (high).
    const lo = [img.data[0], img.data[1], img.data[2]];
    const hi = [img.data[4], img.data[5], img.data[6]];
    // Low end is dark; high end is bright.
    const lumLo = lo[0] + lo[1] + lo[2];
    const lumHi = hi[0] + hi[1] + hi[2];
    expect(lumHi).toBeGreaterThan(lumLo);
    // Alpha is fully opaque.
    expect(img.data[3]).toBe(255);
    expect(img.data[7]).toBe(255);
  });

  it("inverts the colormap when requested", () => {
    const ctx = fakeCtx();
    const z = new Float32Array([0, 1]);
    const normal = paintImageData(ctx, z, 2, 1, 0, 1, "Viridis", false);
    const flipped = paintImageData(ctx, z, 2, 1, 0, 1, "Viridis", true);
    // First pixel of inverted == last pixel of normal.
    expect(Array.from(flipped.data.slice(0, 3))).toEqual(
      Array.from(normal.data.slice(4, 7)),
    );
  });

  it("clamps out-of-range values", () => {
    const ctx = fakeCtx();
    const z = new Float32Array([-10, 0, 5, 100]);
    const img = paintImageData(ctx, z, 4, 1, 0, 5, "Viridis", false);
    // Below zmin clamps to the same colour as zmin.
    expect(Array.from(img.data.slice(0, 3))).toEqual(
      Array.from(img.data.slice(4, 7)),
    );
    // Above zmax clamps to the same colour as zmax.
    expect(Array.from(img.data.slice(8, 11))).toEqual(
      Array.from(img.data.slice(12, 15)),
    );
  });

  it("renders NaN pixels as fully transparent", () => {
    const ctx = fakeCtx();
    const z = new Float32Array([0, NaN]);
    const img = paintImageData(ctx, z, 2, 1, 0, 1, "Viridis", false);
    expect(img.data[3]).toBe(255); // valid pixel opaque
    expect(img.data[7]).toBe(0); // NaN pixel transparent
  });

  it("supports the Gray colormap as identity ramp", () => {
    const ctx = fakeCtx();
    const z = new Float32Array([0, 0.5, 1]);
    const img = paintImageData(ctx, z, 3, 1, 0, 1, "Gray", false);
    // R == G == B for all three pixels.
    for (let i = 0; i < 3; i += 1) {
      const off = i * 4;
      expect(img.data[off]).toBe(img.data[off + 1]);
      expect(img.data[off + 1]).toBe(img.data[off + 2]);
    }
  });

  it("falls back to Viridis for unknown colormap names", () => {
    const ctx = fakeCtx();
    const z = new Float32Array([0, 1]);
    const unknown = paintImageData(ctx, z, 2, 1, 0, 1, "NotAColormap", false);
    const viridis = paintImageData(ctx, z, 2, 1, 0, 1, "Viridis", false);
    expect(Array.from(unknown.data)).toEqual(Array.from(viridis.data));
  });
});
