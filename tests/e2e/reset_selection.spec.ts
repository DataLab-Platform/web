import { expect, test, type Page } from "@playwright/test";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

import type { DataLabRuntime } from "../../src/runtime/runtime";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

/**
 * Resetting the whole workspace from outside the UI — ``reset_all`` of the
 * remote-control API (embedding host) or of the showcase — deletes the
 * objects shown and selected in the UI. The UI must drop that selection
 * before it re-reads the displayed object: it used to ask Python for the
 * view snapshot and the ROIs of deleted objects, which logged errors
 * (``get_signal_view_snapshot`` / ``objects_have_roi``: unknown object).
 */

/** Python-side failures logged in the browser console. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("a reset_all from outside the UI drops the selection without errors", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);
  const errors = collectErrors(page);

  // Two signals, both selected and displayed.
  await page.evaluate(async () => {
    const x = Array.from({ length: 64 }, (_, i) => i);
    for (const title of ["reset-a", "reset-b"]) {
      await window.runtime.addSignalFromArrays({
        title,
        xdata: x,
        ydata: x.map((v) => Math.sin(v / 5)),
      });
    }
    window.dispatchEvent(
      new CustomEvent("datalab-web:remote-model-changed", {
        detail: { panel: "signal" },
      }),
    );
  });
  const items = page.locator(".object-tree-item");
  await expect(items).toHaveCount(2);
  await items.nth(0).click();
  await items.nth(1).click({ modifiers: ["Shift"] });
  await expect(page.locator(".object-tree-item.selected")).toHaveCount(2);
  await expect(page.locator(".plot-area .js-plotly-plot")).toBeVisible();

  // What the remote-control bridge does on ``reset_all``.
  await page.evaluate(async () => {
    await window.runtime.resetAll();
    window.dispatchEvent(
      new CustomEvent("datalab-web:remote-model-changed", {
        detail: { panel: null },
      }),
    );
  });
  await expect(items).toHaveCount(0);
  // Let every view settle (snapshot fetches are debounced).
  await page.waitForTimeout(1_500);
  expect(
    errors.filter((text) =>
      /get_signal_view_snapshot|objects_have_roi|KeyError|not found/i.test(
        text,
      ),
    ),
  ).toEqual([]);
});
