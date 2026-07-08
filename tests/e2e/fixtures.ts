import { expect, Page } from "@playwright/test";

/**
 * Wait for the DataLab runtime to finish booting in Pyodide.
 *
 * The root ``<div class="app">`` exposes ``data-runtime-status`` which moves
 * from ``loading`` → ``ready`` once bootstrap.py has been executed.
 */
export async function waitForRuntimeReady(page: Page): Promise<void> {
  // First load installs Sigima/guidata via micropip (network) and runs the
  // ~MB-sized bootstrap.py.  On CI or slow PyPI this can exceed 90 s, so we
  // give it 3 minutes with a safety margin.
  await expect(page.locator(".app")).toHaveAttribute(
    "data-runtime-status",
    "ready",
    { timeout: 180_000 },
  );
}

/**
 * Suppress the bundled "Quickstart" notebook template that
 * :func:`NotebookPanel` loads on first boot. Tests that assume a
 * pristine, empty notebook should call this before ``page.goto`` so
 * the ``isFirstBoot`` branch sees a non-null ``openIds`` localStorage
 * key and falls back to a single empty notebook.
 */
export async function disableQuickstartTemplate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const KEY = "datalab-web.notebooks.openIds";
      // Only set when missing — otherwise we would clobber the
      // persisted open-tabs across an in-test ``page.reload()``.
      if (window.localStorage.getItem(KEY) === null) {
        window.localStorage.setItem(KEY, "[]");
      }
    } catch {
      // ignore
    }
  });
}

/**
 * Remove the File System Access API save pickers at runtime so
 * save/export actions fall back to the ``<a download>`` path.
 *
 * Playwright's Chromium exposes ``showSaveFilePicker`` /
 * ``showDirectoryPicker``, but native pickers can't be driven from a
 * test. Tests that capture saved bytes via ``page.waitForEvent("download")``
 * must call this first. The app re-checks availability on every save, so
 * a runtime delete on an already-loaded page suffices (no reload needed).
 */
export async function forceSaveDownloadFallback(page: Page): Promise<void> {
  await page.evaluate(() => {
    try {
      delete (window as unknown as { showSaveFilePicker?: unknown })
        .showSaveFilePicker;
      delete (window as unknown as { showDirectoryPicker?: unknown })
        .showDirectoryPicker;
    } catch {
      // Non-configurable on some engines — ignore.
    }
  });
}
