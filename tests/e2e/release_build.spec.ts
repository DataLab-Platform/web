/**
 * Release build check: the production bundle, served as distributed, works
 * through its interface only, with provenance.
 *
 * Opt-in (``DLW_RELEASE_BUILD=1``), against the files extracted from the app
 * tarball (``release/datalab-web-<version>.tgz``) and served by a plain
 * static server on port 5173 (e.g. ``python -m http.server 5173``), not by
 * the development server. ``DLW_RELEASE_CAPSULE`` is a capsule to inspect and
 * replay (e.g. operator A's ``chain.dlcapsule``, exported by DataLab
 * Desktop). The development hook ``window.runtime`` must be absent.
 *
 * Two levels:
 *
 * - release (default): after the dependencies are published and the pins
 *   updated, every wheel comes from PyPI or the Pyodide CDN;
 * - candidate (``DLW_RELEASE_CANDIDATE=1``): before publication, the bundle is
 *   a production build whose ``VITE_*_INSTALL_SPEC`` point to candidate wheels
 *   served with it (``/wheels/``); no wheel may come from a development server.
 */
import { test, expect } from "@playwright/test";

import { closeDialog, inspect, openDialog } from "./capsuleHelpers";
import { forceSaveDownloadFallback } from "./fixtures";

const ENABLED = process.env.DLW_RELEASE_BUILD === "1";
const CANDIDATE = process.env.DLW_RELEASE_CANDIDATE === "1";
const CAPSULE = process.env.DLW_RELEASE_CAPSULE;
const PUBLISHED_HOSTS = ["files.pythonhosted.org", "cdn.jsdelivr.net"];

test.describe("release build", () => {
  test.skip(!ENABLED, "Set DLW_RELEASE_BUILD=1 against a served release build");

  test("published packages only; inspect, open and replay a capsule", async ({
    browser,
  }) => {
    test.setTimeout(600_000);
    expect(CAPSULE, "DLW_RELEASE_CAPSULE").toBeTruthy();
    const page = await (await browser.newContext()).newPage();
    const wheels: string[] = [];
    page.on("request", (request) => {
      if (/\.whl(\?|$)/.test(request.url())) wheels.push(request.url());
    });
    await page.goto("/?runtime=worker");
    await expect(page.locator(".app")).toHaveAttribute(
      "data-runtime-status",
      "ready",
      { timeout: 300_000 },
    );
    await forceSaveDownloadFallback(page);
    expect(await page.evaluate(() => "runtime" in window)).toBe(false);

    await openDialog(page);
    await inspect(page, CAPSULE!);
    await expect(page.getByTestId("capsule-integrity-status")).toHaveText(
      "Intact",
    );
    await page.getByTestId("capsule-open").click();
    await page.getByRole("tab", { name: "Local replay" }).click();
    const rows = page.getByTestId("capsule-replay-row");
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const verdicts: string[] = [];
    for (let index = 0; index < (await rows.count()); index += 1) {
      await rows.nth(index).getByTestId("capsule-replay-button").click();
      const verdict = rows.nth(index).getByTestId("capsule-replay-verdict");
      await expect(verdict).not.toHaveText("");
      verdicts.push((await verdict.textContent()) ?? "");
    }
    expect(verdicts.some((v) => v.startsWith("Exact"))).toBe(true);
    expect(verdicts.some((v) => v.startsWith("different"))).toBe(false);
    await closeDialog(page);

    // Consultation and verification of a result in the Provenance tab
    const items = page.locator(".object-tree-item");
    await expect
      .poll(() => items.count(), { timeout: 30_000 })
      .toBeGreaterThan(1);
    await items.last().click({ position: { x: 4, y: 4 } });
    await page.getByRole("tab", { name: "Provenance" }).click();
    const panel = page.getByTestId("provenance-panel");
    await expect(panel.getByTestId("provenance-activity").first()).toBeVisible({
      timeout: 30_000,
    });
    await panel.getByRole("button", { name: "Verify computation" }).click();
    await expect(panel.getByTestId("provenance-verdict").first()).toContainText(
      /Exact|Within tolerance/,
      { timeout: 120_000 },
    );

    const names = (url: string) => decodeURIComponent(url.split("/").pop()!);
    console.log(`release build wheels: ${wheels.map(names).join(", ")}`);
    // Plugin wheels of the bundled applications are part of the bundle
    // (same origin, under assets/); candidate wheels are served under wheels/.
    const origin = new URL(page.url()).origin;
    const allowed = (url: string) => {
      const { hostname, pathname } = new URL(url);
      if (PUBLISHED_HOSTS.includes(hostname)) return true;
      if (new URL(url).origin !== origin || url.includes("/@fs/")) return false;
      return (
        pathname.startsWith("/assets/") ||
        (CANDIDATE && pathname.startsWith("/wheels/"))
      );
    };
    expect(
      wheels.filter((url) => !allowed(url)),
      CANDIDATE
        ? "wheels from a development server"
        : "wheels not from PyPI, the Pyodide CDN or the bundle",
    ).toEqual([]);
    const fromBundle = (name: string) =>
      wheels.some(
        (url) =>
          names(url).toLowerCase().startsWith(name) &&
          new URL(url).pathname.startsWith("/wheels/"),
      );
    for (const name of ["sigima-", "guidata-", "datalab_capsule-"]) {
      expect(
        wheels.some((url) => names(url).toLowerCase().startsWith(name)),
        `${name} loaded`,
      ).toBe(true);
      if (!CANDIDATE) {
        expect(fromBundle(name), `${name} not from the bundle`).toBe(false);
      }
    }
    await page.context().close();
  });
});
