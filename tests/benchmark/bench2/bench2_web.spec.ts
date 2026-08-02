/**
 * Bench #2 — DataLab-Web full-stack driver (Playwright E2E).
 *
 * Boots the real DataLab-Web app via Vite, then exercises the **same**
 * processing chain as bench #1 / bench #2-Qt, this time end-to-end through
 * the React UI + Plotly render pipeline.
 *
 * For each image, for each step:
 *
 *   1. ``runtime.applyFeature`` — pure Pyodide round-trip (process_ms).
 *   2. Dispatch ``REMOTE_MODEL_CHANGED_EVENT`` so the App refreshes the
 *      tree, click the newly-added tree item to make it current, then wait
 *      for ``plotly_afterplot`` (render_ms).
 *   3. Delete the intermediate result so the model never grows past
 *      ``1 source + 1 result`` (bounded peak memory).
 *
 * Steps with ``renders_image: false`` (blob_log) only contribute to
 * process_ms — they don't produce a visible image.
 *
 * Run via the dedicated Playwright project::
 *
 *     npx playwright test tests/benchmark/bench2/bench2_web.spec.ts \
 *         --project=benchmark
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { waitForRuntimeReady } from "../../e2e/fixtures";
import {
  installPlotlyMetrics,
  readPlotlyMetrics,
  waitForNextPlotRender,
} from "../../e2e/helpers/plotlyMetrics";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = resolve(HERE, "..", "shared");
const RESULTS = resolve(HERE, "..", "results");

interface ChainStep {
  name: string;
  kwargs: Record<string, unknown>;
  renders_image: boolean;
}
interface Chain {
  n_images: number;
  image_size: number;
  seed: number;
  noise_amplitude: number;
  warmup_runs: number;
  measured_runs: number;
  steps: ChainStep[];
}

const chainJsonRaw = readFileSync(resolve(SHARED, "chain.json"), "utf-8");
const chain = JSON.parse(chainJsonRaw) as Chain;
const chainRunnerSrc = readFileSync(
  resolve(SHARED, "chain_runner.py"),
  "utf-8",
);
const N_WARMUP = chain.warmup_runs ?? 1;
const N_RUNS = chain.measured_runs ?? 5;
const REMOTE_MODEL_CHANGED_EVENT = "datalab-web:remote-model-changed";

test.describe("bench2 — DataLab-Web full stack", () => {
  test.setTimeout(120 * 60_000);

  test(`web app × ${N_WARMUP} warmup + ${N_RUNS} measured runs`, async ({
    page,
  }) => {
    await installPlotlyMetrics(page);
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning")
        console.log(`[browser:${msg.type()}]`, msg.text());
    });

    const tColdStart = Date.now();
    await page.goto("/");
    await waitForRuntimeReady(page);
    const coldStartMs = Date.now() - tColdStart;
    console.log(`[bench2/datalab_web] cold-start=${coldStartMs} ms`);

    // Make sure we're on the Image panel.
    await page.getByRole("tab", { name: "Images" }).click();

    // Inject the chain runner module into Pyodide so we share the exact
    // same synthetic generator as CPython / Qt.
    await page.evaluate(async (src: string) => {
      type Runtime = {
        py: {
          FS: { writeFile: (p: string, d: string) => void };
          runPythonAsync: (s: string) => Promise<unknown>;
        };
      };
      const runtime = (window as unknown as { runtime: Runtime }).runtime;
      runtime.py.FS.writeFile("/home/pyodide/chain_runner.py", src);
      await runtime.py.runPythonAsync(`
import sys
if "/home/pyodide" not in sys.path:
    sys.path.insert(0, "/home/pyodide")
import chain_runner  # warm import
`);
    }, chainRunnerSrc);

    const dispatchModelChanged = (): Promise<void> =>
      page.evaluate((evtName: string) => {
        window.dispatchEvent(
          new CustomEvent(evtName, { detail: { panel: "image" } }),
        );
      }, REMOTE_MODEL_CHANGED_EVENT);

    const treeItems = page.locator(".object-tree-item");
    const waitForTreeCount = async (n: number, timeout = 30_000) => {
      await expect.poll(() => treeItems.count(), { timeout }).toBe(n);
    };

    mkdirSync(RESULTS, { recursive: true });
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");

    const sigimaVersion = (await page.evaluate(async () => {
      type Runtime = {
        py: { runPythonAsync: (s: string) => Promise<unknown> };
      };
      const r = (window as unknown as { runtime: Runtime }).runtime;
      return await r.py.runPythonAsync("import sigima; sigima.__version__");
    })) as string;

    for (let runIdx = 0; runIdx < N_WARMUP + N_RUNS; runIdx += 1) {
      const isWarmup = runIdx < N_WARMUP;
      const label = isWarmup
        ? "warmup"
        : `run ${runIdx - N_WARMUP + 1}/${N_RUNS}`;

      // Reset model between runs.
      await page.evaluate(async () => {
        type ObjectNode = { id: string };
        type GroupNode = { objects: ObjectNode[] };
        type Tree = { groups: GroupNode[] };
        type Runtime = {
          getPanelTree: (k: string) => Promise<Tree>;
          deleteObject: (id: string) => Promise<void>;
        };
        const r = (window as unknown as { runtime: Runtime }).runtime;
        const tree = await r.getPanelTree("image");
        for (const g of tree.groups)
          for (const o of g.objects) await r.deleteObject(o.id);
      });
      await dispatchModelChanged();
      await waitForTreeCount(0);

      const perStepProcessMs: Record<string, number> = {};
      const perStepRenderMs: Record<string, number | null> = {};
      for (const s of chain.steps) {
        perStepProcessMs[s.name] = 0;
        perStepRenderMs[s.name] = s.renders_image ? 0 : null;
      }
      let blobChecksum = 0;
      const tWall = Date.now();

      // Generate ALL images upfront in Pyodide (deterministic, fast),
      // then push them into _MODEL one at a time so the React tree
      // stays small and per-step render time stays meaningful.
      await page.evaluate(
        async ({ cj }: { cj: string }) => {
          type Runtime = {
            py: {
              globals: { set: (k: string, v: unknown) => void };
              runPythonAsync: (s: string) => Promise<unknown>;
            };
          };
          const r = (window as unknown as { runtime: Runtime }).runtime;
          r.py.globals.set("__bench_chain_json", cj);
          await r.py.runPythonAsync(`
import json
from chain_runner import generate_images
defn = json.loads(__bench_chain_json)
__bench_images = generate_images(int(defn["n_images"]),
                                 int(defn["image_size"]),
                                 int(defn["seed"]),
                                 noise_amplitude=float(defn.get("noise_amplitude", 0.05)))
`);
        },
        { cj: chainJsonRaw },
      );

      for (let imgIdx = 0; imgIdx < chain.n_images; imgIdx += 1) {
        // Push image #imgIdx into the model and capture its oid.
        const sourceOid = (await page.evaluate(async (i: number) => {
          type Runtime = {
            py: {
              globals: { set: (k: string, v: unknown) => void };
              runPythonAsync: (s: string) => Promise<unknown>;
            };
          };
          const r = (window as unknown as { runtime: Runtime }).runtime;
          r.py.globals.set("__bench_idx", i);
          return (await r.py.runPythonAsync(`
_MODEL.add_object("image", __bench_images[__bench_idx])
`)) as string;
        }, imgIdx)) as string;

        // Render the source image and wait until the graph is both visible and
        // instrumented. Result selections below reuse this graph, so their
        // ``plotly_afterplot`` events cannot race the listener installation.
        const sourceMetricsBefore = await readPlotlyMetrics(page);
        await dispatchModelChanged();
        await waitForTreeCount(1);
        await waitForNextPlotRender(
          page,
          sourceMetricsBefore.plotRenders.length,
          "image",
          30_000,
        );

        for (const step of chain.steps) {
          // ── Process ──
          // Analyses (e.g. blob_log) live under a separate API and
          // mutate the source object in-place; processings produce a
          // new object via applyFeature.
          const isAnalysis = step.name === "blob_log";
          const processResult = isAnalysis
            ? ((await page.evaluate(
                async ({
                  oid,
                  fid,
                  params,
                }: {
                  oid: string;
                  fid: string;
                  params: Record<string, unknown>;
                }) => {
                  type Runtime = {
                    py: {
                      globals: { set: (k: string, v: unknown) => void };
                      runPythonAsync: (s: string) => Promise<unknown>;
                    };
                  };
                  const r = (window as unknown as { runtime: Runtime }).runtime;
                  r.py.globals.set("__bench_oid", oid);
                  r.py.globals.set("__bench_fid", fid);
                  r.py.globals.set("__bench_params", params);
                  const t0 = performance.now();
                  await r.py.runPythonAsync(
                    "run_image_analysis(__bench_oid, __bench_fid, __bench_params)",
                  );
                  return {
                    newOids: [] as string[],
                    processMs: performance.now() - t0,
                  };
                },
                { oid: sourceOid, fid: step.name, params: step.kwargs },
              )) as { newOids: string[]; processMs: number })
            : ((await page.evaluate(
                async ({
                  fid,
                  src,
                  params,
                }: {
                  fid: string;
                  src: string[];
                  params: Record<string, unknown>;
                }) => {
                  type Runtime = {
                    applyFeature: (
                      fid: string,
                      src: string[],
                      op?: string | null,
                      params?: Record<string, unknown> | null,
                    ) => Promise<string[]>;
                  };
                  const r = (window as unknown as { runtime: Runtime }).runtime;
                  const t0 = performance.now();
                  const newOids = await r.applyFeature(fid, src, null, params);
                  return { newOids, processMs: performance.now() - t0 };
                },
                {
                  fid: `image:${step.name}`,
                  src: [sourceOid],
                  params: step.kwargs,
                },
              )) as { newOids: string[]; processMs: number });
          perStepProcessMs[step.name] += processResult.processMs;

          if (step.name === "blob_log") {
            // Read blob count from the metadata entry written by
            // run_image_analysis (Geometry_blob_log_dict).
            const n = (await page.evaluate(async (oid: string) => {
              type Runtime = {
                py: {
                  globals: { set: (k: string, v: unknown) => void };
                  runPythonAsync: (s: string) => Promise<unknown>;
                };
              };
              const r = (window as unknown as { runtime: Runtime }).runtime;
              r.py.globals.set("__bench_oid", oid);
              return (await r.py.runPythonAsync(`
_obj = _MODEL.get(__bench_oid)
_n = 0
for _k, _v in (_obj.metadata or {}).items():
    if isinstance(_v, dict) and _k.startswith("Geometry_") and "blob_log" in _k:
        _coords = _v.get("coords")
        if _coords is not None:
            _n += int(len(_coords))
_n
`)) as number;
            }, sourceOid)) as number;
            blobChecksum += Number(n);
          }

          // A rendering step must produce an object and a real
          // ``plotly_afterplot`` event. Missing redraws are instrumentation
          // failures, not zero-duration samples.
          if (step.renders_image) {
            expect(processResult.newOids.length).toBeGreaterThan(0);
            const metricsBefore = await readPlotlyMetrics(page);
            await dispatchModelChanged();
            await waitForTreeCount(2, 30_000);
            const tRender0 = await page.evaluate(() => performance.now());
            await treeItems.nth(1).click({ timeout: 10_000 });
            await waitForNextPlotRender(
              page,
              metricsBefore.plotRenders.length,
              "image",
              30_000,
            );
            const tRender1 = await page.evaluate(() => performance.now());
            const currentRenderMs = perStepRenderMs[step.name];
            if (currentRenderMs === null) {
              throw new Error(`Missing render accumulator for ${step.name}`);
            }
            perStepRenderMs[step.name] =
              currentRenderMs + (tRender1 - tRender0);
            // Delete intermediate(s) so the next step starts clean.
            for (const oid of processResult.newOids) {
              await page.evaluate(async (id: string) => {
                type Runtime = { deleteObject: (id: string) => Promise<void> };
                const r = (window as unknown as { runtime: Runtime }).runtime;
                await r.deleteObject(id);
              }, oid);
            }
            await dispatchModelChanged();
            try {
              await waitForTreeCount(1, 5_000);
            } catch {
              /* tolerate */
            }
          } else {
            // Drop any newOids that were produced (defensive).
            for (const oid of processResult.newOids) {
              await page.evaluate(async (id: string) => {
                type Runtime = { deleteObject: (id: string) => Promise<void> };
                const r = (window as unknown as { runtime: Runtime }).runtime;
                await r.deleteObject(id);
              }, oid);
            }
          }
        }

        // Drop the source before moving to the next image.
        await page.evaluate(async (oid: string) => {
          type Runtime = { deleteObject: (id: string) => Promise<void> };
          const r = (window as unknown as { runtime: Runtime }).runtime;
          await r.deleteObject(oid);
        }, sourceOid);
        await dispatchModelChanged();
        await waitForTreeCount(0);
      }

      // Free the Python-side image stash.
      await page.evaluate(async () => {
        type Runtime = {
          py: { runPythonAsync: (s: string) => Promise<unknown> };
        };
        const r = (window as unknown as { runtime: Runtime }).runtime;
        await r.py.runPythonAsync("del __bench_images");
      });

      const wallMs = Date.now() - tWall;
      const totalMs =
        Object.values(perStepProcessMs).reduce((a, b) => a + b, 0) +
        Object.values(perStepRenderMs).reduce((a, b) => a + (b ?? 0), 0);

      const payload = {
        bench: "bench2",
        backend: "datalab_web",
        warmup: isWarmup,
        run_index: runIdx,
        wall_ms: wallMs,
        cold_start_ms: isWarmup && runIdx === 0 ? coldStartMs : null,
        sigima_version: sigimaVersion,
        timestamp_utc: timestamp,
        n_images: chain.n_images,
        image_size: chain.image_size,
        seed: chain.seed,
        per_step_ms: perStepProcessMs,
        render_ms_per_step: perStepRenderMs,
        total_ms: totalMs,
        blob_checksum: blobChecksum,
      };
      const fname =
        `bench2_datalab_web_${timestamp}_r${String(runIdx).padStart(2, "0")}` +
        `${isWarmup ? "_warmup" : ""}.json`;
      writeFileSync(resolve(RESULTS, fname), JSON.stringify(payload, null, 2));
      const renderTotal = Object.values(perStepRenderMs).reduce(
        (a, b) => a + (b ?? 0),
        0,
      );
      console.log(
        `  ${label.padStart(14)}: total=${totalMs.toFixed(0).padStart(8)} ms ` +
          `(wall=${wallMs.toString().padStart(8)} ms, ` +
          `render=${renderTotal.toFixed(0)} ms)  blobs=${blobChecksum} → ${fname}`,
      );
      expect(blobChecksum).toBeGreaterThanOrEqual(0);
    }
  });
});
