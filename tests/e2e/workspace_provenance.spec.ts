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

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`workspace provenance (${runtimeMode})`, () => {
    test.describe.configure({ timeout: 300_000 });

    let context: Awaited<ReturnType<Browser["newContext"]>>;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      await page.goto(runtimeMode === "worker" ? "/?runtime=worker" : "/");
      await waitForRuntimeReady(page);
    });

    test.afterAll(async () => {
      await context.close();
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
    }
  });
}
