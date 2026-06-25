import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForRuntimeReady } from "../fixtures";

/**
 * Scripted "wow" demo of DataLab-Web, recorded as a WebM by Playwright and
 * post-processed into an animated GIF by ``scripts/make-demo-gif.mjs``.
 *
 * This spec is **never** part of the regression suite — the main
 * ``playwright.config.ts`` ignores it and it only runs through
 * ``playwright.demo.config.ts`` (``npm run demo:gif``).
 *
 * The scenario showcases, in a single continuous take:
 *   1. creating a structured 2D image (a 2D sinc) from the Create menu,
 *   2. the interactive cross-profiles tool (live → frozen) over the sinc's
 *      oscillating rings, and extracting a horizontal profile as a signal,
 *   3. measuring the profile's full width at half-maximum (Analysis menu),
 *      which draws a visible segment on the curve,
 *   4. Canny edge detection on the image via the command palette (Ctrl+K),
 *      turning the sinc into crisp concentric ring contours,
 *   5. a quick tour of the processing menus to advertise the breadth of
 *      Sigima features.
 *
 * The wall-clock offsets that bound the *action* window (everything after
 * the long Pyodide boot) are written to ``test-results/demo/meta.json`` so
 * the conversion script can trim the boot lead-in from the final GIF.
 */

const OUTPUT_DIR = "test-results/demo";

/** Hold a readable beat on the current UI state (the GIF needs each step
 *  to linger long enough for a viewer to register it). */
async function hold(page: Page, ms = 750): Promise<void> {
  await page.waitForTimeout(ms);
}

/** Click the OK button of the auto-generated parameter dialog when one
 *  appears. Many Sigima processings open a DataSet dialog *after* a short
 *  Pyodide round-trip (schema generation), so we wait for it rather than
 *  probing immediately; if none shows up within ``timeout`` we assume the
 *  processing had no parameters and ran straight away. */
async function confirmDialogIfAny(page: Page, timeout = 4000): Promise<void> {
  const dialog = page.locator(".dataset-dialog");
  try {
    await dialog.waitFor({ state: "visible", timeout });
  } catch {
    return; // no parameter dialog — nothing to confirm
  }
  await hold(page, 600);
  await dialog.getByRole("button", { name: "OK" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
}

/** Open a top-level menu by its canonical (English) key, independent of the
 *  current UI language.
 *
 *  Robust to whether another top menu is already open: hovering opens the
 *  dropdown when a sibling is open (the menu bar switches on hover), while a
 *  click is needed to open the first one. We must *not* click when a sibling
 *  is open, because the bar pre-selects the hovered item on ``mouseenter`` and
 *  a subsequent click would toggle it straight back closed. */
async function openTopMenu(page: Page, key: string): Promise<void> {
  const top = page.locator(`[data-menu-top="${key}"]`);
  await top.hover();
  await page.waitForTimeout(120);
  if ((await top.getAttribute("aria-expanded")) !== "true") {
    await top.click();
    await page.waitForTimeout(120);
  }
}

test("DataLab-Web feature showcase", async ({ page }) => {
  const t0 = Date.now();

  await page.goto("/");
  await waitForRuntimeReady(page);
  // Let the first paint settle so the action window starts on a clean frame.
  await hold(page, 800);

  // Everything below is the part we keep in the GIF.
  const startOffsetMs = Date.now() - t0;

  // ── 1. Create a structured 2D image (2D sinc) ────────────────────────
  await page.getByRole("tab", { name: "Images" }).click();
  await hold(page);
  await openTopMenu(page, "Create");
  await hold(page, 600);
  await page
    .locator(".menu-dropdown")
    .getByRole("menuitem", { name: /sinc/i })
    .first()
    .click();
  // Wait for the freshly created image to appear and select it.
  await expect(page.locator(".object-tree-item").first()).toBeVisible();
  await page.locator(".object-tree-item").first().click();
  await expect(page.locator(".image-plot-host").first()).toBeVisible();
  await hold(page, 900);

  // ── 2. Cross profiles: live → frozen → extract a profile ─────────────
  await page.getByRole("button", { name: "Cross profiles" }).click();
  const heatmap = page.locator(".image-plot-cell-heatmap .image-plot-host");
  await expect(heatmap).toBeVisible();
  const box = await heatmap.boundingBox();
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Sweep the cursor so the live profiles visibly follow the mouse.
    await page.mouse.move(box.x + box.width * 0.34, box.y + box.height * 0.36, {
      steps: 12,
    });
    await hold(page, 500);
    await page.mouse.move(box.x + box.width * 0.64, box.y + box.height * 0.58, {
      steps: 16,
    });
    await hold(page, 500);
    await page.mouse.move(cx, cy, { steps: 14 });
    await hold(page, 500);
    // Click to freeze the crosshair, then extract the horizontal profile.
    await page.mouse.click(cx, cy);
  }
  await hold(page, 900);
  await page.locator(".image-profile-extract").first().click();
  // Cross-kind result lands in the Signals panel; the app switches to it.
  await expect(page.getByRole("tab", { name: "Signals" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".object-tree-item").first()).toBeVisible();
  await hold(page, 1000);

  // ── 3. Full width at half-maximum of the profile (Analysis menu) ─────
  await openTopMenu(page, "Analysis");
  await hold(page, 600);
  await page
    .locator(".menu-dropdown")
    .getByRole("menuitem", { name: /^Full width at half-maximum/ })
    .click();
  await confirmDialogIfAny(page);
  await hold(page, 1300);

  // ── 4. Edge detection (Canny) on the image via the command palette ───
  await page.getByRole("tab", { name: "Images" }).click();
  await hold(page, 400);
  await page.locator(".object-tree-item").first().click();
  await expect(page.locator(".image-plot-host").first()).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.locator(".command-palette-input");
  await expect(palette).toBeVisible();
  await hold(page, 400);
  await palette.pressSequentially("canny", { delay: 70 });
  await hold(page, 800);
  // The fuzzy ranking can put unrelated commands on top for a short query,
  // so pick the exact "Canny filter" entry rather than the top hit.
  await page
    .locator(".command-palette-item")
    .filter({
      has: page.locator(".command-palette-label", { hasText: /^Canny/ }),
    })
    .first()
    .click();
  await confirmDialogIfAny(page);
  await hold(page, 1300);

  // ── 5. Quick tour of the processing menus (breadth of features) ──────
  await openTopMenu(page, "Operations");
  await hold(page, 800);
  await openTopMenu(page, "Processing");
  await hold(page, 400);
  await page
    .locator(".menu-dropdown")
    .getByRole("menuitem", { name: /Fourier analysis/i })
    .hover();
  await hold(page, 700);
  await openTopMenu(page, "Analysis");
  await hold(page, 900);
  await page.keyboard.press("Escape");
  await hold(page, 600);

  const endOffsetMs = Date.now() - t0;

  // Persist the trim window + video path for the conversion script.
  const video = page.video();
  const videoPath = video ? await video.path() : null;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, "meta.json"),
    JSON.stringify({ startOffsetMs, endOffsetMs, videoPath }, null, 2),
    "utf-8",
  );
});
