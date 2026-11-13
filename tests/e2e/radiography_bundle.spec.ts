import { expect, test } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

const MIB = 1024 * 1024;
const MAX_WORKFLOW_WASM_GROWTH = 128 * MIB;
const RADIOGRAPHY = "org.datalab.radiography";
const PLUGIN_MENU = "Plugins/X-ray Radiography & NDT";

test("bundled Radiography plugin displays, processes and analyses radiographs", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const result = await page.evaluate(async (pluginId) => {
    const runtime = window.runtime;
    const plugin = (await runtime.listPlugins()).find(
      (record) => record.plugin_id === pluginId,
    );
    if (!plugin)
      throw new Error("Bundled Radiography plugin was not registered");
    const features = (await runtime.listFeatures()).filter((feature) =>
      feature.id.startsWith(`${pluginId}:`),
    );
    const analyses = (await runtime.listImageAnalysis()).filter((entry) =>
      entry.id.startsWith(`${pluginId}:`),
    );
    await runtime.freeMemory();
    const wasmBefore = runtime.getMemoryUsage().wasmBytes ?? 0;
    const opened = await runtime.openPluginExample(pluginId, "simulated-weld");
    const weldId = opened.selected_ids[0];
    const weld = await runtime.getImageData(weldId);
    const window_ = await runtime.getLutRange(weldId);
    const [flatId] = await runtime.applyFeature(
      `${pluginId}:flatten-background`,
      [weldId],
      null,
      { size: 3.0, unit: "mm" },
    );
    const flat = await runtime.getImageData(flatId);
    const snr = await runtime.runImageAnalysis(weldId, `${pluginId}:snr`, {
      srb_um: 140.0,
    });
    await runtime.setColormap(weldId, "viridis", true);
    const added = await runtime.launchPluginTool(
      pluginId,
      "radiographic-display",
      [weldId],
    );
    const redisplayed = await runtime.getImageData(weldId);
    const wasmAfter = runtime.getMemoryUsage().wasmBytes ?? 0;
    return {
      plugin: {
        version: plugin.version,
        source: plugin.source,
        trust: plugin.trust,
        loaded: plugin.loaded,
        capabilities: plugin.info?.capabilities,
        recipes: plugin.recipes.map((recipe) => recipe.id),
        examples: plugin.examples.map((example) => example.id),
        tools: plugin.tools.map((tool) => tool.id),
      },
      featureMenus: Object.fromEntries(
        features.map((feature) => [feature.id, feature.menu_path]),
      ),
      analysisMenus: Object.fromEntries(
        analyses.map((entry) => [entry.id, entry.menu_path]),
      ),
      weld: {
        colormap: weld.colormap,
        invert: weld.invert_colormap,
        window: window_,
      },
      flatColormap: flat.colormap,
      snrTitle: snr?.title,
      added,
      redisplayed: {
        colormap: redisplayed.colormap,
        invert: redisplayed.invert_colormap,
      },
      wasmGrowth: wasmAfter - wasmBefore,
    };
  }, RADIOGRAPHY);

  expect(result.plugin).toMatchObject({
    version: "0.1.0",
    source: "bundled-wheel",
    trust: "verified",
    loaded: true,
    capabilities: ["application", "processing", "visualization"],
  });
  expect(result.plugin.recipes).toContain(`${RADIOGRAPHY}:duplex-iqi`);
  expect(result.plugin.examples).toEqual(
    expect.arrayContaining(["simulated-weld", "walnut", "knee-phantom"]),
  );
  expect(result.plugin.tools).toEqual(
    expect.arrayContaining(["xray-simulator", "magnification-value"]),
  );
  expect(result.featureMenus[`${RADIOGRAPHY}:flatten-background`]).toBe(
    `${PLUGIN_MENU}/Enhancement/Flatten background`,
  );
  expect(result.analysisMenus[`${RADIOGRAPHY}:snr`]).toBe(
    `${PLUGIN_MENU}/Image quality/Signal-to-noise ratio`,
  );
  expect(result.weld.colormap).toBe("gray");
  expect(result.weld.invert).toBe(false);
  expect(result.weld.window).not.toBeNull();
  expect(result.flatColormap).toBe("gray");
  expect(result.snrTitle).toBe("SNR");
  expect(result.added).toEqual({ signal: [], image: [] });
  expect(result.redisplayed).toEqual({ colormap: "gray", invert: false });
  expect(result.wasmGrowth).toBeLessThanOrEqual(MAX_WORKFLOW_WASM_GROWTH);
  console.log(
    `[radiography-memory] WASM +${result.wasmGrowth} bytes ` +
      `(${(result.wasmGrowth / MIB).toFixed(2)} MiB)`,
  );

  // The plugin analyses are listed in the plugin menu, as on DataLab Desktop
  await page.getByRole("tab", { name: "Images" }).click();
  await page.getByRole("menuitem", { name: "Plugins" }).click();
  await page.getByRole("menuitem", { name: "X-ray Radiography & NDT" }).hover();
  await page.getByRole("menuitem", { name: "Image quality" }).hover();
  await expect(
    page.getByRole("menuitem", { name: "Signal-to-noise ratio…" }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", {
      name: "Basic spatial resolution (duplex IQI)",
    }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
