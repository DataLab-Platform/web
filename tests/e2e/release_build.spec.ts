/**
 * Release build check: the app served from ``npm run build:release`` uses
 * published packages only, and provenance works through the interface.
 *
 * Opt-in (``DLW_RELEASE_BUILD=1``), against a release build served locally
 * (``npx vite preview --port 5173``), after the dependencies are published and
 * the pins updated. ``DLW_RELEASE_CAPSULE`` is a capsule to inspect and replay
 * (e.g. operator A's ``chain.dlcapsule``). The development hook
 * ``window.runtime`` must be absent: everything goes through the UI.
 */
import { test, expect } from "@playwright/test";

import { inspect, openDialog } from "./capsuleHelpers";
import { forceSaveDownloadFallback } from "./fixtures";

const ENABLED = process.env.DLW_RELEASE_BUILD === "1";
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
    expect(verdicts.some((v) => v.startsWith("exact"))).toBe(true);
    expect(verdicts.some((v) => v.startsWith("different"))).toBe(false);

    const names = (url: string) => decodeURIComponent(url.split("/").pop()!);
    const foreign = wheels.filter(
      (url) => !PUBLISHED_HOSTS.includes(new URL(url).hostname),
    );
    console.log(`release build wheels: ${wheels.map(names).join(", ")}`);
    expect(foreign, "wheels not from PyPI or the Pyodide CDN").toEqual([]);
    for (const name of ["sigima-", "guidata-", "datalab_capsule-"]) {
      expect(
        wheels.some((url) => names(url).toLowerCase().startsWith(name)),
        `${name} loaded`,
      ).toBe(true);
    }
    await page.context().close();
  });
});
