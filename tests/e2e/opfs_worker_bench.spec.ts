/**
 * Definitive on-disk storage benchmark — main-thread async vs worker sync.
 *
 * Two earlier probes established the pieces in isolation:
 *   - ``opfs_storage_bench`` measured RAM vs on-disk (OPFS) on the **main
 *     thread**, proving the heap stays flat in disk mode (the headline
 *     metric) but at the cost of the slow asynchronous ``createWritable``
 *     write path.
 *   - ``opfs_sync_spike`` measured raw ``createSyncAccessHandle`` (worker)
 *     vs ``createWritable`` (main) on synthetic buffers — 4–7× faster — but
 *     outside the runtime.
 *
 * This benchmark closes the loop: it drives the **real ``DataLabRuntime``**
 * in on-disk mode through both execution backends, end to end, and reports
 * the actual latency the feature delivers:
 *
 *   - ``?runtime=main``   → runtime on the UI thread, async OPFS store.
 *   - ``?runtime=worker`` → runtime in a Dedicated Web Worker, **synchronous**
 *     OPFS store (``OpfsSyncObjectStore``).
 *
 * Identical image workloads run in each, so the per-image add/read times are
 * directly comparable and yield the definitive sync-vs-async picture for the
 * spill path inside DataLab (DEW ADR #2). Both backends must keep the
 * resident WASM heap flat (one object at a time) and preserve byte-for-byte
 * integrity; only the I/O latency should differ.
 *
 * Headline finding (the reason a *definitive* benchmark matters)
 * --------------------------------------------------------------
 * The isolated ``opfs_sync_spike`` showed the synchronous handle 4–7× faster
 * than async for raw buffer writes. End to end **inside the runtime that gain
 * does not materialise** — the worker path runs roughly on par with (often a
 * touch slower than) the main-thread async path. The reason is that every
 * ``addImageFromArray`` clones its 8–32 MiB input array across ``postMessage``
 * main→worker (structured clone), and that copy cost dominates the much
 * cheaper sync write it enabled. The resident heap stays identically flat in
 * both backends, so the on-disk memory win is preserved regardless; the
 * remaining latency lever is **transferring** the input ``ArrayBuffer``
 * (transferables) instead of cloning it — the documented next optimisation.
 *
 * Opt-in (perf project). Run with:
 *   npx playwright test --project=perf tests/e2e/opfs_worker_bench.spec.ts --reporter=list
 *   # or:  npm run bench:opfs-worker
 *
 * Results are printed as a table and written to
 * ``tests/benchmark/results/opfs_worker_<timestamp>.json``.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect, type Page } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

/** One image-size configuration to benchmark. */
interface BenchConfig {
  side: number;
  n: number;
  dtype: "float64";
}

/** Per-backend metrics gathered by the in-browser driver. */
interface BackendMetrics {
  /** WASM heap (bytes) right before the first object is created. */
  base: number;
  /** Peak WASM heap (bytes) observed while creating the N objects. */
  createPeak: number;
  /** Per-object creation latency (ms) — includes the on-disk spill. */
  createMs: number[];
  /** Per-object read-back latency (ms) — includes the page-in + re-spill. */
  readMs: number[];
  /** Sum of each image's constant value recovered on read-back; must
   *  equal n*(n-1)/2 when every image round-tripped intact. */
  checksum: number;
  /** Objects whose array lives on disk at create-peak (must equal n). */
  spilledCount: number;
  /** Total bytes held in the OPFS store at create-peak. */
  diskBytes: number;
}

interface ConfigResult {
  side: number;
  n: number;
  dtype: string;
  async: BackendMetrics;
  sync: BackendMetrics;
}

const CONFIGS: BenchConfig[] = [
  { side: 1024, n: 16, dtype: "float64" },
  { side: 2048, n: 8, dtype: "float64" },
];

const MiB = 1024 * 1024;
const mib = (bytes: number): string => (bytes / MiB).toFixed(1);
const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Minimal structural view of the runtime surface the driver touches. */
interface BenchRuntime {
  setStorageMode(mode: "ram" | "disk"): Promise<void>;
  addImageFromArray(params: {
    title: string;
    data: Float64Array;
    width: number;
    height: number;
    dtype: string;
  }): Promise<string>;
  getImageData(oid: string): Promise<{ data_min: number; data_max: number }>;
  deleteAllObjects(kind: "signal" | "image"): Promise<void>;
  getMemoryUsage(): { wasmBytes: number | null };
  getSpilledCount(): number;
  getDiskStoreBytes(): number;
}

/**
 * Drive the on-disk workload for the runtime currently on ``window`` and
 * return per-backend metrics. Defined as a string-free closure passed to
 * ``page.evaluate`` (one round-trip per config set).
 */
async function runDiskWorkload(
  page: Page,
  configs: BenchConfig[],
): Promise<BackendMetrics[]> {
  return page.evaluate(
    async (cfgs: BenchConfig[]): Promise<BackendMetrics[]> => {
      const runtime = (window as unknown as { runtime: BenchRuntime }).runtime;
      const heap = (): number => runtime.getMemoryUsage().wasmBytes ?? 0;

      const out: BackendMetrics[] = [];
      for (const cfg of cfgs) {
        await runtime.setStorageMode("disk");
        await runtime.deleteAllObjects("image");

        const base = heap();
        let createPeak = base;
        const createMs: number[] = [];
        const oids: string[] = [];
        for (let i = 0; i < cfg.n; i++) {
          const data = new Float64Array(cfg.side * cfg.side);
          data.fill(i);
          const t0 = performance.now();
          const oid = await runtime.addImageFromArray({
            title: `bench ${cfg.side}#${i}`,
            data,
            width: cfg.side,
            height: cfg.side,
            dtype: cfg.dtype,
          });
          createMs.push(performance.now() - t0);
          oids.push(oid);
          const h = heap();
          if (h > createPeak) createPeak = h;
        }

        const spilledCount = runtime.getSpilledCount();
        const diskBytes = runtime.getDiskStoreBytes();

        const readMs: number[] = [];
        let checksum = 0;
        for (const oid of oids) {
          const t0 = performance.now();
          const img = await runtime.getImageData(oid);
          readMs.push(performance.now() - t0);
          // np.full(side², i): min == max == i.
          checksum += img.data_min;
          if (img.data_min !== img.data_max) checksum += 1e9; // integrity flag
        }

        await runtime.deleteAllObjects("image");
        await runtime.setStorageMode("ram");

        out.push({
          base,
          createPeak,
          createMs,
          readMs,
          checksum,
          spilledCount,
          diskBytes,
        });
      }
      return out;
    },
    configs,
  );
}

test.describe("OPFS worker benchmark", () => {
  test.setTimeout(900_000);

  test("on-disk spill: main-thread async vs worker sync", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });

    // --- Async backend: runtime on the main thread -------------------
    await page.goto("/?runtime=main");
    await waitForRuntimeReady(page);
    const asyncSupported = await page.evaluate(async () =>
      (
        window as unknown as {
          runtime: { isDiskStorageSupported(): boolean | Promise<boolean> };
        }
      ).runtime.isDiskStorageSupported(),
    );
    test.skip(!asyncSupported, "on-disk storage unavailable in this context");
    const asyncMetrics = await runDiskWorkload(page, CONFIGS);

    // --- Sync backend: runtime in a Dedicated Web Worker -------------
    await page.goto("/?runtime=worker");
    await waitForRuntimeReady(page);
    const syncMetrics = await runDiskWorkload(page, CONFIGS);

    const results: ConfigResult[] = CONFIGS.map((cfg, i) => ({
      side: cfg.side,
      n: cfg.n,
      dtype: cfg.dtype,
      async: asyncMetrics[i],
      sync: syncMetrics[i],
    }));

    // ---------------------------------------------------------------
    // Report
    // ---------------------------------------------------------------
    const rows = results.map((r) => {
      const aAdd = mean(r.async.createMs);
      const sAdd = mean(r.sync.createMs);
      const aRead = mean(r.async.readMs);
      const sRead = mean(r.sync.readMs);
      const itemBytes = r.side * r.side * 8;
      return {
        config: `${r.side}² ×${r.n} ${r.dtype}`,
        "workingSet(MiB)": mib(itemBytes * r.n),
        "async add ms": aAdd.toFixed(1),
        "sync add ms": sAdd.toFixed(1),
        "add speedup": `${(aAdd / Math.max(0.01, sAdd)).toFixed(1)}×`,
        "async read ms": aRead.toFixed(1),
        "sync read ms": sRead.toFixed(1),
        "read speedup": `${(aRead / Math.max(0.01, sRead)).toFixed(1)}×`,
        "async Δheap(MiB)": mib(r.async.createPeak - r.async.base),
        "sync Δheap(MiB)": mib(r.sync.createPeak - r.sync.base),
      };
    });
    console.log(
      "\n=== Definitive on-disk benchmark: main async vs worker sync ===",
    );
    console.table(rows);

    const here = dirname(fileURLToPath(import.meta.url));
    const resultsDir = join(here, "..", "benchmark", "results");
    mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = join(resultsDir, `opfs_worker_${stamp}.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), configs: CONFIGS, results },
        null,
        2,
      ),
    );
    console.log(`[opfs-worker-bench] results written to ${outPath}\n`);

    // ---------------------------------------------------------------
    // Invariants
    // ---------------------------------------------------------------
    for (const r of results) {
      const expectedChecksum = (r.n * (r.n - 1)) / 2;
      // 1. Integrity: both backends recover the same per-image values.
      expect(r.async.checksum).toBeCloseTo(expectedChecksum, 3);
      expect(r.sync.checksum).toBeCloseTo(expectedChecksum, 3);
      // 2. Both backends spilled every object to disk.
      expect(r.async.spilledCount).toBe(r.n);
      expect(r.sync.spilledCount).toBe(r.n);
      expect(r.async.diskBytes).toBeGreaterThan(0);
      expect(r.sync.diskBytes).toBeGreaterThan(0);
      // 3. Both backends keep the resident heap flat (≈ one object at a
      //    time), so switching to the worker never regresses the on-disk
      //    memory win — the headline guarantee. We compare peak growth
      //    rather than absolute latency because, as the table shows, the
      //    end-to-end add time is dominated by the postMessage clone of the
      //    input array, not the (faster) sync write; a generous bound keeps
      //    this robust to Pyodide's coarse heap paging.
      expect(r.sync.createPeak - r.sync.base).toBeLessThan(
        (r.async.createPeak - r.async.base) * 1.5 + MiB,
      );
    }
  });
});
