import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { freemem } from "node:os";
import { resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const [tier, confirm, previous, ...rest] = process.argv.slice(2);
const predecessor = { 8192: "2048", 18432: "8192" }[tier];
if (
  process.env.CI ||
  !["smoke", "2048", "8192", "18432"].includes(tier) ||
  confirm !== (tier === "smoke" ? "--small-only" : `--dedicated=${tier}`) ||
  Boolean(previous) !== Boolean(predecessor) ||
  rest.length
)
  throw Error(
    "Use the documented fixed tier, confirmation and predecessor report. No CI.",
  );
if (
  tier !== "smoke" &&
  (process.platform !== "win32" || process.arch !== "x64")
)
  throw Error("Dedicated runner requires Windows x64 and stable Edge.");
const root = fileURLToPath(new URL("../../../", import.meta.url));
process.chdir(root);
const output = resolve(
  "build/wasm64/runs",
  `${new Date().toISOString().replace(/:/g, "-")}-${tier}`,
);
mkdirSync(output, { recursive: true });
const lock = resolve("build/wasm64/qualification.lock");
closeSync(openSync(lock, "wx"));
try {
  const sha = execFileSync(
    process.execPath,
    ["tools/wasm64/site-digest.mjs", "build/wasm64/benchmark"],
    { encoding: "utf8" },
  ).trim();
  if (previous) {
    const report = JSON.parse(readFileSync(previous, "utf8"));
    if (
      report.passed !== true ||
      report.tier !== predecessor ||
      report.siteSha256 !== sha
    )
      throw Error("Previous tier must have passed on the identical artifact.");
  }
  const minAvailable =
    { smoke: 0, 2048: 2, 8192: 6, 18432: 16 }[tier] * 2 ** 30;
  if (freemem() < minAvailable)
    throw Error("Insufficient available physical RAM.");
  if (tier !== "smoke" && !process.env.DLW_PROCESS_LIMIT_NOTE?.trim())
    throw Error(
      "Record the effective process/job limit in DLW_PROCESS_LIMIT_NOTE.",
    );
  console.log(`One attempt only. Reports: ${output}`);
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config",
      "tests/wasm64/benchmark/playwright.config.ts",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DLW_B_TIER: tier,
        DLW_B_CONSENT: confirm,
        DLW_B_SITE_SHA: sha,
        DLW_B_OUTPUT: output,
      },
    },
  );
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  unlinkSync(lock);
}
