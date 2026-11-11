import { expect, test } from "@playwright/test";
import { waitForRuntimeReady } from "../fixtures";

/**
 * Check harness of the Showcase mode: the showcase runs inside the page,
 * started by its URL; this spec only opens the URL and verifies the results
 * the player publishes in ``window.__showcase`` (every scenario passed or
 * was skipped). Runs through ``playwright.showcase.config.ts`` only.
 *
 * Environment variables:
 *
 *   * ``SHOWCASE_ONLY``: comma-separated scenario ids (default: all);
 *   * ``SHOWCASE_LANG``: UI language (``en`` or ``fr``);
 *   * ``SHOWCASE_SPEED``: pace of the ``showcase-headed`` project (default 1).
 */

interface ShowcaseResult {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  error?: string;
  durationMs: number;
}

interface ShowcaseStatus {
  state: string;
  results: ShowcaseResult[];
}

test("showcase scenarios", async ({ page }, testInfo) => {
  const headed = testInfo.project.name === "showcase-headed";
  const params = new URLSearchParams({
    showcase: process.env.SHOWCASE_ONLY || "1",
  });
  if (headed) {
    params.set("speed", process.env.SHOWCASE_SPEED || "1");
  } else {
    params.set("speed", "0");
    params.set("check", "1");
  }
  if (process.env.SHOWCASE_LANG) params.set("lang", process.env.SHOWCASE_LANG);
  page.on("console", (message) => {
    if (message.text().startsWith("[showcase")) console.log(message.text());
  });

  await page.goto(`/?${params.toString()}`);
  await waitForRuntimeReady(page);
  await page.waitForFunction(
    () => {
      const status = (window as unknown as { __showcase?: ShowcaseStatus })
        .__showcase;
      return (
        status !== undefined &&
        status.state !== "running" &&
        status.state !== "stopped"
      );
    },
    undefined,
    { timeout: 0, polling: 1000 },
  );
  const status = (await page.evaluate(
    () => (window as unknown as { __showcase?: ShowcaseStatus }).__showcase,
  )) as ShowcaseStatus;

  for (const result of status.results) {
    const seconds = (result.durationMs / 1000).toFixed(1);
    await test.step(`${result.id} · ${result.title} (${result.status}, ${seconds} s)`, async () => {
      expect
        .soft(result.status, `${result.id}: ${result.error ?? ""}`)
        .not.toBe("failed");
    });
  }
  expect(status.state).toBe("done");
  expect(status.results.length).toBeGreaterThan(0);
});
