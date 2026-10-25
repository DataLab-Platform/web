/**
 * Cross-edition families of operations — end-to-end suite.
 *
 * DataLab Desktop and DataLab-Web run the same scenario: one operation of each
 * family (n-to-1, signals to image, complex FFT, seeded noise, float32 signal,
 * statistics, image to signal profile, centroid, image convolution reading a
 * global option, and a detection that finds nothing). Here, the browser runtime
 * records it, saves it, reopens it in another context and replays every
 * activity exactly; it also reopens the file written by DataLab Desktop and
 * replays it in Pyodide, under the comparison rule declared by the qualification
 * of each operation (``exact``, or ``within_tolerance`` with the observed errors
 * for numerical libraries of another version).
 *
 * Set ``DLW_WRITE_PROVENANCE_FIXTURE=1`` to rewrite ``web_families.h5``;
 * ``desktop_families.h5`` is written by DataLab Desktop
 * (``datalab/tests/features/common/provenance_capture_unit_test.py``).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Browser, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

/** Skip without DataLab-Capsule, or fail when CI requires provenance. */
function requireProvenance(available: boolean): void {
  if (process.env.DLW_REQUIRE_PROVENANCE === "1") {
    expect(available, "DataLab-Capsule must be installed").toBe(true);
  } else {
    test.skip(!available, "DataLab-Capsule is not installed");
  }
}

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "provenance",
);

const FAMILIES = [
  "sigima.signal.average",
  "sigima.signal.signals_to_image",
  "sigima.signal.fft",
  "sigima.signal.add_gaussian_noise",
  "sigima.signal.moving_average",
  "sigima.signal.stats",
  "sigima.image.line_profile",
  "sigima.image.centroid",
  "sigima.image.convolution",
  "sigima.image.peak_detection",
];

interface Replay {
  operation: string;
  verdict: string;
  eligibility: string;
  maxAbsError: number | null;
}

interface FamiliesRun {
  available: boolean;
  captureFailures: number;
  editions: string[];
  operations: (string | null)[];
  emptyOutputs: boolean[];
  replays: Replay[];
  bytes: number[];
}

/** Run the families scenario (or reopen *data*), then replay every activity. */
async function runFamilies(
  page: Page,
  data: number[] | null,
): Promise<FamiliesRun> {
  return page.evaluate(
    async ({ workspace }) => {
      interface Activity {
        activity_id: string;
        edition: string;
        call: { operation: { id: string } | null };
        outputs: unknown[];
      }
      interface Runtime {
        resetAll(): Promise<void>;
        addSignalFromArrays(params: {
          title: string;
          xdata: number[];
          ydata: number[];
          xunit: string;
          dtype?: string;
        }): Promise<string>;
        addImageFromArray(params: {
          title: string;
          data: number[][];
          xunit?: string;
          yunit?: string;
          zunit?: string;
        }): Promise<string>;
        applyFeature(
          featureId: string,
          sourceIds: string[],
          operandId: string | null,
          params: Record<string, unknown> | null,
        ): Promise<string[]>;
        runSignalAnalysis(id: string, funcId: string): Promise<unknown>;
        runImageAnalysis(id: string, funcId: string): Promise<unknown>;
        openWorkspaceHdf5(name: string, bytes: Uint8Array): Promise<unknown>;
        saveWorkspaceHdf5(): Promise<Uint8Array>;
        getProvenanceLedger(): Promise<{
          available: boolean;
          capture_failures: number;
          ledger: { activities: Activity[] } | null;
        }>;
        replayActivity(id: string): Promise<{
          verdict: string;
          eligibility: string;
          observed: { max_abs_error: number | null } | null;
        }>;
      }
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      await runtime.resetAll();
      try {
        const before = (await runtime.getProvenanceLedger()).capture_failures;
        if (workspace === null) {
          const x = [0, 0.25, 0.5, 0.75];
          const y = [-2, 0, 1, 4];
          const signals: string[] = [];
          for (const k of [1, 2, 3]) {
            signals.push(
              await runtime.addSignalFromArrays({
                title: `S${k}`,
                xdata: x,
                ydata: y.map((v) => v * k),
                xunit: "s",
              }),
            );
          }
          await runtime.applyFeature("average", signals, null, null);
          await runtime.applyFeature("signals_to_image", signals, null, null);
          await runtime.applyFeature("fft", [signals[0]], null, {
            shift: true,
          });
          await runtime.applyFeature("add_gaussian_noise", [signals[0]], null, {
            seed: 7,
            sigma: 0.5,
          });
          const single = await runtime.addSignalFromArrays({
            title: "F",
            xdata: x,
            ydata: y,
            xunit: "s",
            dtype: "float32",
          });
          await runtime.applyFeature("moving_average", [single], null, {
            n: 3,
          });
          await runtime.runSignalAnalysis(signals[0], "stats");
          const grid = [
            [0, 1, 2, 3],
            [4, 5, 6, 7],
            [8, 9, 10, 11],
          ];
          const units = { xunit: "mm", yunit: "mm", zunit: "counts" };
          const image = await runtime.addImageFromArray({
            title: "I",
            data: grid,
            ...units,
          });
          await runtime.applyFeature("image:line_profile", [image], null, {
            direction: "horizontal",
            y: 1,
          });
          await runtime.runImageAnalysis(image, "centroid");
          const kernel = await runtime.addImageFromArray({
            title: "K",
            data: grid,
            ...units,
          });
          await runtime.applyFeature(
            "image:convolution",
            [image],
            kernel,
            null,
          );
          // A ramp has no local maximum: the detection normally finds nothing.
          const ramp = Array.from({ length: 16 }, (_, row) =>
            Array.from({ length: 16 }, (_, col) => row + col),
          );
          const rampId = await runtime.addImageFromArray({
            title: "ramp",
            data: ramp,
          });
          await runtime.runImageAnalysis(rampId, "peak_detection");
        } else {
          await runtime.openWorkspaceHdf5(
            "families.h5",
            new Uint8Array(workspace),
          );
        }
        const info = await runtime.getProvenanceLedger();
        if (info.ledger === null) {
          return { available: false } as FamiliesRun;
        }
        const activities = info.ledger.activities;
        const replays = [];
        for (const activity of activities) {
          const report = await runtime.replayActivity(activity.activity_id);
          replays.push({
            operation: activity.call.operation?.id ?? "",
            verdict: report.verdict,
            eligibility: report.eligibility,
            maxAbsError: report.observed?.max_abs_error ?? null,
          });
        }
        return {
          available: info.available,
          captureFailures: info.capture_failures - before,
          editions: activities.map((a) => a.edition),
          operations: activities.map((a) => a.call.operation?.id ?? null),
          emptyOutputs: activities.map((a) => a.outputs.length === 0),
          replays,
          bytes:
            workspace === null
              ? Array.from(await runtime.saveWorkspaceHdf5())
              : [],
        };
      } finally {
        await runtime.resetAll();
      }
    },
    { workspace: data },
  );
}

function expectFamilies(run: FamiliesRun, edition: string): void {
  expect(run.editions).toEqual(FAMILIES.map(() => edition));
  expect(run.operations).toEqual(FAMILIES);
  // Only the detection on the ramp has no result.
  expect(run.emptyOutputs).toEqual(
    FAMILIES.map((_, i) => i === FAMILIES.length - 1),
  );
}

test.describe.serial("cross-edition families", () => {
  test.describe.configure({ timeout: 300_000 });

  let context: Awaited<ReturnType<Browser["newContext"]>>;
  let page: Page;
  // A separate context reads the saved files: no memory or storage reuse.
  let readerContext: Awaited<ReturnType<Browser["newContext"]>>;
  let reader: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    readerContext = await browser.newContext();
    reader = await readerContext.newPage();
    for (const p of [page, reader]) {
      await p.goto("/");
      await waitForRuntimeReady(p);
    }
  });

  test.afterAll(async () => {
    await context.close();
    await readerContext.close();
  });

  test("records, reopens and replays every family exactly", async () => {
    const run = await runFamilies(page, null);
    requireProvenance(run.available);
    expect(run.captureFailures).toBe(0);
    expectFamilies(run, "web");
    expect(run.replays.map((r) => r.verdict)).toEqual(
      FAMILIES.map(() => "exact"),
    );
    if (process.env.DLW_WRITE_PROVENANCE_FIXTURE) {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(
        path.join(FIXTURES, "web_families.h5"),
        Buffer.from(run.bytes),
      );
    }
    const reopened = await runFamilies(reader, run.bytes);
    expectFamilies(reopened, "web");
    expect(reopened.replays.map((r) => r.verdict)).toEqual(
      FAMILIES.map(() => "exact"),
    );
  });

  for (const edition of ["web", "desktop"] as const) {
    test(`replays the ${edition} reference file here`, async () => {
      const bytes = Array.from(
        readFileSync(path.join(FIXTURES, `${edition}_families.h5`)),
      );
      const run = await runFamilies(reader, bytes);
      requireProvenance(run.available);
      expectFamilies(run, edition);
      for (const replay of run.replays) {
        expect(replay.eligibility, replay.operation).toBe("ready");
        expect(["exact", "within_tolerance"], replay.operation).toContain(
          replay.verdict,
        );
      }
      // Evidence of the cross-edition replays (verdict and observed error).
      console.log(
        `${edition} families replayed in Pyodide:\n` +
          run.replays
            .map(
              (r) =>
                `  ${r.operation}: ${r.verdict}` +
                (r.maxAbsError ? ` (max abs error ${r.maxAbsError})` : ""),
            )
            .join("\n"),
      );
    });
  }
});
