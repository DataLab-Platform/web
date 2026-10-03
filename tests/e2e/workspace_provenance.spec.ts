/**
 * Workspace provenance — end-to-end regression suite.
 *
 * Signal 1-to-1 processing is recorded in a workspace ledger by the Pyodide
 * runtime (``dlw_provenance.py``) when the optional DataLab-Capsule wheel is
 * installed. This suite drives the real browser runtime on the UI thread and
 * in the kernel worker, with arrays in RAM and on disk (OPFS), and checks
 * that processing, in-place re-application and verification produce the
 * expected ledger and reports. On-disk sources must be paged in before they
 * are fingerprinted, so a disk run must record no capture failure.
 *
 * The suite skips itself when the runtime reports provenance as unavailable
 * (no DataLab-Capsule install spec configured for the build).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

interface ScenarioResult {
  available: boolean;
  resultY: number[];
  reappliedY: number[];
  activities: {
    operation: unknown;
    parameters: unknown;
    origin: string;
    edition: string;
    outputUuid: string;
  }[];
  captureFailures: number;
  verdicts: string[];
  sameOid: boolean;
}

async function runScenario(
  page: Page,
  mode: "ram" | "disk",
): Promise<ScenarioResult> {
  return page.evaluate(async (storageMode) => {
    interface Runtime {
      resetAll(): Promise<void>;
      setStorageMode(mode: "ram" | "disk"): Promise<void>;
      addSignalFromArrays(params: {
        title: string;
        xdata: number[];
        ydata: number[];
      }): Promise<string>;
      applyFeature(
        featureId: string,
        sourceIds: string[],
        operandId: string | null,
        params: Record<string, unknown> | null,
      ): Promise<string[]>;
      reapplyLastProcessing(
        id: string,
        values: Record<string, unknown> | null,
      ): Promise<string>;
      getSignalData(id: string): Promise<{ y: ArrayLike<number> }>;
      getProvenanceLedger(): Promise<{
        available: boolean;
        capture_failures: number;
        ledger: {
          states: Record<string, { object_uuid: string }>;
          activities: {
            activity_id: string;
            origin: string;
            edition: string;
            call: { operation: unknown; parameters: unknown };
            outputs: { state_id: string }[];
          }[];
        } | null;
      }>;
      replayActivity(id: string): Promise<{ verdict: string }>;
    }
    const runtime = (window as unknown as { runtime: Runtime }).runtime;
    await runtime.resetAll();
    await runtime.setStorageMode(storageMode);
    try {
      const failuresBefore = (await runtime.getProvenanceLedger())
        .capture_failures;
      const source = await runtime.addSignalFromArrays({
        title: "oracle",
        xdata: [0, 1, 2, 3],
        ydata: [-2, 0, 1, 4],
      });
      const [result] = await runtime.applyFeature("normalize", [source], null, {
        method: "maximum",
      });
      const resultY = Array.from((await runtime.getSignalData(result)).y);
      const reapplied = await runtime.reapplyLastProcessing(result, {
        method: "amplitude",
      });
      const reappliedY = Array.from((await runtime.getSignalData(result)).y);
      const info = await runtime.getProvenanceLedger();
      const ledger = info.ledger;
      const activities = (ledger?.activities ?? []).map((activity) => ({
        operation: activity.call.operation,
        parameters: activity.call.parameters,
        origin: activity.origin,
        edition: activity.edition,
        outputUuid: ledger!.states[activity.outputs[0].state_id].object_uuid,
      }));
      const verdicts: string[] = [];
      for (const activity of ledger?.activities ?? []) {
        verdicts.push(
          (await runtime.replayActivity(activity.activity_id)).verdict,
        );
      }
      return {
        available: info.available,
        resultY,
        reappliedY,
        activities,
        captureFailures: info.capture_failures - failuresBefore,
        verdicts,
        sameOid: reapplied === result,
      };
    } finally {
      await runtime.resetAll();
      await runtime.setStorageMode("ram");
    }
  }, mode);
}

const NORMALIZE = { id: "sigima.signal.normalize", contract_version: 1 };
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "provenance",
);

/** Run the chain scenario (S0 -> S1 opaque -> S2 -> S3, S0 -> S4) and save. */
async function saveChain(
  page: Page,
  mode: "ram" | "disk",
): Promise<{ available: boolean; bytes: number[] }> {
  return page.evaluate(async (storageMode) => {
    interface Runtime {
      resetAll(): Promise<void>;
      setStorageMode(mode: "ram" | "disk"): Promise<void>;
      addSignalFromArrays(params: {
        title: string;
        xdata: number[];
        ydata: number[];
        xunit: string;
      }): Promise<string>;
      applyFeature(
        featureId: string,
        sourceIds: string[],
        operandId: string | null,
        params: Record<string, unknown> | null,
      ): Promise<string[]>;
      saveWorkspaceHdf5(): Promise<Uint8Array>;
      getProvenanceLedger(): Promise<{ available: boolean }>;
    }
    const runtime = (window as unknown as { runtime: Runtime }).runtime;
    await runtime.resetAll();
    await runtime.setStorageMode(storageMode);
    try {
      const s0 = await runtime.addSignalFromArrays({
        title: "S0",
        xdata: [0, 0.25, 0.5, 0.75],
        ydata: [-2, 0, 1, 4],
        xunit: "s",
      });
      const apply = async (id: string, feature: string, params: object) =>
        (await runtime.applyFeature(feature, [id], null, { ...params }))[0];
      const s1 = await apply(s0, "addition_constant", { value: 1.0 });
      const s2 = await apply(s1, "normalize", { method: "maximum" });
      await apply(s2, "normalize", { method: "amplitude" });
      await apply(s0, "normalize", { method: "amplitude" });
      const { available } = await runtime.getProvenanceLedger();
      return {
        available,
        bytes: Array.from(await runtime.saveWorkspaceHdf5()),
      };
    } finally {
      await runtime.resetAll();
      await runtime.setStorageMode("ram");
    }
  }, mode);
}

interface ReopenResult {
  available: boolean;
  fileStatus: string | null;
  stateStatus: Record<string, string>;
  editions: string[];
  operations: unknown[];
  parameters: unknown[];
  outputY: (number[] | null)[];
  verdicts: { restoration: string; eligibility: string; verdict: string }[];
  environmentMatch: string[];
}

/** Open a workspace, then replay its activities S0 -> S4 and S1 -> S2. */
async function reopenChain(
  page: Page,
  mode: "ram" | "disk",
  bytes: number[],
): Promise<ReopenResult> {
  return page.evaluate(
    async ({ storageMode, data }) => {
      interface Activity {
        activity_id: string;
        edition: string;
        call: { operation: unknown; parameters: unknown };
        outputs: { state_id: string }[];
      }
      interface Runtime {
        resetAll(): Promise<void>;
        setStorageMode(mode: "ram" | "disk"): Promise<void>;
        openWorkspaceHdf5(name: string, bytes: Uint8Array): Promise<unknown>;
        listSignals(): Promise<{ id: string; uuid: string | null }[]>;
        getSignalData(id: string): Promise<{ y: ArrayLike<number> }>;
        getProvenanceLedger(): Promise<{
          file_status: string | null;
          state_status: Record<string, string>;
          ledger: {
            states: Record<string, { object_uuid: string }>;
            activities: Activity[];
          } | null;
        }>;
        replayActivity(id: string): Promise<{
          restoration: string;
          eligibility: string;
          verdict: string;
          environment: { match: string };
        }>;
      }
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      await runtime.resetAll();
      await runtime.setStorageMode(storageMode);
      try {
        await runtime.openWorkspaceHdf5("chain.h5", new Uint8Array(data));
        const info = await runtime.getProvenanceLedger();
        const ledger = info.ledger;
        if (ledger === null) {
          return { available: false } as ReopenResult;
        }
        const activities = ledger.activities;
        const signals = await runtime.listSignals();
        const outputY: (number[] | null)[] = [];
        for (const activity of activities) {
          const uuid = ledger.states[activity.outputs[0].state_id].object_uuid;
          const meta = signals.find((s) => s.uuid === uuid);
          outputY.push(
            meta ? Array.from((await runtime.getSignalData(meta.id)).y) : null,
          );
        }
        const reports = [];
        for (const index of [0, 3, 1]) {
          reports.push(
            await runtime.replayActivity(activities[index].activity_id),
          );
        }
        return {
          available: true,
          fileStatus: info.file_status,
          stateStatus: info.state_status,
          editions: activities.map((a) => a.edition),
          operations: activities.map((a) => a.call.operation),
          parameters: activities.map((a) => a.call.parameters),
          outputY,
          verdicts: reports.map(({ restoration, eligibility, verdict }) => ({
            restoration,
            eligibility,
            verdict,
          })),
          environmentMatch: reports.map((r) => r.environment.match),
        };
      } finally {
        await runtime.resetAll();
        await runtime.setStorageMode("ram");
      }
    },
    { storageMode: mode, data: bytes },
  );
}

function expectChain(result: ReopenResult, edition: string): void {
  expect(result.fileStatus).toBe("loaded");
  expect(result.stateStatus).toEqual({});
  expect(result.editions).toEqual([edition, edition, edition, edition]);
  expect(result.operations).toEqual([null, NORMALIZE, NORMALIZE, NORMALIZE]);
  expect(result.parameters).toEqual([
    { value: 1 },
    { method: "maximum" },
    { method: "amplitude" },
    { method: "amplitude" },
  ]);
  expect(result.outputY[0]).toEqual([-1, 1, 2, 5]);
  expect(result.outputY[1]).toEqual([-1 / 5, 1 / 5, 2 / 5, 1]);
  expect(result.outputY[3]).toEqual([0, 1 / 3, 0.5, 1]);
  expect(result.verdicts).toEqual([
    {
      restoration: "opaque",
      eligibility: "unsupported_operation",
      verdict: "not_verified",
    },
    { restoration: "replayable", eligibility: "ready", verdict: "exact" },
    { restoration: "replayable", eligibility: "ready", verdict: "exact" },
  ]);
}

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`workspace provenance (${runtimeMode})`, () => {
    test.describe.configure({ timeout: 300_000 });

    let context: Awaited<ReturnType<Browser["newContext"]>>;
    let page: Page;
    // A separate context reads the saved files: no memory or OPFS reuse.
    let readerContext: Awaited<ReturnType<Browser["newContext"]>>;
    let reader: Page;
    const url = runtimeMode === "worker" ? "/?runtime=worker" : "/";

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      readerContext = await browser.newContext();
      reader = await readerContext.newPage();
      for (const p of [page, reader]) {
        p.on("console", (msg) => {
          if (msg.type() === "error")
            console.log("[browser:error]", msg.text());
        });
        p.on("pageerror", (err) => console.log("[pageerror]", err.message));
        await p.goto(url);
        await waitForRuntimeReady(p);
      }
    });

    test.afterAll(async () => {
      await context.close();
      await readerContext.close();
    });

    for (const storageMode of ["ram", "disk"] as const) {
      test(`records, re-applies and verifies (${storageMode})`, async () => {
        const result = await runScenario(page, storageMode);
        test.skip(!result.available, "DataLab-Capsule is not installed");
        expect(result.resultY).toEqual([-0.5, 0, 0.25, 1]);
        expect(result.reappliedY[0]).toBe(0);
        expect(result.reappliedY[3]).toBe(1);
        expect(result.sameOid).toBe(true);
        expect(result.captureFailures).toBe(0);
        expect(result.activities).toHaveLength(2);
        const [ordinary, recompute] = result.activities;
        expect(ordinary.operation).toEqual(NORMALIZE);
        expect(ordinary.parameters).toEqual({ method: "maximum" });
        expect(ordinary.origin).toBe("ordinary");
        expect(ordinary.edition).toBe("web");
        expect(recompute.parameters).toEqual({ method: "amplitude" });
        expect(recompute.origin).toBe("recompute_in_place");
        // In-place re-application keeps the object's persistent UUID.
        expect(recompute.outputUuid).toBe(ordinary.outputUuid);
        // The superseded result can no longer be verified; the current one
        // is reproduced exactly.
        expect(result.verdicts).toEqual(["not_verified", "exact"]);
      });

      test(`saves, reopens elsewhere and replays a chain (${storageMode})`, async () => {
        const saved = await saveChain(page, storageMode);
        test.skip(!saved.available, "DataLab-Capsule is not installed");
        if (
          process.env.DLW_WRITE_PROVENANCE_FIXTURE &&
          runtimeMode === "main" &&
          storageMode === "ram"
        ) {
          mkdirSync(FIXTURES, { recursive: true });
          writeFileSync(
            path.join(FIXTURES, "web_chain.h5"),
            Buffer.from(saved.bytes),
          );
        }
        const result = await reopenChain(reader, storageMode, saved.bytes);
        expectChain(result, "web");
      });

      test(`reopens and replays the Desktop reference file (${storageMode})`, async () => {
        const bytes = Array.from(
          readFileSync(path.join(FIXTURES, "desktop_chain.h5")),
        );
        const result = await reopenChain(reader, storageMode, bytes);
        test.skip(!result.available, "DataLab-Capsule is not installed");
        expectChain(result, "desktop");
        expect(result.environmentMatch.slice(1)).toEqual([
          "different",
          "different",
        ]);
      });
    }
  });
}
