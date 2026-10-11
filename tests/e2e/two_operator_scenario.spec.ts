/**
 * Two-operator scenario, operator B (DataLab-Web), driven through the dialog.
 *
 * Opt-in: runs only with ``DLW_SCENARIO_DIR``, a folder holding operator A's
 * capsule ``a/chain.dlcapsule`` (DataLab Desktop + ``workspace-capsule``, with
 * the attachment ``protocol.txt``). Operator B inspects it without opening it,
 * saves the attachment, opens it, replays every activity locally, continues the
 * processing, exports a child revision and writes a review citing a report.
 * Outputs go to ``b/`` for operator A to check with the command line and the
 * Desktop. With ``DLW_SCENARIO_REGISTRY`` (and ``DLW_SCENARIO_TOKEN``), B also
 * retrieves A's revision from the registry and publishes the child and its
 * review there. See DataLab-Capsule ``doc/scenario.md``.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { test, expect } from "@playwright/test";

import {
  choose,
  closeDialog,
  download,
  exportCapsule,
  inspect,
  openDialog,
  openPage,
} from "./capsuleHelpers";

const DIR = process.env.DLW_SCENARIO_DIR;
const REGISTRY = process.env.DLW_SCENARIO_REGISTRY;

test.describe("two-operator scenario, operator B", () => {
  test.describe.configure({ timeout: 900_000 });
  test.skip(!DIR, "Set DLW_SCENARIO_DIR to run the two-operator scenario");

  test("inspect, open, replay, continue, review (and registry)", async ({
    browser,
  }) => {
    const capsule = path.join(DIR!, "a", "chain.dlcapsule");
    expect(existsSync(capsule), `${capsule} (from operator A)`).toBe(true);
    const out = path.join(DIR!, "b");
    mkdirSync(out, { recursive: true });
    const keep = (file: string, name: string) =>
      copyFileSync(file, path.join(out, name));
    const page = await openPage(browser);
    await openDialog(page);

    // 1. Inspect without opening: integrity, attachment saved on request.
    await inspect(page, capsule);
    await expect(page.getByTestId("capsule-integrity-status")).toHaveText(
      "Intact",
    );
    const attachment = page
      .getByTestId("capsule-attachment-row")
      .filter({ hasText: "protocol.txt" });
    keep(
      await download(
        page,
        () => attachment.getByTestId("capsule-attachment-save").click(),
        "protocol.txt",
      ),
      "protocol.txt",
    );

    // 2. Open, then replay every activity locally.
    await page.getByTestId("capsule-open").click();
    await expect
      .poll(async () =>
        page.evaluate(async () => (await window.runtime.listSignals()).length),
      )
      .toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Local replay" }).click();
    const rows = page.getByTestId("capsule-replay-row");
    const verdicts: string[] = [];
    for (let index = 0; index < (await rows.count()); index += 1) {
      await rows.nth(index).getByTestId("capsule-replay-button").click();
      const verdict = rows.nth(index).getByTestId("capsule-replay-verdict");
      await expect(verdict).not.toHaveText("");
      verdicts.push((await verdict.textContent()) ?? "");
    }
    expect(verdicts.some((v) => v.startsWith("exact"))).toBe(true);
    expect(verdicts.some((v) => v.startsWith("different"))).toBe(false);
    const exact = verdicts.findIndex((v) => v.startsWith("exact"));
    const reportPath = await download(
      page,
      () => rows.nth(exact).getByTestId("capsule-save-report").click(),
      "report.json",
    );
    keep(reportPath, "report.json");

    // 3. Continue the processing and export a child revision.
    await closeDialog(page);
    await page.evaluate(async () => {
      const [s0] = await window.runtime.listSignals();
      await window.runtime.applyFeature("normalize", [s0.id], null, {
        method: "amplitude",
      });
    });
    await openDialog(page);
    const childPath = await exportCapsule(page, "chain-continued", {
      revision: true,
    });
    keep(childPath, "child.dlcapsule");

    // 4. A separate review of the child, citing the local report.
    await inspect(page, childPath);
    await page.getByTestId("capsule-reviewer").fill("Operator B");
    await page
      .getByTestId("capsule-statement")
      .fill("Replayed in DataLab-Web; the replayable activities are exact.");
    await page.getByTestId("capsule-verdict").selectOption("endorsed");
    await choose(
      page,
      () => page.getByTestId("capsule-cite-report").click(),
      reportPath,
    );
    const reviewPath = await download(
      page,
      () => page.getByTestId("capsule-write-review").click(),
      "review.json",
    );
    keep(reviewPath, "review.json");

    // 5. Optional registry: retrieve A's revision, publish the child.
    const registry: Record<string, unknown> = {};
    if (REGISTRY) {
      await page.getByRole("tab", { name: "Registry" }).click();
      await page.getByTestId("capsule-registry-address").fill(REGISTRY);
      await page
        .getByTestId("capsule-registry-token")
        .fill(process.env.DLW_SCENARIO_TOKEN ?? "");
      await page.getByTestId("capsule-registry-save").click();
      await page.getByTestId("capsule-registry-refresh").click();
      const listed = page
        .getByTestId("capsule-registry-row")
        .filter({ hasText: "chain" });
      await expect(listed.first()).toBeVisible();
      await listed.first().getByTestId("capsule-registry-retrieve").click();
      await expect(
        page.getByTestId("capsule-registry-retrieved"),
      ).toContainText("Manifest checked: valid");
      registry.retrieved_reviews = await page
        .getByTestId("capsule-registry-review")
        .allTextContents();
      await inspect(page, childPath);
      await choose(
        page,
        () => page.getByTestId("capsule-add-review").click(),
        reviewPath,
      );
      await expect(page.getByTestId("capsule-review-status")).toContainText(
        "consistent",
      );
      await page.getByTestId("capsule-publish").click();
      await expect(page.getByTestId("capsule-published")).toContainText(
        "and 1 reviews",
      );
      registry.published = await page
        .getByTestId("capsule-published")
        .textContent();
    }
    writeFileSync(
      path.join(out, "web_scenario.json"),
      `${JSON.stringify({ verdicts, registry }, null, 2)}\n`,
    );
    await page.context().close();
  });
});
