/**
 * Numerical qualification of the replayable operations in the browser.
 *
 * Every qualified normalisation method and the signal difference (operand
 * aligned on the source grid) must give their exact literal oracles in Pyodide
 * (UI thread and kernel worker) and replay with an ``exact`` verdict.
 */
import { test, expect, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

const X = [0, 0.25, 0.5, 0.75];
const Y = [-2, 0, 1, 4];
// Perfect-square energy (25) and mean square (6.25).
const Y2 = [-3, 0, 4, 0];
const CASES: [string, number[], number[]][] = [
  ["maximum", Y, [-0.5, 0, 0.25, 1]],
  ["amplitude", Y, [0, 1 / 3, 0.5, 1]],
  ["area", Y, [-2 / 3, 0, 1 / 3, 4 / 3]],
  ["energy", Y2, [-0.6, 0, 0.8, 0]],
  ["rms", Y2, [-1.2, 0, 1.6, 0]],
];

/** Skip without DataLab-Capsule, or fail when CI requires provenance. */
function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

interface QualificationRun {
  available: boolean;
  normalize: { y: number[]; verdict: string }[];
  difference: { x: number[]; y: number[]; verdict: string }[];
}

async function runQualification(page: Page): Promise<QualificationRun> {
  return page.evaluate(
    async ({ x, cases }) => {
      interface Runtime {
        resetAll(): Promise<void>;
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
        getSignalData(
          id: string,
        ): Promise<{ x: ArrayLike<number>; y: ArrayLike<number> }>;
        getProvenanceLedger(): Promise<{
          available: boolean;
          ledger: { activities: { activity_id: string }[] } | null;
        }>;
        replayActivity(id: string): Promise<{ verdict: string }>;
      }
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      await runtime.resetAll();
      try {
        const add = (title: string, xs: number[], ys: number[]) =>
          runtime.addSignalFromArrays({
            title,
            xdata: xs,
            ydata: ys,
            xunit: "s",
            yunit: "V",
          });
        const lastVerdict = async () => {
          const ledger = (await runtime.getProvenanceLedger()).ledger;
          if (ledger === null) {
            return "unavailable";
          }
          const last = ledger.activities[ledger.activities.length - 1];
          return (await runtime.replayActivity(last.activity_id)).verdict;
        };
        const available = (await runtime.getProvenanceLedger()).available;
        const normalize = [];
        for (const [method, ys] of cases) {
          const src = await add(method, x, ys);
          const [result] = await runtime.applyFeature(
            "normalize",
            [src],
            null,
            {
              method,
            },
          );
          const data = await runtime.getSignalData(result);
          normalize.push({
            y: Array.from(data.y),
            verdict: await lastVerdict(),
          });
        }
        const a = await add("A", [0, 1, 2, 3], [0, 1, 4, 9]);
        const b = await add("B", [0, 1.5, 3], [0, 3, 6]);
        const difference = [];
        for (const [src, operand] of [
          [a, b],
          [b, a],
        ]) {
          const [result] = await runtime.applyFeature(
            "difference",
            [src],
            operand,
            null,
          );
          const data = await runtime.getSignalData(result);
          difference.push({
            x: Array.from(data.x),
            y: Array.from(data.y),
            verdict: await lastVerdict(),
          });
        }
        return { available, normalize, difference };
      } finally {
        await runtime.resetAll();
      }
    },
    { x: X, cases: CASES.map(([m, y]) => [m, y] as [string, number[]]) },
  );
}

for (const runtimeMode of ["main", "worker"] as const) {
  test(`qualified operations give exact oracles (${runtimeMode})`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.goto(runtimeMode === "worker" ? "/?runtime=worker" : "/");
    await waitForRuntimeReady(page);
    const run = await runQualification(page);
    requireProvenance(run.available);
    expect(run.normalize).toEqual(
      CASES.map(([, , y]) => ({ y, verdict: "exact" })),
    );
    expect(run.difference).toEqual([
      { x: [0, 1, 2, 3], y: [0, -1, 0, 3], verdict: "exact" },
      { x: [0, 1.5, 3], y: [0, 0.5, -3], verdict: "exact" },
    ]);
  });
}
