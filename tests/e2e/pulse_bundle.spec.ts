import { expect, test } from "@playwright/test";

import type { DataLabRuntime } from "../../src/runtime/runtime";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

const MIB = 1024 * 1024;
const INPUT_DATA_BYTES = 4_008_000;
const OUTPUT_DATA_BYTES = 24_032;
const MAX_RECIPE_WASM_GROWTH = 64 * MIB;
const PULSE_PLUGIN_ID = "org.datalab.pulse-characterization";
const PULSE_RECIPE_ID = `${PULSE_PLUGIN_ID}:single-channel-campaign`;

test("bundled Pulse workflow renders campaign curves and metrics within budget", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const result = await page.evaluate(async () => {
    const plugin = (await window.runtime.listPlugins()).find(
      (record) => record.plugin_id === "org.datalab.pulse-characterization",
    );
    if (!plugin) throw new Error("Bundled Pulse plugin was not registered");
    const recipe = plugin.recipes.find(
      (item) =>
        item.id ===
        "org.datalab.pulse-characterization:single-channel-campaign",
    );
    if (!recipe) throw new Error("Bundled Pulse recipe was not registered");
    const example = plugin.examples.find((item) => item.id === "demo");
    if (!example) throw new Error("Bundled Pulse example was not registered");
    const opened = await window.runtime.openPluginExample(
      plugin.plugin_id!,
      example.id,
    );
    const prepared = await window.runtime.preparePluginRecipe(
      plugin.plugin_id!,
      recipe.id,
      opened.selected_ids,
    );
    await window.runtime.freeMemory();
    const dataBefore = (await window.runtime.getDataMemoryBytes()) ?? 0;
    const wasmBefore = window.runtime.getMemoryUsage().wasmBytes ?? 0;
    const commit = await window.runtime.runPluginRecipe(
      plugin.plugin_id!,
      recipe.id,
      prepared.bindings,
      opened.parameter_values,
    );
    const dataAfter = (await window.runtime.getDataMemoryBytes()) ?? 0;
    const wasmAfter = window.runtime.getMemoryUsage().wasmBytes ?? 0;
    const anchorId = commit.objects.find(
      (output) => output.output_id === "amplitude_vs_shot",
    )?.id;
    if (!anchorId) throw new Error("Pulse amplitude output was not committed");
    const [metrics] = await window.runtime.listSignalResults(anchorId);
    if (!metrics || metrics.category !== "table") {
      throw new Error("Pulse metrics table was not committed");
    }
    const statusIndex = metrics.headers.indexOf("Status");
    const alignedIndex = metrics.headers.indexOf("Aligned");
    const statusCounts: Record<string, number> = {};
    let alignedCount = 0;
    for (const row of metrics.data) {
      const status = String(row[statusIndex]);
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      if (row[alignedIndex]) alignedCount += 1;
    }
    return {
      plugin,
      recipe,
      example,
      opened,
      prepared,
      commit,
      metrics: {
        rowCount: metrics.data.length,
        columnCount: metrics.headers.length,
        statusCounts,
        alignedCount,
      },
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

  expect(result.plugin).toMatchObject({
    plugin_id: PULSE_PLUGIN_ID,
    version: "0.1.0",
    source: "bundled-wheel",
    trust: "verified",
    enabled: true,
    loaded: true,
  });
  expect(result.recipe).toMatchObject({
    id: PULSE_RECIPE_ID,
    version: "1.1.0",
  });
  expect(result.example.recipe_id).toBe(PULSE_RECIPE_ID);
  expect(result.opened.signals).toBe(500);
  expect(result.opened.selected_ids).toHaveLength(500);
  expect(result.prepared.bindings.signals).toHaveLength(500);
  expect(result.prepared.ambiguous_slots).toEqual([]);
  expect(result.prepared.missing_slots).toEqual([]);
  expect(result.commit.objects).toHaveLength(3);
  expect(result.metrics).toEqual({
    rowCount: 500,
    columnCount: 23,
    statusCounts: {
      VALID: 489,
      NO_PULSE: 2,
      LOW_SNR: 2,
      SATURATED: 2,
      MULTIPLE_PULSES: 2,
      OUTLIER: 3,
    },
    alignedCount: 489,
  });
  expect(result.memory.dataBefore).toBe(INPUT_DATA_BYTES);
  expect(result.memory.dataGrowth).toBe(OUTPUT_DATA_BYTES);
  expect(result.memory.wasmGrowth).toBeGreaterThanOrEqual(0);
  expect(result.memory.wasmGrowth).toBeLessThanOrEqual(MAX_RECIPE_WASM_GROWTH);
  console.log(
    `[pulse-memory] WASM +${result.memory.wasmGrowth} bytes ` +
      `(${(result.memory.wasmGrowth / MIB).toFixed(2)} MiB); ` +
      `retained data +${result.memory.dataGrowth} bytes ` +
      `(${(result.memory.dataGrowth / MIB).toFixed(2)} MiB)`,
  );

  await page.getByRole("tab", { name: "Images" }).click();
  await page.getByRole("tab", { name: "Signals" }).click();
  for (const title of [
    "Pulse amplitude vs shot",
    "Raw pulse campaign mean",
    "Aligned pulse campaign mean",
  ]) {
    const output = page
      .locator(".object-tree-item")
      .filter({ hasText: title })
      .first();
    await expect(output).toBeVisible();
    await output.click();
    await expect(page.locator("g.g-gtitle text").first()).toHaveText(title);
    await expect(
      page.locator(".signal-plot-host .scatterlayer .trace .js-line").first(),
    ).toBeVisible();
  }

  const amplitude = page
    .locator(".object-tree-item")
    .filter({ hasText: "Pulse amplitude vs shot" })
    .first();
  await amplitude.click();
  await page.getByRole("tab", { name: /^Results/ }).click();
  await expect(page.locator(".result-card-title")).toHaveText(
    "Pulse campaign shot metrics",
  );
  await expect(page.locator(".result-card-table thead th")).toHaveCount(24);
  await expect(page.locator(".result-card-table tbody tr")).toHaveCount(500);
  for (const status of [
    "VALID",
    "NO_PULSE",
    "LOW_SNR",
    "SATURATED",
    "MULTIPLE_PULSES",
    "OUTLIER",
  ]) {
    await expect(page.locator(".result-card-table")).toContainText(status);
  }
});
