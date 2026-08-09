import { expect, test, type Page } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

const MIB = 1024 * 1024;
const MAX_RECIPE_WASM_GROWTH = 64 * MIB;
const MAX_RETAINED_DATA_RATIO = 3;

async function readVisibleImageRaster(page: Page): Promise<{
  source: string;
  width: number;
  height: number;
  opaquePixels: number;
  distinctColors: number;
}> {
  return page.evaluate(async () => {
    const plot = document.querySelector(".image-plot-host .js-plotly-plot") as
      | (HTMLElement & { layout?: { images?: Array<Record<string, unknown>> } })
      | null;
    const source = String(plot?.layout?.images?.[0]?.source ?? "");
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context?.drawImage(image, 0, 0);
        const pixels = context?.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let opaquePixels = 0;
        const colors = new Set<string>();
        if (pixels) {
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] > 0) opaquePixels += 1;
            if (colors.size < 3) {
              colors.add(
                `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`,
              );
            }
          }
        }
        resolve({
          source,
          width: image.naturalWidth,
          height: image.naturalHeight,
          opaquePixels,
          distinctColors: colors.size,
        });
      };
      image.onerror = () =>
        resolve({
          source,
          width: 0,
          height: 0,
          opaquePixels: 0,
          distinctColors: 0,
        });
      image.src = source;
    });
  });
}

test("bundled Camera workflow renders curve, map, and metrics within budget", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const result = await page.evaluate(async () => {
    const manifest = await window.runtime.getBundledCameraManifest();
    const counts = await window.runtime.openBundledCameraQuickstart();
    const images = await window.runtime.listImages();
    await window.runtime.freeMemory();
    const dataBefore = (await window.runtime.getDataMemoryBytes()) ?? 0;
    const wasmBefore = window.runtime.getMemoryUsage().wasmBytes ?? 0;
    const commit = await window.runtime.runBundledCameraRecipe(
      images.map((image) => image.id),
    );
    const dataAfter = (await window.runtime.getDataMemoryBytes()) ?? 0;
    const wasmAfter = window.runtime.getMemoryUsage().wasmBytes ?? 0;
    return {
      manifest,
      counts,
      commit,
      imageCount: images.length,
      memory: {
        dataBefore,
        dataAfter,
        dataGrowth: dataAfter - dataBefore,
        wasmBefore,
        wasmAfter,
        wasmGrowth: wasmAfter - wasmBefore,
      },
    };
  });

  expect(result.manifest).toEqual({
    plugin_id: "org.datalab.camera-characterization",
    plugin_version: "0.1.0",
    web_status: "untested",
    datalab_web_version: "0.8.0",
    pyodide_version: "0.26.4",
    recipe_id:
      "org.datalab.camera-characterization:relative-dn-characterization",
    recipe_version: "1.1.0",
    quickstart_filename: "camera_quickstart.h5",
  });
  expect(result.counts.images).toBeGreaterThan(0);
  expect(result.counts.images).toBe(result.imageCount);
  expect(result.counts.groups).toBeGreaterThan(0);
  expect(result.commit.objects).toHaveLength(10);
  expect(result.memory.dataBefore).toBeGreaterThan(0);
  expect(result.memory.dataGrowth).toBeGreaterThan(0);
  expect(result.memory.dataGrowth).toBeLessThanOrEqual(
    result.memory.dataBefore * MAX_RETAINED_DATA_RATIO,
  );
  expect(result.memory.wasmGrowth).toBeGreaterThanOrEqual(0);
  expect(result.memory.wasmGrowth).toBeLessThanOrEqual(MAX_RECIPE_WASM_GROWTH);
  console.log(
    `[camera-memory] WASM +${result.memory.wasmGrowth} bytes ` +
      `(${(result.memory.wasmGrowth / MIB).toFixed(2)} MiB); ` +
      `retained data +${result.memory.dataGrowth} bytes ` +
      `(${(result.memory.dataGrowth / MIB).toFixed(2)} MiB) ` +
      `(${(result.memory.dataGrowth / result.memory.dataBefore).toFixed(2)}x input)`,
  );

  await page.getByRole("tab", { name: "Images" }).click();
  await page.getByRole("tab", { name: "Signals" }).click();
  const response = page
    .locator(".object-tree-item")
    .filter({ hasText: "Camera response" })
    .first();
  await expect(response).toBeVisible();
  await response.click();
  await expect(page.locator("g.g-gtitle text").first()).toHaveText(
    "Camera response",
  );
  await expect(
    page.locator(".signal-plot-host .scatterlayer .trace .js-line").first(),
  ).toBeVisible();

  await page.getByRole("tab", { name: /^Results/ }).click();
  await expect(page.locator(".result-card-title")).toHaveText(
    "Relative Camera characterization metrics",
  );
  await expect(page.locator(".result-card-table tbody tr")).toHaveCount(11);
  await expect(page.locator(".result-card-table")).toContainText(
    "Response slope",
  );

  await page.getByRole("tab", { name: "Images" }).click();
  const prnuMap = page
    .locator(".object-tree-item")
    .filter({ hasText: "Relative PRNU-like map" })
    .first();
  await expect(prnuMap).toBeVisible();
  await prnuMap.click();
  await expect(page.locator("g.g-gtitle text").first()).toHaveText(
    "Relative PRNU-like map",
  );
  await expect
    .poll(async () => (await readVisibleImageRaster(page)).opaquePixels, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  const raster = await readVisibleImageRaster(page);
  expect(raster.source).toMatch(/^data:image\/png/);
  expect(raster.width).toBeGreaterThan(1);
  expect(raster.height).toBeGreaterThan(1);
  expect(raster.distinctColors).toBeGreaterThan(1);
});
