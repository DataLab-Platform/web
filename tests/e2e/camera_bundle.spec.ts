import { expect, test } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

test("bundled Camera wheel imports and opens its HDF5 quickstart", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const result = await page.evaluate(async () => {
    const manifest = await window.runtime.getBundledCameraManifest();
    const counts = await window.runtime.openBundledCameraQuickstart();
    const images = await window.runtime.listImages();
    return { manifest, counts, imageCount: images.length };
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
});
