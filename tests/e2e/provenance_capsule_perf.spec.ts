/**
 * Provenance and capsules — performance of the user paths (``perf`` project).
 *
 * Measures, at a ready runtime and with the same seeded data in every mode:
 *
 * 1. a processing captured as usual, then saving and reopening the workspace;
 * 2. the provenance of a result and of one of its ancestors;
 * 3. checking the data, then verifying a computation;
 * 4. exporting, inspecting and opening a capsule, in an empty workspace and
 *    over a current one (the cost of replacing it);
 * 5. three open / close / free cycles, to show whether memory is reused;
 * 6. a capsule referencing its workspace, with the workspace supplied;
 * 7. a long ledger: building it, saving, consulting one result, and listing
 *    every activity in the Local replay tab of the capsule dialog.
 *
 * Starting the runtime (downloads, installation) is measured apart. Each
 * combination of runtime (main thread or worker) and storage (RAM or disk)
 * runs in a fresh browser context. After an awaited call, the synchronous
 * memory accessors are fresh (the worker posts its mirror before the result);
 * the WebAssembly heap capacity after an operation is its largest growth in
 * this runtime, not the peak memory of the browser. Consultation must never
 * page arrays in: the number of objects on disk is checked around it.
 *
 * ``DLW_PERF_PROFILE``: ``quick`` (default; small data, every combination),
 * ``representative`` (worker, RAM and disk; 1000-activity ledger in RAM),
 * ``diagnostic`` (main thread, RAM, representative data) or ``capacity``
 * (worker, RAM, about 233 MiB of arrays). Results are written to
 * ``tests/benchmark/results/provenance_capsule_perf_<stamp>.json`` (report
 * version 1 of DataLab-Capsule's ``doc/performance.md``).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";
import { closeDialog, openDialog, requireProvenance } from "./capsuleHelpers";

type RuntimeMode = "main" | "worker";
type StorageMode = "ram" | "disk";
interface Profile {
  combinations: [RuntimeMode, StorageMode][];
  side: number;
  repeat: number;
  ledger: number;
}

const PROFILES: Record<string, Profile> = {
  quick: {
    combinations: [
      ["main", "ram"],
      ["main", "disk"],
      ["worker", "ram"],
      ["worker", "disk"],
    ],
    side: 512,
    repeat: 3,
    ledger: 20,
  },
  representative: {
    combinations: [
      ["worker", "ram"],
      ["worker", "disk"],
    ],
    side: 2048,
    repeat: 3,
    ledger: 1000,
  },
  diagnostic: {
    combinations: [["main", "ram"]],
    side: 2048,
    repeat: 3,
    ledger: 0,
  },
  capacity: {
    combinations: [["worker", "ram"]],
    side: 2700,
    repeat: 1,
    ledger: 0,
  },
};
const PROFILE_NAME = process.env.DLW_PERF_PROFILE ?? "quick";
const PROFILE = PROFILES[PROFILE_NAME];
const REF = "https://data.example.org/benchmark/workspace.h5";
const SEED = 20261017;

interface Case {
  id: string;
  params: Record<string, unknown>;
  mode: { execution: string; storage: StorageMode };
  status: string;
  error?: string;
  sizes?: Record<string, unknown>;
  first_ms?: number;
  durations_ms?: number[];
  median_ms?: number;
  range_ms?: [number, number];
  memory?: Record<string, unknown>;
  [key: string]: unknown;
}

const cases: Case[] = [];
const report: Record<string, unknown> = {
  report_version: 1,
  run_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  launcher: "provenance_capsule_perf.spec.ts",
  started_at: new Date().toISOString(),
  profile: PROFILE_NAME,
  repeat: PROFILE?.repeat,
  phase: "all",
  memory_methods: {
    wasm_heap:
      "capacity of the WebAssembly heap read after the awaited call (fresh in " +
      "worker mode: the mirror is posted before the result); it never shrinks",
    js_heap: "performance.memory.usedJSHeapSize when the browser gives it",
    data_bytes: "bytes of the signal and image arrays held by the object model",
  },
  cases,
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The scenario, run in the page: returns its cases (without the mode). */
async function scenario(
  page: Page,
  options: {
    storage: StorageMode;
    side: number;
    repeat: number;
    seed: number;
    ref: string;
  },
): Promise<{
  available: boolean;
  cases: Omit<Case, "mode">[];
  versions: unknown;
}> {
  return page.evaluate(async ({ storage, side, repeat, seed, ref }) => {
    interface Memory {
      wasmBytes: number | null;
      jsUsedBytes: number | null;
    }
    interface Runtime {
      resetAll(): Promise<void>;
      setStorageMode(mode: string): Promise<void>;
      getSpilledCount(): number;
      getMemoryUsage(): Memory;
      getDataMemoryBytes(): Promise<number | null>;
      freeMemory(): Promise<unknown>;
      runPython(code: string): Promise<unknown>;
      applyFeature(
        featureId: string,
        sourceIds: string[],
        operandId: string | null,
        params: Record<string, unknown> | null,
      ): Promise<string[]>;
      saveWorkspaceHdf5(): Promise<Uint8Array>;
      openWorkspaceHdf5(
        name: string,
        bytes: Uint8Array,
        replace?: boolean,
      ): Promise<unknown>;
      getPanelTree(kind: string): Promise<{
        groups: { objects: { id: string; uuid: string | null }[] }[];
      }>;
      getProvenanceLedger(): Promise<{
        available: boolean;
        capture_failures: number;
        ledger: {
          states: Record<string, { object_uuid: string }>;
          activities: {
            activity_id: string;
            outputs: { state_id: string }[];
          }[];
        } | null;
      }>;
      describeObjectProvenance(
        id: string,
        options?: { stateId?: string; checkData?: boolean; trail?: string[] },
      ): Promise<{
        available: boolean;
        state?: { state_id: string } | null;
        production?: { inputs: { state_id: string }[] } | null;
      }>;
      replayActivity(id: string): Promise<{ verdict: string }>;
      exportWorkspaceCapsule(name: string | null): Promise<Uint8Array>;
      exportReferencedCapsule(
        ref: string,
        name: string | null,
      ): Promise<{ capsule: Uint8Array; workspace: Uint8Array }>;
      inspectWorkspaceCapsule(
        data: Uint8Array,
        options?: { workspace?: Uint8Array | null },
      ): Promise<{ integrity: { valid: boolean; states_located: number } }>;
      openWorkspaceCapsule(
        name: string,
        data: Uint8Array,
        replace?: boolean,
        workspace?: Uint8Array | null,
      ): Promise<unknown>;
      getInstalledVersions(
        packages?: string[],
      ): Promise<Record<string, string | null>>;
    }
    const rt = (window as unknown as { runtime: Runtime }).runtime;
    const out: Omit<Case, "mode">[] = [];
    const info = await rt.getProvenanceLedger();
    if (!info.available)
      return { available: false, cases: out, versions: null };
    const versions = await rt.getInstalledVersions([
      "sigima",
      "guidata",
      "numpy",
      "h5py",
      "DataLab-Capsule",
    ]);
    await rt.resetAll();
    await rt.setStorageMode(storage);

    const memory = async (before: Memory) => {
      const after = rt.getMemoryUsage();
      const data = await rt.getDataMemoryBytes();
      return {
        wasm_heap:
          before.wasmBytes === null || after.wasmBytes === null
            ? { value: null, reason: "not reported by the runtime" }
            : {
                before_bytes: before.wasmBytes,
                after_bytes: after.wasmBytes,
                growth_bytes: after.wasmBytes - before.wasmBytes,
              },
        js_heap:
          after.jsUsedBytes === null
            ? { value: null, reason: "performance.memory not available" }
            : { used_after_bytes: after.jsUsedBytes },
        data_bytes_after: data,
      };
    };
    /** One warm-up run (reported as first_ms), then *n* measured runs. */
    const measure = async <T>(
      id: string,
      params: Record<string, unknown>,
      task: () => Promise<T>,
      n: number = repeat,
      extra: (result: T) => Record<string, unknown> = () => ({}),
    ): Promise<T | null> => {
      const before = rt.getMemoryUsage();
      try {
        let start = performance.now();
        let result = await task();
        const first = performance.now() - start;
        const durations: number[] = [];
        for (let index = 0; index < n; index += 1) {
          start = performance.now();
          result = await task();
          durations.push(performance.now() - start);
        }
        const sorted = [...durations].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        out.push({
          id,
          params,
          status: "ok",
          first_ms: +first.toFixed(3),
          durations_ms: durations.map((d) => +d.toFixed(3)),
          median_ms: +(
            sorted.length % 2
              ? sorted[middle]
              : (sorted[middle - 1] + sorted[middle]) / 2
          ).toFixed(3),
          range_ms: [
            +sorted[0].toFixed(3),
            +sorted[sorted.length - 1].toFixed(3),
          ],
          memory: await memory(before),
          ...extra(result),
        });
        return result;
      } catch (error) {
        out.push({
          id,
          params,
          status: "error",
          error: String(error).slice(0, 500),
        });
        return null;
      }
    };
    const ids = async (kind: string) =>
      (await rt.getPanelTree(kind)).groups.flatMap((g) =>
        g.objects.map((o) => o.id),
      );
    /** Uncompressed size of an entry of a ZIP archive (central directory). */
    const zipEntrySize = (bytes: Uint8Array, name: string): number | null => {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      let end = bytes.length - 22;
      while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
      if (end < 0) return null;
      let offset = view.getUint32(end + 16, true);
      const count = view.getUint16(end + 10, true);
      for (let index = 0; index < count; index += 1) {
        const nameLength = view.getUint16(offset + 28, true);
        const entry = new TextDecoder().decode(
          bytes.subarray(offset + 46, offset + 46 + nameLength),
        );
        if (entry === name) return view.getUint32(offset + 24, true);
        offset +=
          46 +
          nameLength +
          view.getUint16(offset + 30, true) +
          view.getUint16(offset + 32, true);
      }
      return null;
    };

    // Data: a seeded camera-like source image (never timed)
    const source = (await rt.runPython(`
import numpy as np
_rng = np.random.default_rng(${seed})
_yy, _xx = np.mgrid[0:${side}, 0:${side}] / ${side}
add_image_from_array("Source", 2000 + 1500 * np.sin(6 * _xx) * np.cos(4 * _yy) + _rng.normal(0, 40, (${side}, ${side})))
`)) as string;
    const shape = [side, side];

    // 1. Captured processing, then the chain, saving and reopening
    await measure(
      "process.gaussian_filter",
      { operation: "gaussian_filter", shape },
      () =>
        rt.applyFeature("image:gaussian_filter", [source], null, {
          sigma: 2.0,
        }),
    );
    await rt.resetAll();
    await rt.runPython(`
import numpy as np
_rng = np.random.default_rng(${seed})
_yy, _xx = np.mgrid[0:${side}, 0:${side}] / ${side}
add_image_from_array("Source", 2000 + 1500 * np.sin(6 * _xx) * np.cos(4 * _yy) + _rng.normal(0, 40, (${side}, ${side})))
`);
    const [s0] = await ids("image");
    const [s1] = await rt.applyFeature("image:gaussian_filter", [s0], null, {
      sigma: 1.0,
    });
    const [s2] = await rt.applyFeature("image:gaussian_filter", [s1], null, {
      sigma: 2.0,
    });
    await rt.applyFeature("image:average", [s0, s1, s2], null, null);
    const chain = { objects: 4, shape };
    const saved = await measure(
      "workspace.save",
      chain,
      () => rt.saveWorkspaceHdf5(),
      repeat,
      (bytes) => ({
        sizes: { hdf5_bytes: bytes.byteLength },
      }),
    );
    if (saved === null) return { available: true, cases: out, versions };
    await measure("workspace.reopen", chain, () =>
      rt.openWorkspaceHdf5("chain.h5", saved.slice(), true),
    );

    // 2. and 3. Consultation, data check, verification: the result of the
    // last recorded activity (the average), found through the ledger
    const ledger = await rt.getProvenanceLedger();
    const activities = ledger.ledger?.activities ?? [];
    const lastActivity = activities[activities.length - 1];
    const last = lastActivity?.activity_id;
    const resultUuid = lastActivity
      ? ledger.ledger?.states[lastActivity.outputs[0].state_id].object_uuid
      : undefined;
    const result = (await rt.getPanelTree("image")).groups
      .flatMap((g) => g.objects)
      .find((o) => o.uuid === resultUuid)?.id;
    if (result === undefined) {
      out.push({
        id: "consult.describe",
        params: chain,
        status: "error",
        error: "result of the last activity not found",
      });
      return { available: true, cases: out, versions };
    }
    const spilled = rt.getSpilledCount();
    const view = await measure("consult.describe", chain, () =>
      rt.describeObjectProvenance(result),
    );
    const input = view?.production?.inputs[0];
    if (!input) {
      out.push({
        id: "consult.ancestor",
        params: chain,
        status: "error",
        error: "the result has no recorded input",
      });
    } else {
      await measure("consult.ancestor", chain, () =>
        rt.describeObjectProvenance(result, {
          stateId: input.state_id,
          trail: view?.state ? [view.state.state_id] : [],
        }),
      );
    }
    await measure("consult.check-data", chain, () =>
      rt.describeObjectProvenance(result, { checkData: true }),
    );
    const spilledAfter = rt.getSpilledCount();
    out.push({
      id: "consult.no-page-in",
      params: chain,
      status: spilledAfter >= spilled ? "ok" : "error",
      objects_on_disk_before: spilled,
      objects_on_disk_after: spilledAfter,
      ...(spilledAfter >= spilled
        ? {}
        : { error: "consultation paged arrays in" }),
    });
    const ledgerAfter = await rt.getProvenanceLedger();
    if (last && ledgerAfter.ledger?.activities.length === activities.length) {
      await measure(
        "consult.verify",
        chain,
        () => rt.replayActivity(last),
        repeat,
        (r) => ({
          verdict: r.verdict,
        }),
      );
    }

    // 4. Capsule export, inspection, opening
    const capsule = await measure(
      "capsule.export",
      chain,
      () => rt.exportWorkspaceCapsule("benchmark"),
      repeat,
      (bytes) => ({
        sizes: {
          archive_bytes: bytes.byteLength,
          manifest_bytes: zipEntrySize(bytes, "ro-crate-metadata.json"),
        },
      }),
    );
    if (capsule !== null) {
      await measure(
        "capsule.inspect",
        chain,
        () => rt.inspectWorkspaceCapsule(capsule.slice()),
        repeat,
        (r) => ({
          valid: r.integrity.valid,
          states_located: r.integrity.states_located,
        }),
      );
      await measure("capsule.open-over-current", chain, () =>
        rt.openWorkspaceCapsule("benchmark.dlcapsule", capsule.slice(), true),
      );
      // Opening in an empty workspace: the reset is not timed
      const before = rt.getMemoryUsage();
      const empty: number[] = [];
      for (let index = 0; index <= repeat; index += 1) {
        await rt.resetAll();
        const start = performance.now();
        await rt.openWorkspaceCapsule(
          "benchmark.dlcapsule",
          capsule.slice(),
          true,
        );
        empty.push(performance.now() - start);
      }
      const [firstEmpty, ...emptyRuns] = empty;
      out.push({
        id: "capsule.open-empty",
        params: chain,
        status: "ok",
        first_ms: +firstEmpty.toFixed(3),
        durations_ms: emptyRuns.map((d) => +d.toFixed(3)),
        memory: await memory(before),
      });
      // 5. Open / close / free cycles: the heap after each cycle
      const cycles: (number | null)[] = [];
      for (let index = 0; index < 3; index += 1) {
        await rt.resetAll();
        await rt.freeMemory();
        await rt.openWorkspaceCapsule(
          "benchmark.dlcapsule",
          capsule.slice(),
          true,
        );
        cycles.push(rt.getMemoryUsage().wasmBytes);
      }
      out.push({
        id: "capsule.cycles",
        params: { ...chain, cycles: 3 },
        status: "ok",
        wasm_heap_after_each_cycle_bytes: cycles,
      });
    }
    // 6. Referenced workspace, supplied
    const referenced = await measure(
      "capsule.export-referenced",
      chain,
      () => rt.exportReferencedCapsule(ref, "benchmark"),
      repeat,
      (r) => ({
        sizes: {
          archive_bytes: r.capsule.byteLength,
          hdf5_bytes: r.workspace.byteLength,
        },
      }),
    );
    if (referenced !== null) {
      await measure("capsule.inspect-referenced", chain, () =>
        rt.inspectWorkspaceCapsule(referenced.capsule.slice(), {
          workspace: referenced.workspace.slice(),
        }),
      );
      await measure("capsule.open-referenced", chain, () =>
        rt.openWorkspaceCapsule(
          "referenced.dlcapsule",
          referenced.capsule.slice(),
          true,
          referenced.workspace.slice(),
        ),
      );
    }
    const failures =
      (await rt.getProvenanceLedger()).capture_failures - info.capture_failures;
    out.push({
      id: "capture-failures",
      params: {},
      status: failures ? "error" : "ok",
      failures,
    });
    return { available: true, cases: out, versions };
  }, options);
}

/** 7. A long ledger of small signals; returns its cases. */
async function longLedger(page: Page, count: number, repeat: number) {
  return page.evaluate(
    async ({ count, repeat }) => {
      interface Runtime {
        resetAll(): Promise<void>;
        addSignalFromArrays(params: Record<string, unknown>): Promise<string>;
        applyFeature(
          id: string,
          sources: string[],
          operand: string | null,
          params: Record<string, unknown> | null,
        ): Promise<string[]>;
        saveWorkspaceHdf5(): Promise<Uint8Array>;
        exportWorkspaceCapsule(name: string | null): Promise<Uint8Array>;
        describeObjectProvenance(id: string): Promise<unknown>;
      }
      const rt = (window as unknown as { runtime: Runtime }).runtime;
      await rt.resetAll();
      const x = Array.from({ length: 100 }, (_v, i) => i / 99);
      const first = await rt.addSignalFromArrays({
        title: "L0",
        xdata: x,
        ydata: x.map((v) => Math.sin(10 * v)),
      });
      let last = first;
      let start = performance.now();
      for (let index = 0; index < count; index += 1) {
        [last] = await rt.applyFeature("addition_constant", [last], null, {
          value: 1,
        });
      }
      const build = performance.now() - start;
      const params = { activities: count, points: 100 };
      const out: Record<string, unknown>[] = [
        {
          id: "ledger.build",
          params,
          status: "ok",
          durations_ms: [+build.toFixed(3)],
        },
      ];
      const timed = async (id: string, task: () => Promise<unknown>) => {
        const durations: number[] = [];
        let result: unknown = null;
        for (let index = 0; index < repeat; index += 1) {
          start = performance.now();
          result = await task();
          durations.push(+(performance.now() - start).toFixed(3));
        }
        out.push({ id, params, status: "ok", durations_ms: durations });
        return result;
      };
      const saved = (await timed("ledger.save", () =>
        rt.saveWorkspaceHdf5(),
      )) as Uint8Array;
      const capsule = (await timed("ledger.export", () =>
        rt.exportWorkspaceCapsule("ledger"),
      )) as Uint8Array;
      out[out.length - 1].sizes = { archive_bytes: capsule.byteLength };
      out[1].sizes = { hdf5_bytes: saved.byteLength };
      await timed("ledger.describe-last", () =>
        rt.describeObjectProvenance(last),
      );
      await timed("ledger.describe-first", () =>
        rt.describeObjectProvenance(first),
      );
      return out;
    },
    { count, repeat },
  );
}

/** Time the Local replay list of the capsule dialog, through the interface. */
async function replayList(page: Page, activities: number, repeat: number) {
  await page.evaluate(() => {
    const longest = { value: 0 };
    (window as unknown as { __longest: typeof longest }).__longest = longest;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longest.value = Math.max(longest.value, entry.duration);
      }
    }).observe({ type: "longtask", buffered: false });
  });
  const open: number[] = [];
  const list: number[] = [];
  for (let index = 0; index < repeat; index += 1) {
    let start = Date.now();
    await openDialog(page);
    open.push(Date.now() - start);
    start = Date.now();
    await page.getByRole("tab", { name: "Local replay" }).click();
    await expect(page.getByTestId("capsule-replay-row")).toHaveCount(
      activities,
      {
        timeout: 120_000,
      },
    );
    list.push(Date.now() - start);
    await closeDialog(page);
  }
  const longest = await page.evaluate(
    () =>
      (window as unknown as { __longest: { value: number } }).__longest.value,
  );
  return { open, list, longest };
}

function finish(entry: Omit<Case, "mode">, mode: Case["mode"]): Case {
  const durations = entry.durations_ms;
  const done: Case = { ...entry, mode } as Case;
  if (durations && durations.length && done.median_ms === undefined) {
    done.median_ms = +median(durations).toFixed(3);
    done.range_ms = [Math.min(...durations), Math.max(...durations)];
  }
  return done;
}

test.describe("provenance and capsules — performance", () => {
  test.skip(!PROFILE, `unknown DLW_PERF_PROFILE ${PROFILE_NAME}`);
  test.describe.configure({ mode: "serial", timeout: 3_600_000 });

  test.afterAll(async ({ browser }) => {
    report.finished_at = new Date().toISOString();
    report.environment = {
      browser: `${browser.browserType().name()} ${browser.version()}`,
      platform: process.platform,
      node: process.version,
    };
    const dir = path.join("tests", "benchmark", "results");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `provenance_capsule_perf_${stamp}.json`);
    writeFileSync(file, JSON.stringify(report, null, 1));
    console.log(`[perf] report written to ${file}`);
  });

  for (const [runtimeMode, storage] of PROFILE?.combinations ?? []) {
    test(`${runtimeMode} runtime, ${storage} storage`, async ({ browser }) => {
      const mode = {
        execution: runtimeMode === "worker" ? "browser-worker" : "browser-main",
        storage,
      };
      const context = await browser.newContext();
      const page = await context.newPage();
      page.on("pageerror", (err) => console.log("[pageerror]", err.message));
      try {
        const start = Date.now();
        await page.goto(`/?runtime=${runtimeMode}`);
        await waitForRuntimeReady(page);
        cases.push(
          finish(
            {
              id: "startup",
              params: {
                note: "downloads and installation included (browser cache state not controlled)",
              },
              status: "ok",
              durations_ms: [Date.now() - start],
            },
            mode,
          ),
        );
        const result = await scenario(page, {
          storage,
          side: PROFILE.side,
          repeat: PROFILE.repeat,
          seed: SEED,
          ref: REF,
        });
        requireProvenance(result.available);
        report.versions = result.versions;
        for (const entry of result.cases) {
          cases.push(finish(entry, mode));
          console.log(
            `[perf] ${runtimeMode}/${storage} ${entry.id}: ${entry.status}` +
              (entry.median_ms !== undefined
                ? `, median ${entry.median_ms} ms`
                : ""),
          );
        }
        const ledger = storage === "ram" ? PROFILE.ledger : 0;
        if (ledger) {
          for (const entry of await longLedger(page, ledger, PROFILE.repeat)) {
            cases.push(finish(entry as Omit<Case, "mode">, mode));
          }
          const ui = await replayList(page, ledger, PROFILE.repeat);
          cases.push(
            finish(
              {
                id: "ledger.dialog-open",
                params: { activities: ledger },
                status: "ok",
                durations_ms: ui.open,
              },
              mode,
            ),
            finish(
              {
                id: "ledger.replay-list",
                params: { activities: ledger },
                status: "ok",
                durations_ms: ui.list,
                longest_task_ms: ui.longest,
              },
              mode,
            ),
          );
        }
        const failed = result.cases.filter((c) => c.status !== "ok");
        expect(failed, JSON.stringify(failed)).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
