import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

/**
 * Opening a workspace mounts the Macros and Notebooks panels afresh, with
 * fresh Python namespaces: the notebook kernel and the macro worker in which
 * code ran are replaced. The replaced workers must be terminated: they used
 * to keep running, so that a long session piled up Pyodide instances and
 * memory. (Workers in which no code ran yet are reused as they are.)
 */

const WORKSPACE = fileURLToPath(
  new URL("../../public/demos/ndt.h5", import.meta.url),
);

/** Number of dedicated workers once it no longer changes for a while. */
async function settledWorkerCount(page: Page): Promise<number> {
  let count = -1;
  let stableSince = Date.now();
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const now = page.workers().length;
    if (now !== count) {
      count = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 10_000) {
      return count;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("The number of workers never settled");
}

/** Run code in the notebook kernel and in the macro worker. */
async function runPythonCode(page: Page, marker: string): Promise<void> {
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await page.locator(".nb-cell-editor .cm-content").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`print("nb-${marker}")`);
  await page.keyboard.press("Control+Enter");
  await expect(
    page.locator(".nb-output-stdout").filter({ hasText: `nb-${marker}` }),
  ).toBeVisible({ timeout: 240_000 });

  await page.getByRole("tab", { name: "Macros" }).click();
  const run = page.getByRole("button", { name: /^▶ Run/ });
  await expect(run).toBeEnabled({ timeout: 10_000 });
  await page.locator(".macro-editor .cm-content").first().click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.type(`print("macro-${marker}")`);
  await run.click();
  await expect(
    page
      .locator(".macro-console-line.stdout")
      .filter({ hasText: `macro-${marker}` }),
  ).toBeVisible({ timeout: 240_000 });
  await expect(run).toBeEnabled({ timeout: 30_000 });
}

async function openWorkspace(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: /Open HDF5 files/i }).click();
  await (await chooser).setFiles(WORKSPACE);
  await expect
    .poll(() => page.title(), { timeout: 60_000 })
    .toBe("DataLab-Web — ndt.h5");
}

test("opening workspaces does not pile up Python workers", async ({ page }) => {
  test.setTimeout(1_200_000);
  page.on("dialog", (dialog) => void dialog.accept());
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);
  // Workers are counted once code ran in the notebook kernel and in the macro
  // worker: the spare macro worker is only started once the macro worker is
  // ready, which may take longer than the settling delay (it would then be
  // missed by the count), and running code makes sure it was started.
  await runPythonCode(page, "0");
  const baseline = await settledWorkerCount(page);
  // Notebook kernel, macro worker and its spare (+ the runtime workers).
  expect(baseline).toBeGreaterThanOrEqual(3);

  for (let open = 1; open <= 2; open++) {
    await openWorkspace(page);
    // The workers in which code ran are replaced: the replaced ones must be
    // terminated, so that the count does not grow.
    await runPythonCode(page, `${open}`);
    expect(await settledWorkerCount(page), `after opening #${open}`).toBe(
      baseline,
    );
  }
});
