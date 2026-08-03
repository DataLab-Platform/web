import { expect, test, type Page } from "@playwright/test";

import {
  disableQuickstartTemplate,
  forceSaveDownloadFallback,
  waitForRuntimeReady,
} from "./fixtures";

const APP_URL = "http://127.0.0.1:4174/tools/datalab/";
const APP_ORIGIN = new URL(APP_URL).origin;

async function confirmProcessingDialog(page: Page): Promise<void> {
  const dialog = page.locator(".dataset-dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  await dialog.getByRole("button", { name: "OK" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });
}

async function runCommand(page: Page, query: string, label: RegExp) {
  await page.keyboard.press("Control+k");
  const input = page.locator(".command-palette-input");
  await expect(input).toBeVisible();
  await input.fill(query);
  await page
    .locator(".command-palette-item")
    .filter({
      has: page.locator(".command-palette-label", { hasText: label }),
    })
    .first()
    .click();
}

test("offline package boots every runtime without external requests", async ({
  page,
}) => {
  const externalRequests: string[] = [];
  await disableQuickstartTemplate(page);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== APP_ORIGIN
    ) {
      externalRequests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  await page.goto(APP_URL);
  await waitForRuntimeReady(page);
  await expect(page.locator(".status")).toHaveText("Ready");

  await page.locator('[data-menu-top="Help"]').click();
  await page.getByRole("menuitem", { name: /About DataLab Web/i }).click();
  const diagnostics = page.locator(".help-runtime-diagnostics");
  await expect(diagnostics).toContainText("local");
  await expect(diagnostics).toContainText("0.26.4");
  await expect(diagnostics).toContainText("1.1.6");
  await expect(diagnostics).toContainText("3.14.4");
  await expect(diagnostics).toContainText("2024.12.12");
  await expect(diagnostics).toContainText("worker");
  await expect(diagnostics).toContainText("Available");
  await page.getByRole("button", { name: "Close" }).click();

  const createObject = async (kind: "Signals" | "Images", pattern: RegExp) => {
    await page.getByRole("tab", { name: kind }).click();
    await page.locator('[data-menu-top="Create"]').click();
    await page
      .locator(".menu-dropdown")
      .getByRole("menuitem", { name: pattern })
      .first()
      .click();
    await expect(page.locator(".object-tree-item").first()).toBeVisible();
  };
  await createObject("Signals", /sine/i);
  await page.locator(".object-tree-item").first().click();
  await runCommand(page, "fft", /^FFT$/);
  await expect(page.locator(".object-tree-item")).toHaveCount(2);

  await createObject("Images", /sinc/i);
  await page.locator(".object-tree-item").first().click();
  await runCommand(page, "canny", /^Canny filter/);
  await confirmProcessingDialog(page);
  await expect(page.locator(".object-tree-item")).toHaveCount(2);

  await page.getByRole("tab", { name: "Signals" }).click();
  await page.locator('[data-menu-top="Plugins"]').click();
  await page
    .locator(".menu-dropdown")
    .getByRole("menuitem", { name: /^Test data/ })
    .hover();
  await page
    .locator(".menu-dropdown")
    .getByRole("menuitem", { name: /Load spectrum of paracetamol/i })
    .click();
  await expect(
    page.locator(".object-tree-item").filter({ hasText: /paracetamol/i }),
  ).toBeVisible();

  const memory = page.locator(".memory-usage-indicator");
  await expect(memory).toBeVisible();
  await memory.click();
  const storeOnDisk = page.getByRole("menuitemcheckbox", {
    name: "Store data on disk",
  });
  await expect(storeOnDisk).toBeEnabled();
  await storeOnDisk.click();
  const storageNotice = page
    .getByRole("dialog")
    .filter({ hasText: "On-disk storage enabled" });
  await expect(storageNotice).toContainText("On-disk storage enabled");
  await storageNotice.getByRole("button", { name: "OK" }).click();
  await memory.click();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Store data on disk" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await page.locator('[data-menu-top="Help"]').click();
  await page.getByRole("menuitem", { name: /About DataLab Web/i }).click();
  const diskDiagnostics = page.locator(".help-runtime-diagnostics");
  await expect(diskDiagnostics).toContainText("disk");
  const spilled = diskDiagnostics
    .locator("dt", { hasText: "Objects stored on disk" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(spilled).toHaveText(/[1-9][0-9]*/);
  const opfsBytes = diskDiagnostics
    .locator("dt", { hasText: "OPFS bytes" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(opfsBytes).toHaveText(/[1-9][0-9]*/);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("tab", { name: "Signals" }).click();
  const sine = page
    .locator(".object-tree-item")
    .filter({ hasText: /^sine/ })
    .first();
  await sine.click();
  await page.locator('[data-menu-top="ROI"]').click();
  await page
    .getByRole("menuitem", { name: /Edit regions of interest/i })
    .click();
  const roiEditor = page.locator(".roi-floating");
  await expect(roiEditor).toBeVisible();
  await roiEditor.getByRole("button", { name: /Add/ }).click();
  await expect(roiEditor.locator(".roi-list > li")).toHaveCount(1);
  await roiEditor.getByRole("button", { name: "Close ROI editor" }).click();

  await forceSaveDownloadFallback(page);
  const csvDownloadPromise = page.waitForEvent("download");
  await page.locator('[data-menu-top="File"]').click();
  await page.getByRole("menuitem", { name: /Save signal/i }).click();
  const csvPrompt = page
    .getByRole("dialog")
    .filter({ hasText: "File extension" });
  await expect(csvPrompt).toBeVisible();
  await csvPrompt.getByRole("button", { name: "OK" }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/i);
  const csvPath = test.info().outputPath(csvDownload.suggestedFilename());
  await csvDownload.saveAs(csvPath);
  const signalCountBeforeCsv = await page.locator(".object-tree-item").count();
  const csvChooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-menu-top="File"]').click();
  await page.getByRole("menuitem", { name: /^Open signal…$/i }).click();
  await (await csvChooserPromise).setFiles(csvPath);
  await expect(page.locator(".object-tree-item")).toHaveCount(
    signalCountBeforeCsv + 1,
  );

  await page.getByRole("tab", { name: "Images" }).click();
  await page.locator(".object-tree-item").first().click();
  const tiffDownloadPromise = page.waitForEvent("download");
  await page.locator('[data-menu-top="File"]').click();
  await page.getByRole("menuitem", { name: /Save image/i }).click();
  const tiffPrompt = page
    .getByRole("dialog")
    .filter({ hasText: "File extension" });
  await expect(tiffPrompt).toBeVisible();
  await tiffPrompt.getByRole("button", { name: "OK" }).click();
  const tiffDownload = await tiffDownloadPromise;
  expect(tiffDownload.suggestedFilename()).toMatch(/\.tif$/i);
  const tiffPath = test.info().outputPath(tiffDownload.suggestedFilename());
  await tiffDownload.saveAs(tiffPath);
  const imageCountBeforeTiff = await page.locator(".object-tree-item").count();
  const tiffChooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-menu-top="File"]').click();
  await page.getByRole("menuitem", { name: /^Open image…$/i }).click();
  await (await tiffChooserPromise).setFiles(tiffPath);
  await expect(page.locator(".object-tree-item")).toHaveCount(
    imageCountBeforeTiff + 1,
  );

  const imagesTab = page.getByRole("tab", { name: "Images" });
  await expect(imagesTab).toHaveAttribute("aria-selected", "true");
  const imageCountBeforeHdf5 = await page.locator(".object-tree-item").count();
  const signalsTab = page.getByRole("tab", { name: "Signals" });
  await signalsTab.click();
  await expect(signalsTab).toHaveAttribute("aria-selected", "true");
  const signalCountBeforeHdf5 = await page.locator(".object-tree-item").count();
  const hdf5DownloadPromise = page.waitForEvent("download");
  await page.locator('[data-menu-top="File"]').click();
  await page.getByRole("menuitem", { name: /Save to HDF5 file/i }).click();
  const hdf5Download = await hdf5DownloadPromise;
  expect(hdf5Download.suggestedFilename()).toMatch(/\.h5$/i);
  const hdf5Path = test.info().outputPath(hdf5Download.suggestedFilename());
  await hdf5Download.saveAs(hdf5Path);

  await page.reload();
  await waitForRuntimeReady(page);
  const hdf5ChooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-menu-top="File"]').click();
  await page.getByRole("menuitem", { name: /Open HDF5 files/i }).click();
  await (await hdf5ChooserPromise).setFiles(hdf5Path);
  await expect(page.locator(".object-tree-item")).toHaveCount(
    signalCountBeforeHdf5,
  );
  await page.getByRole("tab", { name: "Images" }).click();
  await expect(page.locator(".object-tree-item")).toHaveCount(
    imageCountBeforeHdf5,
  );
  await expect(page.locator(".image-plot-host").first()).toBeVisible();
  await page.getByRole("tab", { name: "Signals" }).click();
  await page
    .locator(".object-tree-item")
    .filter({ hasText: /^sine/ })
    .first()
    .click();
  await page.locator('[data-menu-top="ROI"]').click();
  await page
    .getByRole("menuitem", { name: /Edit regions of interest/i })
    .click();
  await expect(page.locator(".roi-floating .roi-list > li")).toHaveCount(1);
  await page.getByRole("button", { name: "Close ROI editor" }).click();

  await page.getByRole("tab", { name: "Macros" }).click();
  const macroEditor = page.locator(".macro-editor .cm-content").first();
  await macroEditor.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(
    [
      "import numpy as np",
      "import sigima, guidata",
      "x = np.linspace(0, 1, 16)",
      'oid = await proxy.add_signal("offline-macro", x, x)',
      'print(f"offline-macro:{sigima.__version__}:{guidata.__version__}:{oid}")',
    ].join("\n"),
  );
  const runMacro = page.getByRole("button", { name: /^▶ Run/ });
  await expect(runMacro).toBeEnabled();
  await runMacro.click();
  await expect(
    page.locator(".object-tree-item").filter({ hasText: "offline-macro" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Macros" }).click();
  await expect(
    page.locator(".macro-console-line.stdout").filter({
      hasText: "offline-macro:1.1.6:3.14.4",
    }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Notebooks" }).click();
  await expect(page.locator(".nb-toolbar-status")).toContainText(/Kernel idle/);
  const notebookEditor = page.locator(".nb-cell-editor .cm-content").first();
  await notebookEditor.click();
  await page.keyboard.insertText(
    [
      "import numpy, sigima, guidata",
      'print(f"offline-notebook:{numpy.__version__}:{sigima.__version__}:{guidata.__version__}")',
    ].join("\n"),
  );
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".nb-output-stdout").first()).toContainText(
    "offline-notebook:1.26.4:1.1.6:3.14.4",
  );

  await page.goto(`${APP_URL}?runtime=main`);
  await waitForRuntimeReady(page);
  await page.locator('[data-menu-top="Help"]').click();
  await page.getByRole("menuitem", { name: /About DataLab Web/i }).click();
  const mainDiagnostics = page.locator(".help-runtime-diagnostics");
  await expect(mainDiagnostics).toContainText("local");
  await expect(mainDiagnostics).toContainText("main");
  await page.getByRole("button", { name: "Close" }).click();
  await createObject("Signals", /sine/i);
  await page.locator(".object-tree-item").first().click();
  await runCommand(page, "fft", /^FFT$/);
  await expect(page.locator(".object-tree-item")).toHaveCount(2);

  expect(externalRequests).toEqual([]);
});
