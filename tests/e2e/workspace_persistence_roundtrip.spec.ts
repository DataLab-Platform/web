import { test, expect } from "@playwright/test";
import { waitForRuntimeReady, disableQuickstartTemplate } from "./fixtures";

import type { DataLabRuntime } from "../../src/runtime/runtime";

declare global {
  interface Window {
    runtime: DataLabRuntime;
  }
}

/**
 * End-to-end safety net for the "HDF5 = single durable source of
 * truth" persistence model (PR 1 of the workspace-dirty UX work).
 *
 * What we cover:
 *
 *   * the initial document title is "DataLab-Web — Untitled" with no
 *     unsaved-changes marker,
 *   * mutating the workspace (creating a signal) flips the title to
 *     include the bullet "•" marker,
 *   * "Save HDF5 workspace…" assigns a timestamped filename, clears
 *     dirty, and persists *every* asset class (signals + macros +
 *     notebooks),
 *   * reloading the page wipes Pyodide; re-importing the saved bytes
 *     through "Open HDF5 workspace…" restores all three asset classes
 *     and lands on a clean (no "•") titled workspace.
 *
 * Notebook content is part of the round-trip: we seed a uniquely
 * named notebook before saving, hard-reload, re-open the file, and
 * assert the notebook reappears with its source intact. This
 * subsumes the previous notebook-only round-trip spec.
 *
 * The mutate phase also (a) applies a real Sigima processing (FFT)
 * to the seed signal so we exercise the full processor pipeline and
 * verify the produced object survives the round-trip, and (b)
 * attaches a signal ROI segment so we verify ROI metadata also makes
 * it through HDF5.
 */
test("workspace HDF5 round-trip + dirty title transitions", async ({
  page,
}) => {
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);

  // -- 1. Initial state ------------------------------------------------
  await expect.poll(() => page.title()).toBe("DataLab-Web — Untitled");

  // -- 2. Mutate workspace: add a signal + a macro --------------------
  const marker = `roundtrip-${Date.now()}`;
  const sourceId = await page.evaluate(async (title) => {
    const x = Array.from({ length: 16 }, (_, i) => i);
    return await window.runtime.addSignalFromArrays({
      title,
      xdata: x,
      ydata: x.map((v) => v * 2),
    });
  }, marker);

  // Title now carries the "•" dirty marker.
  await expect
    .poll(() => page.title(), { timeout: 5_000 })
    .toBe("DataLab-Web — Untitled •");

  // Apply a real Sigima processing (FFT) to the seed signal so the
  // round-trip also exercises a processor-produced object. The new
  // signal must reappear after re-opening the HDF5 file.
  const fftId = await page.evaluate(
    async (id) => await window.runtime.applyProcessing(id, "fft"),
    sourceId,
  );
  expect(fftId).toBeTruthy();
  expect(fftId).not.toBe(sourceId);

  // Attach a signal ROI segment so we verify ROI metadata also makes
  // it through the HDF5 round-trip.
  await page.evaluate(
    async (id) =>
      await window.runtime.setSignalRoi(id, [
        { xmin: 2, xmax: 8, title: "roi-roundtrip" },
      ]),
    sourceId,
  );

  // Add a uniquely-named macro so we can assert it survives the round-trip.
  const macroTitle = `macro-${marker}`;
  await page.evaluate(async (t) => {
    await window.runtime.createMacro(t, "# placeholder body\n");
  }, macroTitle);

  // Add a uniquely-named notebook with a marker cell so we can
  // assert its content survives the round-trip too.
  const notebookTitle = `notebook-${marker}`;
  const notebookSource = `# nb-roundtrip ${marker}`;
  await page.evaluate(
    async ({ t, src }) => {
      const nb = {
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          {
            cell_type: "code",
            id: "c1",
            source: src,
            metadata: {},
            outputs: [],
            execution_count: null,
          },
        ],
      };
      await window.runtime.createNotebook(t, JSON.stringify(nb));
    },
    { t: notebookTitle, src: notebookSource },
  );

  // -- 3. Save HDF5 via the File menu ---------------------------------
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: /Save to HDF5 file/i }).click();
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  expect(suggested).toMatch(/^workspace-.*\.h5$/);
  const tmpPath = test.info().outputPath(suggested);
  await download.saveAs(tmpPath);

  // After save the workspace is clean and titled with the new name.
  await expect
    .poll(() => page.title(), { timeout: 5_000 })
    .toBe(`DataLab-Web — ${suggested}`);

  // -- 4. Hard reload — Pyodide is wiped ------------------------------
  await page.reload();
  await waitForRuntimeReady(page);
  // Title is "Untitled" after the reload. The IndexedDB recent cache
  // still holds the macro from step 2, so the cold-start Recent… hint
  // banner may appear, but the workspace stays clean (no "(recovered)"
  // hint). Here we just require the filename hasn't carried over.
  await expect.poll(() => page.title()).toContain("Untitled");
  await expect.poll(() => page.title()).not.toContain(suggested);

  // Sanity: signal store starts empty after reload.
  const initialCount = await page.evaluate(
    async () => (await window.runtime.listSignals()).length,
  );
  expect(initialCount).toBe(0);

  // -- 5. Re-open the saved HDF5 via the File menu --------------------
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: /Open HDF5 files/i }).click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles(tmpPath);

  // Title flips to the loaded filename, clean (no "•").
  await expect
    .poll(() => page.title(), { timeout: 30_000 })
    .toBe(`DataLab-Web — ${suggested}`);

  // -- 6. Assert the data came back ----------------------------------
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const sigs = await window.runtime.listSignals();
          const macros = await window.runtime.listMacros();
          const notebooks = await window.runtime.listNotebooks();
          return {
            sigTitles: sigs.map((s) => s.title),
            sigCount: sigs.length,
            macroTitles: macros.map((m) => m.title),
            notebookTitles: notebooks.map((n) => n.title),
          };
        }),
      { timeout: 30_000, intervals: [250, 500, 1000] },
    )
    .toMatchObject({
      sigTitles: expect.arrayContaining([marker]),
      // Source signal + FFT result.
      sigCount: 2,
      macroTitles: expect.arrayContaining([macroTitle]),
      notebookTitles: expect.arrayContaining([notebookTitle]),
    });

  // The restored signal must still carry its ROI segment. ``oid``
  // values are regenerated on import, so we look the seed up by title.
  const restoredRoi = await page.evaluate(async (t) => {
    const sigs = await window.runtime.listSignals();
    const seed = sigs.find((s) => s.title === t);
    if (!seed) return null;
    return await window.runtime.getSignalRoi(seed.id);
  }, marker);
  expect(restoredRoi).toEqual([expect.objectContaining({ xmin: 2, xmax: 8 })]);

  // The restored notebook's source must match the marker we wrote.
  const restoredSource = await page.evaluate(async (t) => {
    const list = await window.runtime.listNotebooks();
    const meta = list.find((n) => n.title === t);
    if (!meta) return null;
    const nb = await window.runtime.getNotebook(meta.id);
    const json = JSON.parse(nb.content) as {
      cells: Array<{ source: string | string[] }>;
    };
    return json.cells
      .map((c) => (Array.isArray(c.source) ? c.source.join("") : c.source))
      .join("\n");
  }, notebookTitle);
  expect(restoredSource).toContain(notebookSource);

  // -- 7. After Open, mutating the workspace re-flips dirty ----------
  await page.evaluate(() => window.runtime.createSignalTyped("sine"));
  await expect
    .poll(() => page.title(), { timeout: 15_000, intervals: [250, 500] })
    .toBe(`DataLab-Web — ${suggested} •`);
});
