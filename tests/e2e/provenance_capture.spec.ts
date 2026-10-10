/**
 * Workspace provenance capture beyond signal 1-to-1 — end-to-end suite.
 *
 * Drives the real browser runtime (UI thread and kernel worker, arrays in RAM
 * and on disk) through an image processing, an n-to-1 average and two
 * analyses, then checks the recorded facts: image states, ordered ``sources``
 * inputs, analysis artifacts, and no capture failure (on-disk objects must be
 * paged in before they are fingerprinted). The workspace is then reopened in
 * another context, where every recorded state must be found unchanged.
 */
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

interface CaptureRun {
  available: boolean;
  captureFailures: number;
  activities: {
    operation: unknown;
    roles: string[];
    inputKinds: string[];
    outputs: { kind: string | null; artifact: string | null }[];
  }[];
  stateStatus: Record<string, string>;
  bytes: number[];
}

/** Run the capture scenario, or reopen *data* and report its ledger. */
async function runCapture(
  page: Page,
  mode: "ram" | "disk",
  data: number[] | null,
): Promise<CaptureRun> {
  return page.evaluate(
    async ({ storageMode, workspace }) => {
      interface Ledger {
        states: Record<string, { kind: string }>;
        activities: {
          call: {
            operation: unknown;
            inputs: { role: string; binding: { state_id: string } }[];
          };
          outputs: { state_id?: string; artifact?: { kind: string } }[];
        }[];
      }
      interface Runtime {
        resetAll(): Promise<void>;
        setStorageMode(mode: "ram" | "disk"): Promise<void>;
        addSignalFromArrays(params: {
          title: string;
          xdata: number[];
          ydata: number[];
          xunit: string;
        }): Promise<string>;
        addImageFromArray(params: {
          title: string;
          data: number[][];
          zunit: string;
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
          state_status: Record<string, string>;
          ledger: Ledger | null;
        }>;
      }
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      await runtime.resetAll();
      await runtime.setStorageMode(storageMode);
      try {
        const before = (await runtime.getProvenanceLedger()).capture_failures;
        if (workspace === null) {
          const image = await runtime.addImageFromArray({
            title: "I",
            data: [
              [0, 1, 2, 3],
              [4, 5, 6, 7],
              [8, 9, 10, 11],
            ],
            zunit: "counts",
          });
          await runtime.applyFeature("image:gaussian_filter", [image], null, {
            sigma: 1.0,
          });
          const signals = [];
          for (const k of [1, 2, 3]) {
            signals.push(
              await runtime.addSignalFromArrays({
                title: `S${k}`,
                xdata: [0, 0.25, 0.5, 0.75],
                ydata: [-2 * k, 0, k, 4 * k],
                xunit: "s",
              }),
            );
          }
          await runtime.applyFeature("average", signals, null, null);
          await runtime.runSignalAnalysis(signals[0], "stats");
          await runtime.runImageAnalysis(image, "centroid");
        } else {
          await runtime.openWorkspaceHdf5(
            "capture.h5",
            new Uint8Array(workspace),
          );
        }
        const info = await runtime.getProvenanceLedger();
        const ledger = info.ledger;
        if (ledger === null) {
          return { available: false } as CaptureRun;
        }
        const kindOf = (id: string) => ledger.states[id].kind;
        return {
          available: info.available,
          captureFailures: info.capture_failures - before,
          activities: ledger.activities.map((a) => ({
            operation: a.call.operation,
            roles: a.call.inputs.map((i) => i.role),
            inputKinds: a.call.inputs.map((i) => kindOf(i.binding.state_id)),
            outputs: a.outputs.map((o) => ({
              kind: o.state_id ? kindOf(o.state_id) : null,
              artifact: o.artifact ? o.artifact.kind : null,
            })),
          })),
          stateStatus: info.state_status,
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

const EXPECTED = [
  {
    operation: null,
    roles: ["source"],
    inputKinds: ["image"],
    outputs: [{ kind: "image", artifact: null }],
  },
  {
    operation: null,
    roles: ["sources", "sources", "sources"],
    inputKinds: ["signal", "signal", "signal"],
    outputs: [{ kind: "signal", artifact: null }],
  },
  {
    operation: null,
    roles: ["source"],
    inputKinds: ["signal"],
    outputs: [{ kind: null, artifact: "table" }],
  },
  {
    operation: null,
    roles: ["source"],
    inputKinds: ["image"],
    outputs: [{ kind: null, artifact: "geometry" }],
  },
];

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`provenance capture (${runtimeMode})`, () => {
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
      test(`records images, n-to-1 and analyses (${storageMode})`, async () => {
        const run = await runCapture(page, storageMode, null);
        requireProvenance(run.available);
        expect(run.captureFailures).toBe(0);
        expect(run.activities).toEqual(EXPECTED);
        const reopened = await runCapture(reader, storageMode, run.bytes);
        expect(reopened.activities).toEqual(EXPECTED);
        expect(reopened.stateStatus).toEqual({});
      });
    }
  });
}
