/**
 * Workspace provenance of the signal difference — end-to-end regression suite.
 *
 * The difference aligns its operand on the source grid with a versioned Sigima
 * rule, recorded with each execution. This suite drives the real browser
 * runtime (UI thread and kernel worker, arrays in RAM and on disk) and checks
 * the computed values, the recorded roles and rule, exact replays after a
 * save/reopen in another context, and the reopening of the Desktop reference
 * file. Set ``DLW_WRITE_PROVENANCE_FIXTURE=1`` to rewrite the Web reference
 * file from the main-thread RAM run.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "provenance",
);
const DIFFERENCE = { id: "sigima.signal.difference", contract_version: 1 };
const RULE = {
  rule: "sigima.signal.x_alignment.source_grid_linear",
  version: 1,
  interpolated: true,
};
// Asymmetric case where both orders are valid (exact analytical oracles).
const A_MINUS_B = [0, -1, 0, 3];
const B_MINUS_A = [0, 0.5, -3];

/** Skip without DataLab-Capsule, or fail when CI requires provenance. */
function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

interface DifferenceRun {
  available: boolean;
  captureFailures: number;
  /** Result Y of A - B and B - A (null when not found). */
  outputY: (number[] | null)[];
  /** Object UUIDs of the source and operand of each activity. */
  roles: { role: string; uuid: string }[][];
  operations: unknown[];
  contexts: unknown[];
  editions: string[];
  verdicts: string[];
  /** Error raised by a refused difference (operand not covering the source). */
  refusal: string;
  bytes: number[];
}

/** Compute A - B and B - A (or reopen *data*), then replay every activity. */
async function runDifferences(
  page: Page,
  mode: "ram" | "disk",
  data: number[] | null,
): Promise<DifferenceRun> {
  return page.evaluate(
    async ({ storageMode, workspace }) => {
      interface Activity {
        activity_id: string;
        edition: string;
        context: { x_alignment: unknown };
        call: {
          operation: unknown;
          inputs: { role: string; binding: { state_id: string } }[];
        };
        outputs: { state_id: string }[];
      }
      interface Runtime {
        resetAll(): Promise<void>;
        setStorageMode(mode: "ram" | "disk"): Promise<void>;
        addSignalFromArrays(params: {
          title: string;
          xdata: number[];
          ydata: number[];
          xunit: string;
          yunit: string;
        }): Promise<string>;
        applyFeature(
          featureId: string,
          sourceIds: string[],
          operandId: string | null,
          params: Record<string, unknown> | null,
        ): Promise<string[]>;
        openWorkspaceHdf5(name: string, bytes: Uint8Array): Promise<unknown>;
        saveWorkspaceHdf5(): Promise<Uint8Array>;
        listSignals(): Promise<{ id: string; uuid: string | null }[]>;
        getSignalData(id: string): Promise<{ y: ArrayLike<number> }>;
        getProvenanceLedger(): Promise<{
          available: boolean;
          capture_failures: number;
          ledger: {
            states: Record<string, { object_uuid: string }>;
            activities: Activity[];
          } | null;
        }>;
        replayActivity(id: string): Promise<{ verdict: string }>;
      }
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      await runtime.resetAll();
      await runtime.setStorageMode(storageMode);
      try {
        const before = (await runtime.getProvenanceLedger()).capture_failures;
        let refusal = "";
        if (workspace === null) {
          const add = (title: string, x: number[], y: number[]) =>
            runtime.addSignalFromArrays({
              title,
              xdata: x,
              ydata: y,
              xunit: "s",
              yunit: "V",
            });
          const a = await add("A", [0, 1, 2, 3], [0, 1, 4, 9]);
          const b = await add("B", [0, 1.5, 3], [0, 3, 6]);
          await runtime.applyFeature("difference", [a], b, null);
          await runtime.applyFeature("difference", [b], a, null);
          const short = await add("short", [0.5, 1, 2], [0, 1, 2]);
          try {
            await runtime.applyFeature("difference", [a], short, null);
          } catch (err) {
            refusal = err instanceof Error ? err.message : String(err);
          }
        } else {
          await runtime.openWorkspaceHdf5(
            "differences.h5",
            new Uint8Array(workspace),
          );
        }
        const info = await runtime.getProvenanceLedger();
        const ledger = info.ledger;
        if (ledger === null) {
          return { available: false } as DifferenceRun;
        }
        const signals = await runtime.listSignals();
        const outputY: (number[] | null)[] = [];
        const verdicts: string[] = [];
        for (const activity of ledger.activities) {
          const uuid = ledger.states[activity.outputs[0].state_id].object_uuid;
          const meta = signals.find((s) => s.uuid === uuid);
          outputY.push(
            meta ? Array.from((await runtime.getSignalData(meta.id)).y) : null,
          );
          verdicts.push(
            (await runtime.replayActivity(activity.activity_id)).verdict,
          );
        }
        return {
          available: info.available,
          captureFailures: info.capture_failures - before,
          outputY,
          roles: ledger.activities.map((activity) =>
            activity.call.inputs.map((item) => ({
              role: item.role,
              uuid: ledger.states[item.binding.state_id].object_uuid,
            })),
          ),
          operations: ledger.activities.map((a) => a.call.operation),
          contexts: ledger.activities.map((a) => a.context.x_alignment),
          editions: ledger.activities.map((a) => a.edition),
          verdicts,
          refusal,
          bytes:
            workspace === null
              ? Array.from(await runtime.saveWorkspaceHdf5())
              : [],
        };
      } finally {
        await runtime.resetAll();
        await runtime.setStorageMode("ram");
      }
    },
    { storageMode: mode, workspace: data },
  );
}

function expectDifferences(run: DifferenceRun, edition: string): void {
  expect(run.operations).toEqual([DIFFERENCE, DIFFERENCE]);
  expect(run.contexts).toEqual([RULE, RULE]);
  expect(run.editions).toEqual([edition, edition]);
  expect(run.outputY).toEqual([A_MINUS_B, B_MINUS_A]);
  const [ab, ba] = run.roles;
  expect(ab.map((r) => r.role)).toEqual(["source", "operand"]);
  expect(ba.map((r) => r.uuid)).toEqual([ab[1].uuid, ab[0].uuid]);
  expect(run.verdicts).toEqual(["exact", "exact"]);
}

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`difference provenance (${runtimeMode})`, () => {
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
      test(`aligns, records, reopens and replays (${storageMode})`, async () => {
        const run = await runDifferences(page, storageMode, null);
        requireProvenance(run.available);
        expect(run.captureFailures).toBe(0);
        expectDifferences(run, "web");
        expect(run.refusal).toContain("does not cover the source grid");
        if (
          process.env.DLW_WRITE_PROVENANCE_FIXTURE &&
          runtimeMode === "main" &&
          storageMode === "ram"
        ) {
          mkdirSync(FIXTURES, { recursive: true });
          writeFileSync(
            path.join(FIXTURES, "web_difference.h5"),
            Buffer.from(run.bytes),
          );
        }
        const reopened = await runDifferences(reader, storageMode, run.bytes);
        expectDifferences(reopened, "web");
      });
    }

    test("reopens and replays the Desktop reference file", async () => {
      const bytes = Array.from(
        readFileSync(path.join(FIXTURES, "desktop_difference.h5")),
      );
      const run = await runDifferences(reader, "ram", bytes);
      requireProvenance(run.available);
      expectDifferences(run, "desktop");
    });
  });
}
