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
import { readFileSync } from "node:fs";

import { test, expect, type Download } from "@playwright/test";

import {
  buildChain,
  choose,
  closeDialog,
  download,
  exportCapsule,
  inspect,
  openDialog,
  openPage,
  requireProvenance,
  startRegistry,
} from "./capsuleHelpers";

const REF = "https://data.example.org/chain.h5";

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
      "exact (ready)",
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

  test("attachments: declared, listed and saved only on request", async ({
    browser,
  }) => {
    const protocol = Buffer.from("Acquired on bench 2.\n");
    const author = await openPage(browser);
    requireProvenance(await buildChain(author));
    await openDialog(author);
    await exportCapsule(author, "chain-plain");
    const picker = author.waitForEvent("filechooser");
    await author.getByTestId("capsule-add-attachment").click();
    await (
      await picker
    ).setFiles([
      { name: "protocol notes.txt", mimeType: "text/plain", buffer: protocol },
      {
        name: "points.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("x\n1\n"),
      },
    ]);
    await expect(author.getByTestId("capsule-attachment-selected")).toHaveText([
      /protocol_notes\.txt/,
      /points\.csv/,
    ]);
    const capsulePath = await exportCapsule(author, "chain-attached");
    await expect(author.getByTestId("capsule-error")).toHaveCount(0);

    // Attachment changes have their own group; nothing is inferred from them.
    await author.getByRole("tab", { name: "Revisions" }).click();
    const labels = await author
      .getByTestId("capsule-diff-old")
      .locator("option")
      .allTextContents();
    await author.getByTestId("capsule-diff-old").selectOption({
      label: labels.find((l) => l.startsWith("chain-plain ("))!,
    });
    await author.getByTestId("capsule-diff-new").selectOption({
      label: labels.find((l) => l.startsWith("chain-attached ("))!,
    });
    await author.getByTestId("capsule-compare").click();
    await expect(author.getByTestId("capsule-diff-attachments")).toContainText(
      "added attachment points.csv",
    );
    // An added attachment is not interpreted: whatever the workspace bytes
    // (saved again, they may differ), equality is not concluded and nothing
    // is scientific.
    await expect(author.getByTestId("capsule-diff-scientific")).toContainText(
      "(0)",
    );
    await expect(author.getByTestId("capsule-diff-conclusion")).toContainText(
      "equality is not established",
    );

    const recipient = await openPage(browser);
    await openDialog(recipient);
    await inspect(recipient, capsulePath);
    await expect(recipient.getByTestId("capsule-integrity-status")).toHaveText(
      "Intact",
    );
    const rows = recipient.getByTestId("capsule-attachment-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("protocol_notes.txt");
    await expect(rows.nth(0)).toContainText("text/plain");
    const saved = await download(
      recipient,
      () => rows.nth(0).getByTestId("capsule-attachment-save").click(),
      "protocol_notes.txt",
    );
    expect(readFileSync(saved)).toEqual(protocol);
    // Saving an attachment opened nothing.
    expect(
      await recipient.evaluate(
        async () => (await window.runtime.listSignals()).length,
      ),
    ).toBe(0);
    await recipient.getByTestId("capsule-open").click();
    await expect
      .poll(() =>
        recipient.evaluate(
          async () => (await window.runtime.listSignals()).length,
        ),
      )
      .toBe(3);
    // A child revision does not copy the parent's attachments: the export says
    // so until they are selected again.
    await recipient.getByRole("tab", { name: "Export" }).click();
    await expect(recipient.getByTestId("capsule-as-revision")).toBeChecked();
    await expect(
      recipient.getByTestId("capsule-parent-attachments"),
    ).toContainText("protocol_notes.txt, points.csv");
    await author.context().close();
    await recipient.context().close();
  });
});

test.describe("capsule registry (optional)", () => {
  test.describe.configure({ timeout: 600_000 });

  test("publish, list, retrieve and check through a registry", async ({
    browser,
  }) => {
    const registry = await startRegistry("e2e-token");
    if (process.env.DLW_REQUIRE_REGISTRY === "1") {
      expect(registry, "the registry must start").not.toBeNull();
    } else {
      test.skip(!registry, "No DataLab-Capsule registry available");
    }
    const { url, stop } = registry!;
    try {
      const protocol = Buffer.from("Acquired on bench 2.\n");
      // -- Author: export with an attachment, then publish with the token.
      const author = await openPage(browser);
      requireProvenance(await buildChain(author));
      await openDialog(author);
      await expect(author.getByTestId("capsule-publish")).toHaveCount(0);
      await author.getByRole("tab", { name: "Registry" }).click();
      await author.getByTestId("capsule-registry-address").fill(url);
      await author.getByTestId("capsule-registry-token").fill("e2e-token");
      await author.getByTestId("capsule-registry-save").click();
      await author.getByRole("tab", { name: "Export" }).click();
      const picker = author.waitForEvent("filechooser");
      await author.getByTestId("capsule-add-attachment").click();
      await (
        await picker
      ).setFiles({
        name: "protocol.txt",
        mimeType: "text/plain",
        buffer: protocol,
      });
      const capsulePath = await exportCapsule(author, "chain-published");
      await inspect(author, capsulePath);
      await author.getByTestId("capsule-publish").click();
      await expect(author.getByTestId("capsule-published")).toContainText(
        "with 1 attachments and 0 reviews",
      );
      await author.getByTestId("capsule-reviewer").fill("Author");
      await author.getByTestId("capsule-statement").fill("Published as is.");
      await author.getByTestId("capsule-publish-review").click();
      await expect(
        author.getByTestId("capsule-review-published"),
      ).toBeVisible();

      // -- Recipient: no token; list, retrieve, check and save the attachment.
      const recipient = await openPage(browser);
      await openDialog(recipient);
      await recipient.getByRole("tab", { name: "Registry" }).click();
      await recipient.getByTestId("capsule-registry-address").fill(url);
      await recipient.getByTestId("capsule-registry-save").click();
      await recipient.getByTestId("capsule-registry-refresh").click();
      await expect(
        recipient.getByTestId("capsule-registry-status"),
      ).toContainText("Connected to datalab-capsule");
      const rows = recipient.getByTestId("capsule-registry-row");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("chain-published");
      await rows.first().getByTestId("capsule-registry-retrieve").click();
      const retrieved = recipient.getByTestId("capsule-registry-retrieved");
      await expect(retrieved).toContainText("Manifest checked: valid");
      await expect(
        recipient.getByTestId("capsule-registry-review"),
      ).toContainText("Author: Published as is. (valid)");
      const saved = await download(
        recipient,
        () => retrieved.getByTestId("capsule-attachment-save").first().click(),
        "protocol.txt",
      );
      expect(readFileSync(saved)).toEqual(protocol);
      // A recipient without token cannot publish.
      expect(
        await recipient.evaluate(
          async (base) =>
            (await fetch(`${base}/api/v1/revisions`, { method: "POST" }))
              .status,
          url,
        ),
      ).toBe(401);
      await recipient.getByRole("tab", { name: "Revisions" }).click();
      await expect(
        recipient.getByTestId("capsule-revision-list").locator("tbody tr"),
      ).toContainText(["from the registry"]);
      await author.context().close();
      await recipient.context().close();
    } finally {
      stop();
    }
  });
});
