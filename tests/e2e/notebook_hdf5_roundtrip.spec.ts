import { test, expect } from "@playwright/test";
import { waitForRuntimeReady, disableQuickstartTemplate } from "./fixtures";

/**
 * Real persistence contract under the Phase 4+ design:
 *
 *   notebooks live in the Python ``_NOTEBOOKS`` store and are
 *   serialised to the workspace HDF5. IndexedDB is only a roll-over
 *   cache surfaced through "Recent…", not the source of truth.
 *
 * This spec drives the round-trip end-to-end:
 *
 *   1. type a marker into the active notebook cell,
 *   2. ask the runtime to serialise the workspace to HDF5 bytes,
 *   3. hard-reload the page (wipes Pyodide entirely),
 *   4. re-import the bytes through the File menu (which bumps
 *      ``workspaceVersion`` and remounts the notebook panel),
 *   5. assert the marker is back in the restored cell.
 *
 * We deliberately bypass the in-DOM "Save HDF5 workspace…" menu entry
 * for step 2 because that action is currently gated on
 * ``hasObjects``; the notebook-only test would otherwise require a
 * fake signal just to enable the button. The Python serialisation
 * code path exercised by ``runtime.saveWorkspaceHdf5()`` is the same
 * one the menu invokes.
 */

import type { DataLabRuntime } from "../../src/runtime/runtime";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

test("notebook content survives an HDF5 workspace round-trip", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  // 1. Open notebooks panel and edit the first cell.
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await expect(page.locator(".nb-toolbar-status")).toContainText(
    /Kernel idle|Kernel running/,
    { timeout: 180_000 },
  );
  await expect(page.locator(".nb-tab")).toHaveCount(1);

  const marker = `# hdf5-roundtrip ${Date.now()}`;
  const editor = page.locator(".nb-cell-editor .cm-content").first();
  await editor.click();
  await page.keyboard.type(marker);
  // Wait > 600 ms autosave debounce so Python ``_NOTEBOOKS`` is in sync.
  await page.waitForTimeout(1500);

  // 2. Serialise the workspace to a base64 string we can stash in
  //    sessionStorage so it survives the upcoming reload.
  const b64 = await page.evaluate(async () => {
    const bytes = await window.runtime.saveWorkspaceHdf5();
    let s = "";
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  });
  expect(b64.length).toBeGreaterThan(100);
  await page.evaluate(
    (b: string) => sessionStorage.setItem("__roundtrip_hdf5", b),
    b64,
  );

  // 3. Hard reload — this wipes Pyodide, the React tree, and any
  //    debounced save timers. After reload the notebook panel will
  //    boot with an empty Python ``_NOTEBOOKS`` (no marker yet).
  await page.reload();
  await waitForRuntimeReady(page);

  // Sanity: switch to notebooks; the (fresh) blank cell does NOT
  // contain the marker yet.
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await expect(page.locator(".nb-toolbar-status")).toContainText(
    /Kernel idle|Kernel running/,
    { timeout: 180_000 },
  );
  await expect(page.locator(".nb-cell-editor .cm-content").first()).not
    .toContainText(marker);

  // 4. Drive the File → "Open HDF5 workspace…" menu. The handler
  //    builds a one-shot ``<input type="file">`` and calls
  //    ``input.click()`` — Playwright captures that via the
  //    ``filechooser`` event. Once the bytes are pushed back into
  //    Python, ``setWorkspaceVersion`` bumps and the notebook panel
  //    remounts, re-hydrating from ``_NOTEBOOKS``.
  //
  //    We have to materialise the saved bytes as a real file path on
  //    disk for ``setFiles`` to consume. The test's tmpdir is the
  //    natural place; we hand it through ``test.info().outputPath``.
  const tmpPath = test.info().outputPath("workspace.h5");
  const bytes = await page.evaluate((b: string) => {
    const bin = atob(b);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
    return Array.from(arr);
  }, b64);
  const fs = await import("node:fs/promises");
  await fs.writeFile(tmpPath, Buffer.from(bytes));

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page
    .getByRole("menuitem", { name: /Open HDF5 workspace/i })
    .click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles(tmpPath);

  // 5. Assert the marker came back. The panel is remounted via the
  //    ``key={`nb-${workspaceVersion}`}`` bump so the initial-load
  //    effect runs again and pulls the restored notebook from Python.
  await expect
    .poll(
      async () =>
        page.locator(".nb-cell-editor .cm-content").first().innerText(),
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toContain(marker);
});
