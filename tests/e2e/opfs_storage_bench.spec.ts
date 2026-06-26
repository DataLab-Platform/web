/**
 * On-disk storage benchmark — RAM mode vs OPFS "data on disk" mode.
 *
 * Unlike the original de-risking spike (which drove a hand-rolled OPFS
 * loop through ``runPython``), this benchmark exercises the **real
 * feature** end-to-end through the public runtime API:
 *
 *   - ``runtime.setStorageMode("ram" | "disk")``
 *   - ``runtime.addImageFromArray(...)``  (spills to OPFS in disk mode)
 *   - ``runtime.getImageData(...)``       (pages back in, then re-spills)
 *
 * It answers the architectural question that motivates the whole
 * feature (see DEW ADR #2):
 *
 *   *Does the on-disk mode keep the Pyodide WASM linear heap flat — at
 *    roughly one resident object — instead of growing it by the full
 *    working set, while preserving byte-for-byte data integrity?*
 *
 * Mechanism note (honest framing)
 * -------------------------------
 * The current implementation uses the **asynchronous, main-thread**
 * File System Access write path (``createWritable`` / out-of-place
 * whole-file rewrite). Its *write/read latency* is therefore a
 * conservative upper bound: the documented next step moves the runtime
 * into a Web Worker and uses **synchronous, in-place**
 * ``createSyncAccessHandle`` I/O, which is markedly faster. The headline
 * metric this benchmark validates — **peak resident WASM heap** — is
 * mechanism-independent: once an array is spilled and dropped, it is
 * gone from the heap regardless of how it was written.
 *
 * Run with:
 *   npx playwright test --project=perf tests/e2e/opfs_storage_bench.spec.ts --reporter=list
 *   # or:  npm run bench:opfs
 *
 * Results are printed as a table and written to
 * ``tests/benchmark/results/opfs_storage_<timestamp>.json``.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { waitForRuntimeReady } from "./fixtures";

/** One image-size configuration to benchmark. */
interface BenchConfig {
  side: number;
  n: number;
  dtype: "float64" | "float32";
}

/** Per-mode metrics gathered by the in-browser driver. */
interface ModeMetrics {
  /** WASM heap (bytes) right before the first object is created. */
  base: number;
  /** Peak WASM heap (bytes) observed while creating the N objects. */
  createPeak: number;
  /** Peak WASM heap (bytes) observed while reading the N objects back. */
  readPeak: number;
  /** WASM heap (bytes) after the whole create + read cycle. */
  after: number;
  /** Per-object creation latency (ms). */
  createMs: number[];
  /** Per-object read-back latency (ms). */
  readMs: number[];
  /** Sum of each image's constant value, recovered from the read-back
   *  data (must equal n*(n-1)/2 in both modes). */
  checksum: number;
  /** Number of objects whose array lives on disk at create-peak. */
  spilledCount: number;
  /** Total bytes held in the OPFS store at create-peak. */
  diskBytes: number;
}

interface ConfigResult {
  side: number;
  n: number;
  dtype: string;
  ram: ModeMetrics;
  disk: ModeMetrics;
}

const CONFIGS: BenchConfig[] = [
  { side: 1024, n: 16, dtype: "float64" },
  { side: 2048, n: 8, dtype: "float64" },
];

const MiB = 1024 * 1024;
const mib = (bytes: number): string => (bytes / MiB).toFixed(1);
const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

test.describe("OPFS storage benchmark", () => {
  test.setTimeout(600_000);

  test("RAM mode vs data-on-disk (OPFS) — real runtime API", async ({
    page,
  }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });

    await page.goto("/");
    await waitForRuntimeReady(page);

    // Skip cleanly when the browser cannot provide OPFS (older engines /
    // insecure contexts). The default CI run never reaches here because
    // the spec is opt-in (perf project only). The instance accessor is part
    // of the RuntimeApi surface, so it works in both runtime modes (the
    // worker façade forwards it to the worker, where the store lives).
    const diskSupported = await page.evaluate(async () =>
      (
        window as unknown as {
          runtime: { isDiskStorageSupported(): boolean | Promise<boolean> };
        }
      ).runtime.isDiskStorageSupported(),
    );
    test.skip(!diskSupported, "on-disk storage unavailable in this context");

    const results = await page.evaluate(
      async (configs: BenchConfig[]): Promise<ConfigResult[]> => {
        // Minimal structural view of the public runtime surface we drive.
        interface ImagePayload {
          data_min: number;
          data_max: number;
        }
        interface BenchRuntime {
          setStorageMode(mode: "ram" | "disk"): Promise<void>;
          addImageFromArray(params: {
            title: string;
            data: Float64Array | Float32Array;
            width: number;
            height: number;
            dtype: string;
          }): Promise<string>;
          getImageData(oid: string): Promise<ImagePayload>;
          deleteAllObjects(kind: "signal" | "image"): Promise<void>;
          getMemoryUsage(): { wasmBytes: number };
          getSpilledCount(): number;
          getDiskStoreBytes(): number;
        }
        const runtime = (window as unknown as { runtime: BenchRuntime })
          .runtime;

        const heap = (): number => runtime.getMemoryUsage().wasmBytes ?? 0;

        const fillArray = (
          side: number,
          dtype: "float64" | "float32",
          value: number,
        ): Float64Array | Float32Array => {
          const a =
            dtype === "float64"
              ? new Float64Array(side * side)
              : new Float32Array(side * side);
          a.fill(value);
          return a;
        };

        const runMode = async (
          mode: "ram" | "disk",
          cfg: BenchConfig,
        ): Promise<ModeMetrics> => {
          await runtime.setStorageMode(mode);
          await runtime.deleteAllObjects("image");

          const base = heap();
          let createPeak = base;
          const createMs: number[] = [];
          const oids: string[] = [];
          for (let i = 0; i < cfg.n; i++) {
            const data = fillArray(cfg.side, cfg.dtype, i);
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

          let readPeak = heap();
          const readMs: number[] = [];
          let checksum = 0;
          for (const oid of oids) {
            const t0 = performance.now();
            const img = await runtime.getImageData(oid);
            readMs.push(performance.now() - t0);
            // Each image is np.full(side², i): min == max == i.
            checksum += img.data_min;
            const h = heap();
            if (h > readPeak) readPeak = h;
          }

          const after = heap();
          await runtime.deleteAllObjects("image");
          return {
            base,
            createPeak,
            readPeak,
            after,
            createMs,
            readMs,
            checksum,
            spilledCount,
            diskBytes,
          };
        };

        const out: ConfigResult[] = [];
        for (const cfg of configs) {
          const ram = await runMode("ram", cfg);
          const disk = await runMode("disk", cfg);
          // Always leave the runtime back in the default RAM mode.
          await runtime.setStorageMode("ram");
          out.push({
            side: cfg.side,
            n: cfg.n,
            dtype: cfg.dtype,
            ram,
            disk,
          });
        }
        return out;
      },
      CONFIGS,
    );

    // ---------------------------------------------------------------
    // Report
    // ---------------------------------------------------------------
    const rows: Record<string, string>[] = [];
    for (const r of results) {
      const itemBytes = r.side * r.side * (r.dtype === "float64" ? 8 : 4);
      const workingSet = itemBytes * r.n;
      const ramGrowth = r.ram.createPeak - r.ram.base;
      const diskGrowth = r.disk.createPeak - r.disk.base;
      const reduction = ramGrowth > 0 ? (1 - diskGrowth / ramGrowth) * 100 : 0;
      rows.push({
        config: `${r.side}² ×${r.n} ${r.dtype}`,
        "workingSet(MiB)": mib(workingSet),
        "ram peak Δheap(MiB)": mib(ramGrowth),
        "disk peak Δheap(MiB)": mib(diskGrowth),
        "heap saved(%)": reduction.toFixed(0),
        "disk spilled": String(r.disk.spilledCount),
        "disk store(MiB)": mib(r.disk.diskBytes),
        "ram add ms/img": mean(r.ram.createMs).toFixed(1),
        "disk add ms/img": mean(r.disk.createMs).toFixed(1),
        "ram read ms/img": mean(r.ram.readMs).toFixed(1),
        "disk read ms/img": mean(r.disk.readMs).toFixed(1),
      });
    }
    console.log("\n=== On-disk storage benchmark: RAM vs OPFS ===");
    console.table(rows);

    // Persist machine-readable results next to the other benchmark
    // outputs so they can be tracked over time.
    const here = dirname(fileURLToPath(import.meta.url));
    const resultsDir = join(here, "..", "benchmark", "results");
    mkdirSync(resultsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = join(resultsDir, `opfs_storage_${stamp}.json`);
    writeFileSync(
      outPath,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), configs: CONFIGS, results },
        null,
        2,
      ),
    );
    console.log(`[opfs-bench] results written to ${outPath}\n`);

    // ---------------------------------------------------------------
    // Invariants
    // ---------------------------------------------------------------
    for (const r of results) {
      const ramGrowth = r.ram.createPeak - r.ram.base;
      const diskGrowth = r.disk.createPeak - r.disk.base;
      const expectedChecksum = (r.n * (r.n - 1)) / 2;

      // 1. Data integrity: both modes recover the same per-image values.
      expect(r.ram.checksum).toBeCloseTo(expectedChecksum, 3);
      expect(r.disk.checksum).toBeCloseTo(expectedChecksum, 3);

      // 2. Disk mode actually spilled every object during creation.
      expect(r.disk.spilledCount).toBe(r.n);
      expect(r.disk.diskBytes).toBeGreaterThan(0);

      // 3. Heap decoupling (the headline): on-disk peak heap growth must
      //    be a small fraction of the RAM run's, because only one object
      //    is resident at a time instead of all ``n``. Tolerance is
      //    generous — Pyodide grows the heap in coarse pages and never
      //    returns it to the OS — but the gap is large enough (~n×) that
      //    a 60 % threshold is safe and meaningful.
      expect(diskGrowth).toBeLessThan(ramGrowth * 0.6);
    }
  });
});
