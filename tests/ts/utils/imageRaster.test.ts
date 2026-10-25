/**
 * Rasterisation of zoomed-in images: the painted window is magnified onto a
 * larger canvas without smoothing, so each image pixel becomes a sharp block
 * whatever the browser (and in exported PNG images), and the views draw the
 * enlarged bitmap with nearest-pixel scaling (``image-rendering: pixelated``)
 * only when it shows real pixels enlarged on screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  planImageRaster,
  rasterizeImage,
  showsCrispPixels,
} from "../../../src/utils/imageRaster";

interface FakeContext {
  canvas: HTMLCanvasElement;
  imageSmoothingEnabled: boolean;
  drawImage: ReturnType<typeof vi.fn>;
  createImageData: (w: number, h: number) => ImageData;
  putImageData: () => void;
}

let contexts: FakeContext[] = [];
let refuseMagnifiedContext = false;

beforeEach(() => {
  contexts = [];
  refuseMagnifiedContext = false;
  HTMLCanvasElement.prototype.getContext = vi.fn(function (
    this: HTMLCanvasElement,
  ) {
    if (refuseMagnifiedContext && contexts.length > 0) return null;
    const context: FakeContext = {
      canvas: this,
      imageSmoothingEnabled: true,
      drawImage: vi.fn(),
      createImageData: (w: number, h: number) =>
        ({
          data: new Uint8ClampedArray(w * h * 4),
          width: w,
          height: h,
        }) as ImageData,
      putImageData: () => {},
    };
    contexts.push(context);
    return context;
  }) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = vi.fn(function (
    this: HTMLCanvasElement,
  ) {
    return `data:image/png;${this.width}x${this.height}`;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function ramp(width: number, height: number): Float32Array[] {
  return Array.from({ length: height }, (_, j) =>
    Float32Array.from({ length: width }, (_, i) => j * width + i),
  );
}

function rasterize(
  width: number,
  height: number,
  plotPx: { w: number; h: number },
) {
  return rasterizeImage({
    rows: ramp(width, height),
    geometry: { width, height, x0: 0, y0: 0, dx: 1, dy: 1 },
    view: null,
    plotPx,
    dpr: 1,
    lut: [0, width * height - 1],
    colormap: "gray",
    inverted: false,
    resampleMethod: "nearest",
  });
}

describe("rasterizeImage magnification", () => {
  it("draws zoomed-in pixels as blocks without smoothing", () => {
    const raster = rasterize(4, 4, { w: 400, h: 400 });
    // Painted 1:1 on a 4×4 canvas, then magnified ×100 without smoothing.
    expect(contexts).toHaveLength(2);
    const [painted, magnified] = contexts;
    expect(painted.canvas.width).toBe(4);
    expect(magnified.canvas.width).toBe(400);
    expect(magnified.canvas.height).toBe(400);
    expect(magnified.imageSmoothingEnabled).toBe(false);
    expect(magnified.drawImage).toHaveBeenCalledWith(
      painted.canvas,
      0,
      0,
      400,
      400,
    );
    expect(raster?.source).toBe("data:image/png;400x400");
    // The bitmap keeps the physical extent of the image.
    expect(raster?.placement).toEqual({
      x: -0.5,
      dx: 1,
      y: -0.5,
      dy: 1,
      cw: 4,
      ch: 4,
    });
  });

  it("encodes the painted bitmap when not zoomed in", () => {
    const raster = rasterize(1000, 1000, { w: 800, h: 800 });
    expect(contexts).toHaveLength(1);
    expect(contexts[0].drawImage).not.toHaveBeenCalled();
    expect(raster?.source).toBe("data:image/png;1000x1000");
  });

  it("falls back to the painted bitmap without a 2D context to magnify", () => {
    refuseMagnifiedContext = true;
    const raster = rasterize(4, 4, { w: 400, h: 400 });
    expect(raster?.source).toBe("data:image/png;4x4");
    expect(raster?.placement.cw).toBe(4);
  });
});

describe("showsCrispPixels", () => {
  const geometry = (width: number, height: number) => ({
    width,
    height,
    x0: 0,
    y0: 0,
    dx: 1,
    dy: 1,
  });
  const fullView = (width: number, height: number) => ({
    x: [-0.5, width - 0.5] as [number, number],
    y: [height - 0.5, -0.5] as [number, number],
  });

  it("is set for magnified pixels", () => {
    const raster = planImageRaster(
      geometry(4, 4),
      null,
      { w: 400, h: 400 },
      1,
    )!;
    expect(
      showsCrispPixels(raster, fullView(4, 4), { w: 400, h: 400 }, 1),
    ).toBe(true);
  });

  it("is set for 1:1 pixels slightly enlarged on screen", () => {
    // 300 pixels over 400 device pixels: not magnified (< 2 per pixel) but
    // still enlarged, and nearest-pixel scaling keeps them sharp.
    const raster = planImageRaster(
      geometry(300, 300),
      null,
      { w: 400, h: 400 },
      1,
    )!;
    expect(raster.plan.zoomX).toBe(1);
    expect(
      showsCrispPixels(raster, fullView(300, 300), { w: 400, h: 400 }, 1),
    ).toBe(true);
  });

  it("is not set for a bitmap reduced on screen", () => {
    // 1000 pixels painted 1:1 over 800 device pixels: nearest-pixel
    // downscaling would alias the image.
    const raster = planImageRaster(
      geometry(1000, 1000),
      null,
      { w: 800, h: 800 },
      1,
    )!;
    expect(
      showsCrispPixels(raster, fullView(1000, 1000), { w: 800, h: 800 }, 1),
    ).toBe(false);
  });

  it("is not set for a decimated bitmap", () => {
    // 2000² image (LOD) decimated ×3 to 667 cells over 800 device pixels:
    // enlarged, but each cell aggregates several pixels.
    const raster = planImageRaster(
      geometry(2000, 2000),
      null,
      { w: 800, h: 800 },
      1,
    )!;
    expect(raster.plan.strideX).toBe(3);
    expect(
      showsCrispPixels(raster, fullView(2000, 2000), { w: 800, h: 800 }, 1),
    ).toBe(false);
  });

  it("accounts for the device pixel ratio", () => {
    // 1000 pixels over 800 CSS pixels at DPR 1.5 = 1200 device pixels.
    const raster = planImageRaster(
      geometry(1000, 1000),
      null,
      { w: 800, h: 800 },
      1.5,
    )!;
    expect(
      showsCrispPixels(raster, fullView(1000, 1000), { w: 800, h: 800 }, 1.5),
    ).toBe(true);
  });
});
