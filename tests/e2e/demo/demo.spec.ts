import { test, expect } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { waitForRuntimeReady } from "../fixtures";
import { confirmDialogIfAny, hold, openTopMenu } from "../helpers/demoUi";

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

/** Minimal shape of a ``Page.screencastFrame`` CDP event payload (Playwright
 *  types raw CDP events as ``any``). */
interface ScreencastFrame {
  data: string; // base64-encoded PNG
  sessionId: number;
  metadata?: { timestamp?: number }; // seconds since epoch (fractional)
}

test("DataLab-Web feature showcase", async ({ page }) => {
  const t0 = Date.now();

  // Optional light/dark override for the recording, driven by
  // ``scripts/make-demo-gif.mjs --theme <light|dark>`` via ``DEMO_THEME``.
  // Injected into localStorage *before* the app boots so ``initThemeEarly()``
  // picks it up on first paint. Without it, the app follows the browser's
  // ``prefers-color-scheme`` (light in headless Chromium).
  const demoTheme = process.env.DEMO_THEME;
  if (demoTheme === "light" || demoTheme === "dark") {
    await page.addInitScript((mode) => {
      try {
        window.localStorage.setItem("datalab-web:theme", mode);
      } catch {
        /* ignore — localStorage may be unavailable */
      }
    }, demoTheme);
  }

  await page.goto("/");
  await waitForRuntimeReady(page);
  // Let the first paint settle so the action window starts on a clean frame.
  await hold(page, 800);

  // ── Lossless frame capture (CDP screencast) ──────────────────────────
  // Playwright's built-in WebM is a low-bitrate VP8 (~0.5 Mb/s) whose block
  // artefacts cap the GIF's quality before we ever quantise to 256 colours.
  // Instead we grab per-frame **lossless PNG** screenshots straight from
  // Chromium's compositor via the DevTools ``Page.startScreencast`` API, so
  // ``scripts/make-demo-gif.mjs`` builds the GIF from pristine frames. Frames
  // land in ``test-results/demo/frames/`` and are indexed (with millisecond
  // timestamps for correct playback timing) in ``meta.json``.
  //
  // We ack each frame *immediately* and persist it asynchronously, so
  // Chromium keeps delivering frames at the compositor's paint rate (smooth
  // motion) rather than being throttled by disk writes. The frame's wall-clock
  // timestamp is recorded synchronously, so out-of-order write completion does
  // not affect playback timing.
  const FRAMES_DIR = join(OUTPUT_DIR, "frames");
  rmSync(FRAMES_DIR, { recursive: true, force: true });
  mkdirSync(FRAMES_DIR, { recursive: true });
  const frames: { file: string; t: number }[] = [];
  const pendingWrites: Promise<unknown>[] = [];
  const cdp = await page.context().newCDPSession(page);
  let frameIndex = 0;
  let baseTs: number | null = null;
  cdp.on("Page.screencastFrame", (evt: ScreencastFrame) => {
    // Ack first so the next painted frame is delivered without waiting on I/O.
    void cdp
      .send("Page.screencastFrameAck", { sessionId: evt.sessionId })
      .catch(() => {});
    const name = `frame_${String(++frameIndex).padStart(5, "0")}.png`;
    const ts = evt.metadata?.timestamp ?? 0;
    if (baseTs === null) baseTs = ts;
    frames.push({ file: name, t: (ts - baseTs) * 1000 });
    pendingWrites.push(
      writeFile(join(FRAMES_DIR, name), Buffer.from(evt.data, "base64")),
    );
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });

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

  // Stop the screencast and let the last few frames drain to disk.
  await cdp.send("Page.stopScreencast").catch(() => {});
  await page.waitForTimeout(200);
  await Promise.allSettled(pendingWrites);

  // Persist the lossless frame manifest for the conversion script. ``frames``
  // are already scoped to the action window (screencast started at
  // ``startOffsetMs``); the offsets are kept for reference/debugging only.
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(
    join(OUTPUT_DIR, "meta.json"),
    JSON.stringify(
      { startOffsetMs, endOffsetMs, framesDir: FRAMES_DIR, frames },
      null,
      2,
    ),
    "utf-8",
  );
});
