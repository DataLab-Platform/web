/**
 * Legacy workspaces (saved without provenance) — end-to-end regression suite.
 *
 * Opens, in the real browser runtime (UI thread and kernel worker, arrays in
 * RAM and on disk), a workspace saved by the released DataLab 1.3.0. Its
 * processing records must become legacy activities with their issues, never be
 * replayed, and survive a save and a reopening in another context without
 * being imported twice.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

const LEGACY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "provenance",
  "legacy_1.3.0.h5",
);
// Operation and issues of each record, in workspace order (see the Python test).
const EXPECTED = [
  ["normalize", []],
  ["stats", ["result_not_identified"]],
  ["moving_average", []],
  ["average", ["unavailable_input"]],
  ["centroid", ["result_not_identified"]],
  ["gaussian_filter", []],
];

/** Skip without DataLab-Capsule, or fail when CI requires provenance. */
function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

interface LegacyRun {
  available: boolean;
  captureFailures: number;
  fileStatus: string | null;
  items: (string | string[] | null)[][];
  origins: string[];
  replays: string[];
  bytes: number[];
}

/** Open *data*, report the legacy activities, replay them, save the workspace. */
async function runLegacy(
  page: Page,
  mode: "ram" | "disk",
  data: number[],
): Promise<LegacyRun> {
  return page.evaluate(
    async ({ storageMode, workspace }) => {
      interface Info {
        available: boolean;
        capture_failures: number;
        file_status: string | null;
        ledger: {
          activities: { activity_id: string; origin: string }[];
        } | null;
        legacy: {
          items: { operation: string | null; issues: string[] }[];
        } | null;
      }
      interface Runtime {
        resetAll(): Promise<void>;
        setStorageMode(mode: "ram" | "disk"): Promise<void>;
        openWorkspaceHdf5(name: string, bytes: Uint8Array): Promise<unknown>;
        saveWorkspaceHdf5(): Promise<Uint8Array>;
        getProvenanceLedger(): Promise<Info>;
        replayActivity(
          id: string,
        ): Promise<{ restoration: string; eligibility: string }>;
      }
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      await runtime.resetAll();
      await runtime.setStorageMode(storageMode);
      try {
        const before = (await runtime.getProvenanceLedger()).capture_failures;
        await runtime.openWorkspaceHdf5("legacy.h5", new Uint8Array(workspace));
        const info = await runtime.getProvenanceLedger();
        if (info.ledger === null || info.legacy === null) {
          return { available: false } as LegacyRun;
        }
        const replays: string[] = [];
        for (const activity of info.ledger.activities) {
          const report = await runtime.replayActivity(activity.activity_id);
          replays.push(`${report.restoration}/${report.eligibility}`);
        }
        return {
          available: info.available,
          captureFailures: info.capture_failures - before,
          fileStatus: info.file_status,
          items: info.legacy.items.map((i) => [i.operation, i.issues]),
          origins: info.ledger.activities.map((a) => a.origin),
          replays,
          bytes: Array.from(await runtime.saveWorkspaceHdf5()),
        };
      } finally {
        await runtime.resetAll();
        await runtime.setStorageMode("ram");
      }
    },
    { storageMode: mode, workspace: data },
  );
}

function expectLegacy(run: LegacyRun): void {
  expect(run.captureFailures).toBe(0);
  expect(run.items).toEqual(EXPECTED);
  expect(run.origins).toEqual(EXPECTED.map(() => "legacy_metadata"));
  expect(run.replays).toEqual(
    EXPECTED.map(() => "opaque/unsupported_operation"),
  );
}

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`legacy workspace (${runtimeMode})`, () => {
    test.describe.configure({ timeout: 300_000 });

    let context: Awaited<ReturnType<Browser["newContext"]>>;
    let page: Page;
    // A separate context reads the saved file: no memory or OPFS reuse.
    let readerContext: Awaited<ReturnType<Browser["newContext"]>>;
    let reader: Page;
    const url = runtimeMode === "worker" ? "/?runtime=worker" : "/";

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      readerContext = await browser.newContext();
      reader = await readerContext.newPage();
      for (const p of [page, reader]) {
        await p.goto(url);
        await waitForRuntimeReady(p);
      }
    });

    test.afterAll(async () => {
      await context.close();
      await readerContext.close();
    });

    for (const storageMode of ["ram", "disk"] as const) {
      test(`imports records once and never replays them (${storageMode})`, async () => {
        const run = await runLegacy(
          page,
          storageMode,
          Array.from(readFileSync(LEGACY)),
        );
        requireProvenance(run.available);
        expect(run.fileStatus).toBe("absent");
        expectLegacy(run);
        const reopened = await runLegacy(reader, storageMode, run.bytes);
        expect(reopened.fileStatus).toBe("loaded");
        expectLegacy(reopened);
      });
    }
  });
}
