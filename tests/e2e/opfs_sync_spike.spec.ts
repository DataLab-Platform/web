/**
 * OPFS synchronous-access-handle spike — de-risking the "Worker + sync OPFS"
 * performance step (DEW ADR #2, documented next step).
 *
 * Goal
 * ----
 * The shipped on-disk storage mode spills heavy arrays to OPFS through the
 * **asynchronous, main-thread** ``createWritable`` path (out-of-place
 * whole-file rewrite). That keeps the WASM heap flat but adds ~150-280 ms
 * of write/read latency per image. The documented optimisation moves the
 * Pyodide runtime into a Dedicated Web Worker and switches to the
 * **synchronous, in-place** ``createSyncAccessHandle`` I/O — which is
 * Worker-only by spec.
 *
 * Before paying for that structural refactor (runtime → Worker, postMessage
 * bridge, COOP/COEP question), this spike answers three go/no-go questions
 * in isolation, **without touching the app**:
 *
 *   1. Does ``createSyncAccessHandle`` actually work inside a plain
 *      Dedicated Worker on our deploy target (Chromium), returning
 *      byte-for-byte correct data?
 *   2. How much faster is the synchronous in-place path than the current
 *      asynchronous ``createWritable`` path, at realistic image sizes?
 *   3. Is cross-origin isolation (COOP/COEP / SharedArrayBuffer) required
 *      for the sync handle itself? (It is not — only SAB needs it. The
 *      worker here is created from a same-origin blob and uses plain
 *      ``postMessage``, proving the perf win is reachable on a static
 *      GitHub Pages deploy without special headers.)
 *
 * This is a throwaway de-risking probe (perf project), not a regression
 * invariant. Run with:
 *   npx playwright test --project=perf tests/e2e/opfs_sync_spike.spec.ts --reporter=list
 *   # or:  npm run spike:opfs-sync
 */
import { test, expect } from "@playwright/test";

/** One payload-size configuration to probe. */
interface SpikeConfig {
  /** Human label (e.g. "1024² f64"). */
  label: string;
  /** Bytes per payload (mirrors a NumPy array's nbytes). */
  bytes: number;
  /** Number of payloads written/read in the run. */
  n: number;
}

/** Per-path latency metrics returned by the in-browser drivers. */
interface PathMetrics {
  writeMs: number[];
  readMs: number[];
  /** Sampled integrity checksum (sum of one byte per payload). */
  checksum: number;
}

interface SpikeResult {
  label: string;
  bytes: number;
  n: number;
  /** Synchronous ``createSyncAccessHandle`` path, run inside a Worker. */
  sync: PathMetrics;
  /** Asynchronous ``createWritable`` path, run on the main thread
   *  (mirrors the shipped ``OpfsObjectStore``). */
  async: PathMetrics;
}

const MiB = 1024 * 1024;
const mib = (bytes: number): string => (bytes / MiB).toFixed(1);
const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

// float64 image payloads: 1024² = 8 MiB, 2048² = 32 MiB (mirrors the
// on-disk storage benchmark configurations).
const CONFIGS: SpikeConfig[] = [
  { label: "1024² f64", bytes: 1024 * 1024 * 8, n: 8 },
  { label: "2048² f64", bytes: 2048 * 2048 * 8, n: 4 },
];

/**
 * Body of the Dedicated Worker that exercises the synchronous OPFS path.
 *
 * Shipped as a same-origin blob (``URL.createObjectURL``) so it inherits
 * the page's secure origin and OPFS access without any Vite module-graph
 * wiring. Plain JS (no TS types) on purpose — it runs verbatim in the
 * browser worker, not through the bundler.
 */
const SYNC_WORKER_SOURCE = String.raw`
self.onmessage = async (e) => {
  const { configs } = e.data;
  try {
    if (typeof FileSystemFileHandle === "undefined" ||
        typeof FileSystemFileHandle.prototype.createSyncAccessHandle
          !== "function") {
      self.postMessage({ ok: false, reason: "no-sync-access-handle" });
      return;
    }
    const root = await navigator.storage.getDirectory();
    // Fresh subtree per run.
    try { await root.removeEntry("spike-sync", { recursive: true }); } catch {}
    const dir = await root.getDirectoryHandle("spike-sync", { create: true });

    const results = [];
    for (const cfg of configs) {
      const src = new Uint8Array(cfg.bytes);
      // Cheap deterministic fill so reads can be integrity-checked.
      for (let i = 0; i < cfg.bytes; i += 4096) src[i] = (i / 4096) & 0xff;
      src[0] = 1; // distinct first byte → checksum sums to cfg.n

      const writeMs = [], readMs = [];
      let checksum = 0;
      for (let k = 0; k < cfg.n; k++) {
        const fh = await dir.getFileHandle("obj_" + k, { create: true });
        // Sync handle — DEDICATED-WORKER-ONLY by spec. Exclusive lock on
        // this single file; the directory-of-objects layout means other
        // files stay independently writable (true concurrency).
        const h = await fh.createSyncAccessHandle();
        let t = performance.now();
        h.write(src, { at: 0 });   // in-place write
        h.flush();
        writeMs.push(performance.now() - t);

        const rb = new Uint8Array(cfg.bytes);
        t = performance.now();
        h.read(rb, { at: 0 });     // in-place read
        readMs.push(performance.now() - t);
        h.close();
        checksum += rb[0];
      }
      results.push({ label: cfg.label, bytes: cfg.bytes, n: cfg.n,
                     writeMs, readMs, checksum });
    }
    try { await root.removeEntry("spike-sync", { recursive: true }); } catch {}
    self.postMessage({ ok: true, results });
  } catch (err) {
    self.postMessage({ ok: false, reason: String(err) });
  }
};
`;

test.describe("OPFS sync-access-handle spike", () => {
  test.setTimeout(300_000);

  test("Worker sync handle vs main-thread async writable", async ({ page }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[browser:error]", msg.text());
    });

    await page.goto("/");

    const supported = await page.evaluate(
      () =>
        typeof navigator !== "undefined" &&
        typeof navigator.storage?.getDirectory === "function" &&
        globalThis.isSecureContext === true,
    );
    test.skip(!supported, "OPFS unavailable in this context");

    // --- Synchronous path, inside a Dedicated Worker -------------------
    const syncRun = await page.evaluate(
      async ({
        configs,
        workerSource,
      }: {
        configs: SpikeConfig[];
        workerSource: string;
      }): Promise<{
        ok: boolean;
        reason?: string;
        results?: SpikeResult["sync"][] & { label: string; bytes: number }[];
      }> => {
        const blob = new Blob([workerSource], {
          type: "application/javascript",
        });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        try {
          return await new Promise((resolve) => {
            worker.onmessage = (ev) => resolve(ev.data);
            worker.onerror = (ev) =>
              resolve({ ok: false, reason: String(ev.message) });
            worker.postMessage({ configs });
          });
        } finally {
          worker.terminate();
          URL.revokeObjectURL(url);
        }
      },
      { configs: CONFIGS, workerSource: SYNC_WORKER_SOURCE },
    );

    // The whole point of the spike: the sync handle must work in a Worker.
    expect(syncRun.ok, `sync path failed: ${syncRun.reason ?? "?"}`).toBe(true);

    // --- Asynchronous path, on the main thread (shipped mechanism) -----
    const asyncRun = await page.evaluate(async (configs: SpikeConfig[]) => {
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry("spike-async", { recursive: true });
      } catch {
        /* fresh */
      }
      const dir = await root.getDirectoryHandle("spike-async", {
        create: true,
      });
      const results: {
        label: string;
        bytes: number;
        n: number;
        writeMs: number[];
        readMs: number[];
        checksum: number;
      }[] = [];
      for (const cfg of configs) {
        const src = new Uint8Array(cfg.bytes);
        for (let i = 0; i < cfg.bytes; i += 4096) src[i] = (i / 4096) & 0xff;
        src[0] = 1;
        const writeMs: number[] = [];
        const readMs: number[] = [];
        let checksum = 0;
        for (let k = 0; k < cfg.n; k++) {
          const fh = await dir.getFileHandle("obj_" + k, { create: true });
          let t = performance.now();
          const w = await fh.createWritable();
          await w.write(src.buffer);
          await w.close();
          writeMs.push(performance.now() - t);

          t = performance.now();
          const file = await fh.getFile();
          const rb = new Uint8Array(await file.arrayBuffer());
          readMs.push(performance.now() - t);
          checksum += rb[0];
        }
        results.push({
          label: cfg.label,
          bytes: cfg.bytes,
          n: cfg.n,
          writeMs,
          readMs,
          checksum,
        });
      }
      try {
        await root.removeEntry("spike-async", { recursive: true });
      } catch {
        /* ignore */
      }
      return results;
    }, CONFIGS);

    // --- Merge, report, assert ----------------------------------------
    const syncResults = syncRun.results as unknown as {
      label: string;
      bytes: number;
      n: number;
      writeMs: number[];
      readMs: number[];
      checksum: number;
    }[];

    const rows: SpikeResult[] = CONFIGS.map((cfg) => {
      const s = syncResults.find((r) => r.label === cfg.label)!;
      const a = asyncRun.find((r) => r.label === cfg.label)!;
      return {
        label: cfg.label,
        bytes: cfg.bytes,
        n: cfg.n,
        sync: { writeMs: s.writeMs, readMs: s.readMs, checksum: s.checksum },
        async: { writeMs: a.writeMs, readMs: a.readMs, checksum: a.checksum },
      };
    });

    const table = rows.map((r) => {
      const sW = mean(r.sync.writeMs);
      const sR = mean(r.sync.readMs);
      const aW = mean(r.async.writeMs);
      const aR = mean(r.async.readMs);
      return {
        payload: r.label,
        MiB: mib(r.bytes),
        n: r.n,
        "sync W ms": sW.toFixed(1),
        "sync R ms": sR.toFixed(1),
        "async W ms": aW.toFixed(1),
        "async R ms": aR.toFixed(1),
        "W speedup": `${(aW / Math.max(0.01, sW)).toFixed(1)}×`,
        "R speedup": `${(aR / Math.max(0.01, sR)).toFixed(1)}×`,
      };
    });
    console.log("\nOPFS sync (Worker) vs async (main thread):");
    console.table(table);

    for (const r of rows) {
      // Integrity: every payload round-trips its distinct first byte (=1),
      // so each checksum equals n in both paths.
      expect(r.sync.checksum).toBe(r.n);
      expect(r.async.checksum).toBe(r.n);
    }
  });
});
