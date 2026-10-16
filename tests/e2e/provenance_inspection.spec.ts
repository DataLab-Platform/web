/**
 * Provenance of a result — end-to-end suite (consultation and Processing).
 *
 * Drives the real browser runtime, on the UI thread and in the kernel worker,
 * with arrays in RAM and on disk (OPFS):
 *
 * - the sigma scenario: S0 -> Gaussian filter (sigma = 2) -> S1 -> normalize
 *   -> S2, then S1 applied again with sigma = 5. The provenance of S2 still
 *   describes sigma = 2; checking the data finds the changed input (RAM) or
 *   reports data that are not loaded (disk), never paging them in;
 * - an n-to-1 average without parameters, applied again from Processing: the
 *   new activity records every source;
 * - the Provenance tab of the side panel shows the recorded production.
 *
 * The suite skips itself when the runtime reports provenance as unavailable,
 * unless ``DLW_REQUIRE_PROVENANCE=1`` makes it fail instead (CI).
 */
import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

interface ScenarioResult {
  available: boolean;
  production: string | null;
  inputTitle: string | null;
  ancestorSigma: unknown;
  checkedContent: string | null;
  checkedInput: string | null;
  averageInputs: number;
  averageOrigin: string | null;
  averageSameUuid: boolean;
  captureFailures: number;
  s2: string;
}

async function runScenario(
  page: Page,
  mode: "ram" | "disk",
): Promise<ScenarioResult> {
  return page.evaluate(async (storageMode) => {
    interface Description {
      available: boolean;
      state?: { state_id: string } | null;
      anchor?: { content: string };
      production?: {
        activity_id: string;
        operation: { id: string } | null;
        parameters: Record<string, unknown> | null;
        inputs: { state_id: string; title: string | null; data: string }[];
      } | null;
    }
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
      describeObjectProvenance(
        id: string,
        options?: { stateId?: string; checkData?: boolean; trail?: string[] },
      ): Promise<Description>;
      getProvenanceLedger(): Promise<{
        available: boolean;
        capture_failures: number;
        ledger: {
          states: Record<string, { object_uuid: string }>;
          activities: {
            origin: string;
            call: { inputs: unknown[] };
            outputs: { state_id: string }[];
          }[];
        } | null;
      }>;
    }
    const runtime = (window as unknown as { runtime: Runtime }).runtime;
    await runtime.resetAll();
    await runtime.setStorageMode(storageMode);
    const before = (await runtime.getProvenanceLedger()).capture_failures;
    const xdata = [0, 1, 2, 3];
    const s0 = await runtime.addSignalFromArrays({
      title: "S0",
      xdata,
      ydata: [-2, 0, 1, 4],
    });
    const [s1] = await runtime.applyFeature("gaussian_filter", [s0], null, {
      sigma: 2.0,
    });
    const [s2] = await runtime.applyFeature("normalize", [s1], null, {
      method: "maximum",
    });
    await runtime.reapplyLastProcessing(s1, { sigma: 5.0 });
    const view = await runtime.describeObjectProvenance(s2);
    const input = view.production?.inputs[0] ?? null;
    const ancestor = input
      ? await runtime.describeObjectProvenance(s2, {
          stateId: input.state_id,
          trail: view.state ? [view.state.state_id] : [],
        })
      : null;
    const checked = await runtime.describeObjectProvenance(s2, {
      checkData: true,
    });
    const sources = [];
    for (let i = 0; i < 3; i++) {
      sources.push(
        await runtime.addSignalFromArrays({
          title: `A${i}`,
          xdata,
          ydata: [i, i + 1, i + 2, i + 3],
        }),
      );
    }
    const [mean] = await runtime.applyFeature("average", sources, null, null);
    await runtime.reapplyLastProcessing(mean, null);
    const info = await runtime.getProvenanceLedger();
    const activities = info.ledger?.activities ?? [];
    const last = activities[activities.length - 1];
    const first = activities[activities.length - 2];
    const uuidOf = (activity: (typeof activities)[number] | undefined) =>
      activity
        ? info.ledger!.states[activity.outputs[0].state_id].object_uuid
        : null;
    return {
      available: view.available,
      production: view.production?.operation?.id ?? null,
      inputTitle: input?.title ?? null,
      ancestorSigma: ancestor?.production?.parameters?.sigma,
      checkedContent: checked.anchor?.content ?? null,
      checkedInput: checked.production?.inputs[0]?.data ?? null,
      averageInputs: last?.call.inputs.length ?? 0,
      averageOrigin: last?.origin ?? null,
      averageSameUuid: uuidOf(last) !== null && uuidOf(last) === uuidOf(first),
      captureFailures: info.capture_failures - before,
      s2,
    };
  }, mode);
}

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`provenance of a result (${runtimeMode})`, () => {
    test.describe.configure({ timeout: 300_000 });

    let context: Awaited<ReturnType<Browser["newContext"]>>;
    let page: Page;
    const url = runtimeMode === "worker" ? "/?runtime=worker" : "/";

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
      page.on("pageerror", (err) => console.log("[pageerror]", err.message));
      await page.goto(url);
      await waitForRuntimeReady(page);
    });

    test.afterAll(async () => {
      await page.evaluate(async () => {
        const runtime = (
          window as unknown as {
            runtime: {
              resetAll(): Promise<void>;
              setStorageMode(mode: string): Promise<void>;
            };
          }
        ).runtime;
        await runtime.resetAll();
        await runtime.setStorageMode("ram");
      });
      await context.close();
    });

    for (const storageMode of ["ram", "disk"] as const) {
      test(`describes the state actually used (${storageMode})`, async () => {
        const result = await runScenario(page, storageMode);
        requireProvenance(result.available);
        expect(result.production).toBe("sigima.signal.normalize");
        expect(result.inputTitle).not.toBeNull();
        expect(result.ancestorSigma).toBe(2);
        if (storageMode === "ram") {
          expect(result.checkedContent).toBe("matches");
          expect(result.checkedInput).toBe("changed");
        } else {
          // Arrays on disk are never paged in to be checked.
          expect(result.checkedContent).toBe("unavailable");
          expect(result.checkedInput).toBe("unavailable");
        }
        expect(result.averageInputs).toBe(3);
        expect(result.averageOrigin).toBe("recompute_in_place");
        expect(result.averageSameUuid).toBe(true);
        expect(result.captureFailures).toBe(0);
      });
    }

    test("shows the Provenance tab of the selected object", async () => {
      const result = await runScenario(page, "ram");
      requireProvenance(result.available);
      // The tree refreshes on panel switch for objects created by the API.
      await page.getByRole("tab", { name: "Images" }).click();
      await page.getByRole("tab", { name: "Signals" }).click();
      const items = page.locator(".object-tree-item");
      await expect
        .poll(() => items.count(), { timeout: 30_000 })
        .toBeGreaterThanOrEqual(3);
      await items
        .filter({ hasText: /normalize/i })
        .first()
        .click();
      await page.getByRole("tab", { name: "Provenance" }).click();
      const panel = page.getByTestId("provenance-panel");
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel).toContainText("sigima.signal.normalize");
      await page.getByRole("button", { name: "Check data" }).click();
      await expect(panel).toContainText(
        "This input has changed since the computation",
        { timeout: 30_000 },
      );
    });
  });
}
