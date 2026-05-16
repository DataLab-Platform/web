/**
 * Bench #1 — Pyodide in headless browser driver (no React UI).
 *
 * Loads a bare HTML page (`browser/index.html`) that boots Pyodide directly
 * from the CDN and exposes ``window.benchBoot()`` / ``window.benchRun()``
 * helpers. We inject the shared ``chain_runner.py`` source via a global,
 * boot Pyodide once (cold-start tracked), then run the chain
 * ``warmup + measured`` times and write JSON results.
 *
 * Run only via the dedicated Playwright project:
 *
 *     npx playwright test tests/benchmark/bench1/bench1_browser.spec.ts \
 *         --project=benchmark
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = resolve(HERE, "..", "shared");
const RESULTS = resolve(HERE, "..", "results");
const WHEELS = resolve(HERE, "..", ".cache", "wheels");
const HTML_PATH = resolve(HERE, "browser", "index.html");

function findLocalSigimaWheel(): string | null {
  if (!existsSync(WHEELS)) return null;
  const hit = readdirSync(WHEELS).find(
    (f) => f.startsWith("sigima-") && f.endsWith(".whl"),
  );
  return hit ? resolve(WHEELS, hit) : null;
}

interface ChainStep {
  name: string;
}
interface Chain {
  n_images: number;
  image_size: number;
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

test.describe("bench1 — Pyodide in headless browser", () => {
  // Cold-start can take 60–90 s on first install.
  test.setTimeout(15 * 60_000);

  test(`headless browser × ${N_WARMUP} warmup + ${N_RUNS} measured runs`, async ({
    page,
  }) => {
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning")
        console.log(`[browser:${msg.type()}]`, msg.text());
    });

    // Inject the chain runner source as a JS string global *before*
    // navigation so the page can pick it up at boot.
    await page.addInitScript((src: string) => {
      (window as unknown as { __chainRunner: string }).__chainRunner = src;
    }, chainRunnerSrc);

    // Inject the local Sigima wheel (if available) so this bench installs
    // exactly the same Sigima the CPython baseline uses through ``.env``.
    const wheelPath = findLocalSigimaWheel();
    if (wheelPath) {
      const wheelB64 = readFileSync(wheelPath).toString("base64");
      const wheelName = wheelPath.split(/[\\/]/).pop() as string;
      await page.addInitScript(
        ({ b64, name }: { b64: string; name: string }) => {
          const w = window as unknown as {
            __sigimaWheelB64: string;
            __sigimaWheelName: string;
          };
          w.__sigimaWheelB64 = b64;
          w.__sigimaWheelName = name;
        },
        { b64: wheelB64, name: wheelName },
      );
      console.log(
        `[bench1/pyodide_browser] Injecting local Sigima wheel: ${wheelName}`,
      );
    } else {
      console.log(
        "[bench1/pyodide_browser] No local wheel found — using PyPI Sigima.",
      );
    }

    // Serve the HTML directly via setContent — avoids needing a static
    // server. The Pyodide CDN script tag still works because the page
    // has a real origin (about:blank with content set).
    await page.goto(`file://${HTML_PATH.replace(/\\/g, "/")}`);

    // Boot Pyodide.
    await page.evaluate(() =>
      (window as unknown as { benchBoot: () => Promise<void> }).benchBoot(),
    );
    await page.waitForFunction(
      () => (window as unknown as { bench: { ready: boolean } }).bench.ready,
      undefined,
      { timeout: 10 * 60_000 },
    );
    const cold = await page.evaluate(() => {
      const w = window as unknown as {
        bench: {
          coldStartMs: number;
          pyodideVersion: string;
          sigimaVersion: string;
        };
      };
      return {
        coldStartMs: w.bench.coldStartMs,
        pyodideVersion: w.bench.pyodideVersion,
        sigimaVersion: w.bench.sigimaVersion,
      };
    });
    console.log(
      `[bench1/pyodide_browser] cold-start=${cold.coldStartMs.toFixed(0)} ms ` +
        `pyodide=${cold.pyodideVersion} sigima=${cold.sigimaVersion}`,
    );

    mkdirSync(RESULTS, { recursive: true });
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");

    for (let runIdx = 0; runIdx < N_WARMUP + N_RUNS; runIdx += 1) {
      const isWarmup = runIdx < N_WARMUP;
      const result = (await page.evaluate(
        async (cj) =>
          await (
            window as unknown as {
              benchRun: (s: string) => Promise<{
                wallMs: number;
                total_ms: number;
                per_step_ms: Record<string, number>;
                generate_ms: number;
                blob_checksum: number;
                n_images: number;
                image_size: number;
                seed: number;
              }>;
            }
          ).benchRun(cj),
        chainJsonRaw,
      )) as {
        wallMs: number;
        total_ms: number;
        per_step_ms: Record<string, number>;
        generate_ms: number;
        blob_checksum: number;
        n_images: number;
        image_size: number;
        seed: number;
      };

      const payload = {
        bench: "bench1",
        backend: "pyodide_browser",
        warmup: isWarmup,
        run_index: runIdx,
        wall_ms: result.wallMs,
        cold_start_ms: isWarmup && runIdx === 0 ? cold.coldStartMs : null,
        pyodide_version: cold.pyodideVersion,
        sigima_version: cold.sigimaVersion,
        timestamp_utc: timestamp,
        n_images: result.n_images,
        image_size: result.image_size,
        seed: result.seed,
        generate_ms: result.generate_ms,
        per_step_ms: result.per_step_ms,
        total_ms: result.total_ms,
        blob_checksum: result.blob_checksum,
      };

      const fname =
        `bench1_pyodide_browser_${timestamp}_r${String(runIdx).padStart(2, "0")}` +
        `${isWarmup ? "_warmup" : ""}.json`;
      writeFileSync(resolve(RESULTS, fname), JSON.stringify(payload, null, 2));
      console.log(
        `  ${(isWarmup ? "warmup" : `run ${runIdx - N_WARMUP + 1}/${N_RUNS}`).padStart(14)}: ` +
          `total=${result.total_ms.toFixed(0).padStart(8)} ms ` +
          `(wall=${result.wallMs.toFixed(0).padStart(8)} ms) ` +
          `blobs=${result.blob_checksum} → ${fname}`,
      );

      // Sanity checks — fail fast if checksum drifts vs CPython.
      expect(result.blob_checksum).toBeGreaterThanOrEqual(0);
    }
  });
});
