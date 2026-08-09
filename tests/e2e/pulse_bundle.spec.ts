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

test("bundled Pulse workflow renders campaign curves and metrics within budget", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  const result = await page.evaluate(async () => {
    const manifest = await window.runtime.getBundledPulseManifest();
    const demo = await window.runtime.createBundledPulseDemo();
    await window.runtime.freeMemory();
    const dataBefore = (await window.runtime.getDataMemoryBytes()) ?? 0;
    const wasmBefore = window.runtime.getMemoryUsage().wasmBytes ?? 0;
    const commit = await window.runtime.runBundledPulseRecipe(
      demo.signal_ids,
      demo.parameter_values,
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
      manifest,
      demoCount: demo.signal_count,
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

  expect(result.manifest).toEqual({
    plugin_id: "org.datalab.pulse-characterization",
    plugin_version: "0.1.0",
    web_status: "verified",
    datalab_web_version: "0.8.0",
    pyodide_version: "0.26.4",
    recipe_id: "org.datalab.pulse-characterization:single-channel-campaign",
    recipe_version: "1.1.0",
  });
  expect(result.demoCount).toBe(500);
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
