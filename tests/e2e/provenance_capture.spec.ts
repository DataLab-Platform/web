/**
 * Workspace provenance capture beyond signal 1-to-1 — end-to-end suite.
 *
 * Drives the real browser runtime (UI thread and kernel worker, arrays in RAM
 * and on disk) through an image processing, an n-to-1 average and two
 * analyses, then checks the recorded facts: image states, ordered ``sources``
 * inputs, analysis artifacts, and no capture failure (on-disk objects must be
 * paged in before they are fingerprinted). The workspace is then reopened in
 * another context, where every recorded state must be found unchanged.
 *
 * The cross-edition part writes and reopens the shared capture scenario
 * (image with ROI, analyses) and reopens the Desktop reference file in Pyodide.
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

// -- Cross-edition reference files ------------------------------------------
//
// The same scenario is written by each edition: an image with a rectangular ROI
// (x0=0, y0=0, dx=2, dy=2) analysed (centroid) then filtered (Gaussian,
// sigma=1), and a signal analysed (statistics). Set
// ``DLW_WRITE_PROVENANCE_FIXTURE=1`` to rewrite ``web_capture.h5`` from the
// main-thread RAM run; ``desktop_capture.h5`` is written by DataLab Desktop.

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "provenance",
);

interface CrossRun {
  available: boolean;
  captureFailures: number;
  editions: string[];
  /** ``[input kind, output state kind, artifact kind]`` per activity. */
  shape: (string | null)[][];
  roiCoords: number[][];
  stateStatus: Record<string, string>;
  artifactStatus: string[];
  /** A new centroid of the reopened image reuses its recorded state. */
  reused: boolean;
  bytes: number[];
}

/** Run the cross-edition scenario (or reopen *data*), then re-analyse. */
async function runCrossCapture(
  page: Page,
  mode: "ram" | "disk",
  data: number[] | null,
): Promise<CrossRun> {
  return page.evaluate(
    async ({ storageMode, workspace }) => {
      interface State {
        kind: string;
        object_uuid: string;
        roi?: { definition: { single_rois: { coords: number[] }[] } };
      }
      interface Activity {
        activity_id: string;
        edition: string;
        call: { inputs: { binding: { state_id: string } }[] };
        outputs: { state_id?: string; artifact?: { kind: string } }[];
      }
      interface Info {
        available: boolean;
        capture_failures: number;
        state_status: Record<string, string>;
        artifact_status: Record<string, { status: string }[]>;
        ledger: {
          states: Record<string, State>;
          activities: Activity[];
        } | null;
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
          xunit: string;
          yunit: string;
          zunit: string;
        }): Promise<string>;
        setImageRoi(
          id: string,
          segments: Record<string, number | string>[],
        ): Promise<void>;
        applyFeature(
          featureId: string,
          sourceIds: string[],
          operandId: string | null,
          params: Record<string, unknown> | null,
        ): Promise<string[]>;
        runSignalAnalysis(id: string, funcId: string): Promise<unknown>;
        runImageAnalysis(id: string, funcId: string): Promise<unknown>;
        listImages(): Promise<{ id: string; title: string }[]>;
        openWorkspaceHdf5(name: string, bytes: Uint8Array): Promise<unknown>;
        saveWorkspaceHdf5(): Promise<Uint8Array>;
        getProvenanceLedger(): Promise<Info>;
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
            xunit: "mm",
            yunit: "mm",
            zunit: "counts",
          });
          await runtime.setImageRoi(image, [
            { geometry: "rectangle", x0: 0, y0: 0, dx: 2, dy: 2 },
          ]);
          await runtime.runImageAnalysis(image, "centroid");
          await runtime.applyFeature("image:gaussian_filter", [image], null, {
            sigma: 1.0,
          });
          const signal = await runtime.addSignalFromArrays({
            title: "S",
            xdata: [0, 0.25, 0.5, 0.75],
            ydata: [-2, 0, 1, 4],
            xunit: "s",
          });
          await runtime.runSignalAnalysis(signal, "stats");
        } else {
          await runtime.openWorkspaceHdf5(
            "capture.h5",
            new Uint8Array(workspace),
          );
        }
        const info = await runtime.getProvenanceLedger();
        const ledger = info.ledger;
        if (ledger === null) {
          return { available: false } as CrossRun;
        }
        const bytes =
          workspace === null
            ? Array.from(await runtime.saveWorkspaceHdf5())
            : [];
        const sourceOf = (a: Activity) =>
          ledger.states[a.call.inputs[0].binding.state_id];
        const centroid = ledger.activities[0];
        const imageId = (await runtime.listImages()).find(
          (i) => i.title === "I",
        )?.id;
        if (imageId !== undefined) {
          await runtime.runImageAnalysis(imageId, "centroid");
        }
        const after = (await runtime.getProvenanceLedger()).ledger;
        const last = after?.activities[after.activities.length - 1];
        return {
          available: info.available,
          captureFailures: info.capture_failures - before,
          editions: ledger.activities.map((a) => a.edition),
          shape: ledger.activities.map((a) => [
            sourceOf(a).kind,
            a.outputs[0].state_id
              ? ledger.states[a.outputs[0].state_id].kind
              : null,
            a.outputs[0].artifact ? a.outputs[0].artifact.kind : null,
          ]),
          roiCoords: ledger.activities
            .map(sourceOf)
            .filter((s) => s.kind === "image")
            .map((s) => s.roi?.definition.single_rois[0].coords ?? []),
          stateStatus: info.state_status,
          artifactStatus: Object.values(info.artifact_status).flatMap((list) =>
            list.map((s) => s.status),
          ),
          reused:
            last !== undefined &&
            last !== centroid &&
            last.call.inputs[0].binding.state_id ===
              centroid.call.inputs[0].binding.state_id,
          bytes,
        };
      } finally {
        await runtime.resetAll();
        await runtime.setStorageMode("ram");
      }
    },
    { storageMode: mode, workspace: data },
  );
}

function expectCrossCapture(run: CrossRun, edition: string): void {
  expect(run.editions).toEqual([edition, edition, edition]);
  expect(run.shape).toEqual([
    ["image", null, "geometry"],
    ["image", "image", null],
    ["signal", null, "table"],
  ]);
  expect(run.roiCoords).toEqual([
    [0, 0, 2, 2],
    [0, 0, 2, 2],
  ]);
  expect(run.stateStatus).toEqual({});
  expect(run.artifactStatus).toEqual(["available", "available"]);
  expect(run.reused).toBe(true);
}

for (const runtimeMode of ["main", "worker"] as const) {
  test.describe.serial(`cross-edition capture (${runtimeMode})`, () => {
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
      test(`images, ROI and analyses reopen intact (${storageMode})`, async () => {
        const run = await runCrossCapture(page, storageMode, null);
        requireProvenance(run.available);
        expect(run.captureFailures).toBe(0);
        expectCrossCapture(run, "web");
        if (
          process.env.DLW_WRITE_PROVENANCE_FIXTURE &&
          runtimeMode === "main" &&
          storageMode === "ram"
        ) {
          mkdirSync(FIXTURES, { recursive: true });
          writeFileSync(
            path.join(FIXTURES, "web_capture.h5"),
            Buffer.from(run.bytes),
          );
        }
        const reopened = await runCrossCapture(reader, storageMode, run.bytes);
        expectCrossCapture(reopened, "web");
      });
    }

    for (const edition of ["web", "desktop"] as const) {
      test(`reopens the ${edition} reference file intact`, async () => {
        const bytes = Array.from(
          readFileSync(path.join(FIXTURES, `${edition}_capture.h5`)),
        );
        const run = await runCrossCapture(reader, "ram", bytes);
        requireProvenance(run.available);
        expectCrossCapture(run, edition);
      });
    }
  });
}
