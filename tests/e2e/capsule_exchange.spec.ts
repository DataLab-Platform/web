/**
 * Capsule exchange between two browser contexts, through the Capsule dialog.
 *
 * The author (context A) builds a processing chain and exports a capsule. The
 * recipient (context B, no shared memory or storage) inspects it, opens it,
 * replays an activity locally and compares it with the stored reference, then
 * exports a child revision and writes a separate review. The author checks the
 * review against the child (consistent) and against the parent (another
 * revision), and compares the two revisions.
 *
 * Integrity, supplied documents and local replay are separate sections of the
 * dialog: each assertion reads its own section.
 */
import {
  test,
  expect,
  type Browser,
  type Download,
  type Page,
} from "@playwright/test";

import { forceSaveDownloadFallback, waitForRuntimeReady } from "./fixtures";

const X = [0, 0.25, 0.5, 0.75];
const Y = [-2, 0, 1, 4];
const REF = "https://data.example.org/chain.h5";

/** Skip without DataLab-Capsule, or fail when CI requires provenance. */
function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

async function openPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/?runtime=worker");
  await waitForRuntimeReady(page);
  await forceSaveDownloadFallback(page);
  return page;
}

/** S0 -> S1 = S0 + 1 (opaque) -> S2 = normalize(S1, maximum) (replayable). */
async function buildChain(page: Page): Promise<boolean> {
  return page.evaluate(
    async ({ x, y }) => {
      const runtime = window.runtime;
      const info = await runtime.getProvenanceLedger();
      if (!info.available) return false;
      const s0 = await runtime.addSignalFromArrays({
        title: "S0",
        xdata: x,
        ydata: y,
        xunit: "s",
        yunit: "",
      });
      const [s1] = await runtime.applyFeature("addition_constant", [s0], null, {
        value: 1,
      });
      await runtime.applyFeature("normalize", [s1], null, {
        method: "maximum",
      });
      return true;
    },
    { x: X, y: Y },
  );
}

async function openDialog(page: Page): Promise<void> {
  await page.getByRole("menuitem", { name: "File" }).first().click();
  await page.getByRole("menuitem", { name: /Workspace capsule/ }).click();
  await expect(page.getByTestId("capsule-dialog")).toBeVisible();
}

async function closeDialog(page: Page): Promise<void> {
  await page
    .getByTestId("capsule-dialog")
    .getByRole("button", { name: "Close" })
    .click();
}

/** Click *trigger* and save the download it starts; return its path. */
async function download(
  page: Page,
  trigger: () => Promise<void>,
  name: string,
): Promise<string> {
  const pending = page.waitForEvent("download");
  await trigger();
  const file = await pending;
  const target = test.info().outputPath(name);
  await file.saveAs(target);
  return target;
}

/** Click *trigger* and give *path* to the file chooser it opens. */
async function choose(
  page: Page,
  trigger: () => Promise<void>,
  path: string,
): Promise<void> {
  const pending = page.waitForEvent("filechooser");
  await trigger();
  await (await pending).setFiles(path);
}

async function exportCapsule(
  page: Page,
  name: string,
  options: { revision?: boolean } = {},
): Promise<string> {
  await page.getByRole("tab", { name: "Export" }).click();
  await page.getByTestId("capsule-name").fill(name);
  if (options.revision !== undefined) {
    await page.getByTestId("capsule-as-revision").setChecked(options.revision);
  }
  return download(
    page,
    () => page.getByTestId("capsule-export-button").click(),
    `${name}.dlcapsule`,
  );
}

async function inspect(page: Page, path: string): Promise<void> {
  await page.getByRole("tab", { name: "Inspect" }).click();
  await choose(page, () => page.getByTestId("capsule-choose").click(), path);
  await expect(page.getByTestId("capsule-integrity-status")).toBeVisible();
}

test.describe("capsule exchange between two browsers", () => {
  test.describe.configure({ timeout: 600_000 });

  test("export, inspect, open, replay, revise and review", async ({
    browser,
  }) => {
    const author = await openPage(browser);
    requireProvenance(await buildChain(author));
    await openDialog(author);
    const parentPath = await exportCapsule(author, "chain");
    await expect(author.getByTestId("capsule-error")).toHaveCount(0);

    // -- Recipient: inspect without opening (integrity, nothing computed).
    const recipient = await openPage(browser);
    await openDialog(recipient);
    await inspect(recipient, parentPath);
    const integrity = recipient.getByTestId("capsule-integrity");
    await expect(recipient.getByTestId("capsule-integrity-status")).toHaveText(
      "Intact",
    );
    await expect(integrity).toContainText(
      "Stored states checked: 3, altered: 0",
    );
    await expect(
      recipient.getByTestId("capsule-activities").locator("tbody tr"),
    ).toHaveCount(2);
    await expect(recipient.getByTestId("capsule-documents")).toHaveCount(0);
    expect(
      await recipient.evaluate(
        async () => (await window.runtime.listSignals()).length,
      ),
    ).toBe(0);

    // -- Recipient: open, then replay locally and compare with the reference.
    await recipient.getByTestId("capsule-open").click();
    await expect
      .poll(() =>
        recipient.evaluate(
          async () => (await window.runtime.listSignals()).length,
        ),
      )
      .toBe(3);
    await recipient.getByRole("tab", { name: "Local replay" }).click();
    const rows = recipient.getByTestId("capsule-replay-row");
    await expect(rows).toHaveCount(2);
    await rows.nth(0).getByTestId("capsule-replay-button").click();
    await expect(rows.nth(0).getByTestId("capsule-replay-verdict")).toHaveText(
      "not_verified (unsupported_operation)",
    );
    await rows.nth(1).getByTestId("capsule-replay-button").click();
    await expect(rows.nth(1).getByTestId("capsule-replay-verdict")).toHaveText(
      "exact (ready)",
    );
    const reportPath = await download(
      recipient,
      () => rows.nth(1).getByTestId("capsule-save-report").click(),
      "report.json",
    );

    // -- Recipient: a new processing, then a child revision of the parent.
    await closeDialog(recipient);
    await recipient.evaluate(async () => {
      const [s0] = await window.runtime.listSignals();
      await window.runtime.applyFeature("normalize", [s0.id], null, {
        method: "amplitude",
      });
    });
    await openDialog(recipient);
    const childPath = await exportCapsule(recipient, "chain-continued", {
      revision: true,
    });

    // -- Recipient: a separate review of the child, citing the local report.
    await inspect(recipient, childPath);
    await expect(recipient.getByTestId("capsule-revision-of")).not.toHaveText(
      "none",
    );
    await recipient.getByTestId("capsule-reviewer").fill("Recipient");
    await recipient
      .getByTestId("capsule-statement")
      .fill("The normalisation replays exactly.");
    await recipient.getByTestId("capsule-verdict").selectOption("endorsed");
    await choose(
      recipient,
      () => recipient.getByTestId("capsule-cite-report").click(),
      reportPath,
    );
    const reviewPath = await download(
      recipient,
      () => recipient.getByTestId("capsule-write-review").click(),
      "review.json",
    );

    // -- Author: the review is consistent with the child only.
    await inspect(author, childPath);
    await choose(
      author,
      () => author.getByTestId("capsule-add-review").click(),
      reviewPath,
    );
    await choose(
      author,
      () => author.getByTestId("capsule-add-report").click(),
      reportPath,
    );
    await expect(author.getByTestId("capsule-review-status")).toContainText(
      "consistent",
    );
    await expect(author.getByTestId("capsule-report-status")).toContainText(
      "claimed verdict exact, consistent",
    );
    await expect(author.getByTestId("capsule-integrity-status")).toHaveText(
      "Intact",
    );
    await inspect(author, parentPath);
    await choose(
      author,
      () => author.getByTestId("capsule-add-review").click(),
      reviewPath,
    );
    await expect(author.getByTestId("capsule-review-status")).toContainText(
      "The review targets another capsule revision",
    );
    await expect(author.getByTestId("capsule-integrity-status")).toHaveText(
      "Intact",
    );

    // -- Author: compare the two revisions from the revision list.
    await author.getByRole("tab", { name: "Revisions" }).click();
    const list = author.getByTestId("capsule-revision-list");
    await expect(list.locator("tbody tr")).toHaveCount(2);
    const options = author.getByTestId("capsule-diff-old").locator("option");
    const labels = await options.allTextContents();
    const parentLabel = labels.find((l) => l.startsWith("chain ("))!;
    const childLabel = labels.find((l) => l.startsWith("chain-continued ("))!;
    await author.getByTestId("capsule-diff-old").selectOption({
      label: parentLabel,
    });
    await author.getByTestId("capsule-diff-new").selectOption({
      label: childLabel,
    });
    await author.getByTestId("capsule-compare").click();
    const diff = author.getByTestId("capsule-diff");
    await expect(diff).toContainText(
      "The newer revision names the older one as its parent.",
    );
    await expect(author.getByTestId("capsule-diff-scientific")).toContainText(
      "added activity",
    );
    await author.context().close();
    await recipient.context().close();
  });

  test("referenced workspace: checked and opened only when supplied", async ({
    browser,
  }) => {
    const author = await openPage(browser);
    requireProvenance(await buildChain(author));
    await openDialog(author);
    // The export saves the workspace (to publish at the IRI), then the capsule.
    const downloads: Download[] = [];
    author.on("download", (d) => downloads.push(d));
    await author.getByTestId("capsule-name").fill("chain-ref");
    await author.getByTestId("capsule-referenced").check();
    await author.getByTestId("capsule-workspace-ref").fill(REF);
    await author.getByTestId("capsule-export-button").click();
    await expect.poll(() => downloads.length).toBe(2);
    const [workspace, capsule] = downloads;
    expect(workspace.suggestedFilename()).toBe("chain.h5");
    expect(capsule.suggestedFilename()).toBe("chain-ref.dlcapsule");
    const workspacePath = test.info().outputPath("chain.h5");
    const capsulePath = test.info().outputPath("chain-ref.dlcapsule");
    await workspace.saveAs(workspacePath);
    await capsule.saveAs(capsulePath);

    const recipient = await openPage(browser);
    await openDialog(recipient);
    await inspect(recipient, capsulePath);
    await expect(recipient.getByTestId("capsule-summary")).toContainText(
      `referenced at ${REF}`,
    );
    await expect(recipient.getByTestId("capsule-integrity")).toContainText(
      "not supplied: stored states not checked",
    );
    await expect(recipient.getByTestId("capsule-open")).toBeDisabled();
    await choose(
      recipient,
      () => recipient.getByTestId("capsule-choose-workspace").click(),
      workspacePath,
    );
    await expect(recipient.getByTestId("capsule-integrity")).toContainText(
      "Stored states checked: 3, altered: 0",
    );
    await recipient.getByTestId("capsule-open").click();
    await expect
      .poll(() =>
        recipient.evaluate(
          async () => (await window.runtime.listSignals()).length,
        ),
      )
      .toBe(3);
    await author.context().close();
    await recipient.context().close();
  });
});
