#!/usr/bin/env node
/**
 * Record the scripted DataLab-Web demo and convert it to an optimised
 * animated GIF suitable for the README / website.
 *
 * Pipeline:
 *   1. Run ``playwright.demo.config.ts`` (single spec, video on). This
 *      boots Pyodide and drives the feature showcase, producing a WebM
 *      under ``test-results/demo/`` plus a ``meta.json`` with the trim
 *      window (so the long Pyodide boot is cut from the final GIF).
 *   2. Encode the trimmed action window straight to an optimised GIF with
 *      ffmpeg (palettegen/paletteuse), cutting the Pyodide boot lead-in.
 *   3. If the GIF exceeds the size budget (~4 MB), retry with gradually
 *      cheaper settings (colours → fps → width) until it fits.
 *
 * Requirements: ``ffmpeg`` on PATH (already used by Playwright for video).
 *   - ffmpeg:  winget install Gyan.FFmpeg   (or choco install ffmpeg)
 *
 * The GIF is encoded with ffmpeg's high-quality ``palettegen`` /
 * ``paletteuse`` pipeline (a per-clip optimised 256-colour palette with
 * dithering) — visually on par with gifski but with zero extra binaries
 * and no GUI. (The winget ``ImageOptim.gifski`` package ships the
 * drag-and-drop GUI, not a CLI, so it cannot be scripted.)
 *
 * Usage:
 *   node scripts/make-demo-gif.mjs                 # record + convert
 *   node scripts/make-demo-gif.mjs --skip-record   # reuse last recording
 *   node scripts/make-demo-gif.mjs --width 800 --fps 12 --colors 200
 *   node scripts/make-demo-gif.mjs --target-mb 4 --out doc/images/demo.gif
 *   node scripts/make-demo-gif.mjs --speed 1.5      # faster playback
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const DEMO_DIR = join(ROOT, "test-results", "demo");
const META = join(DEMO_DIR, "meta.json");

// ── CLI args ──────────────────────────────────────────────────────────
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && i + 1 < process.argv.length
    ? process.argv[i + 1]
    : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const SKIP_RECORD = hasFlag("skip-record");
const OUT = resolve(ROOT, arg("out", "doc/images/datalab-web-demo.gif"));
const TARGET_MB = Number(arg("target-mb", "4"));
const SPEED = Number(arg("speed", "1")); // >1 = faster playback
// Forced overrides (skip the auto size-search when all three are given).
const FORCE_WIDTH = arg("width", null);
const FORCE_FPS = arg("fps", null);
const FORCE_COLORS = arg("colors", null);

// Progressive presets, cheapest-last. The first that fits the budget wins.
// ``colors`` is the GIF palette size (max 256); fewer colours + lower fps
// + smaller width all shrink the file.
const PRESETS = [
  { width: 960, fps: 15, colors: 256 },
  { width: 960, fps: 13, colors: 256 },
  { width: 900, fps: 12, colors: 224 },
  { width: 820, fps: 12, colors: 192 },
  { width: 760, fps: 10, colors: 160 },
  { width: 680, fps: 10, colors: 128 },
];

// ── helpers ───────────────────────────────────────────────────────────
/** Resolve a binary by trying the bare name (PATH) first, then a list of
 *  known absolute fallback locations (useful right after a winget install,
 *  before the shell has picked up the updated PATH). Returns an invocable
 *  path/name, or null if none respond to a version probe. */
function resolveBin(name, fallbacks = []) {
  const versionFlags = ["--version", "-version"];
  const ok = (cmd) =>
    versionFlags.some((f) => {
      const r = spawnSync(cmd, [f], { encoding: "utf-8" });
      return !r.error && (r.status === 0 || (r.stdout ?? "").length > 0);
    });
  if (ok(name)) return name;
  for (const fb of fallbacks) {
    if (existsSync(fb) && ok(fb)) return fb;
  }
  return null;
}

function fail(msg) {
  console.error(`[demo-gif] ${msg}`);
  process.exit(1);
}

function run(bin, args, label) {
  const r = spawnSync(bin, args, { stdio: "inherit", shell: false });
  if (r.status !== 0) fail(`${label} failed (exit ${r.status}).`);
}

function findLatestWebm(dir) {
  let best = null;
  const walk = (d) => {
    for (const name of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, name.name);
      if (name.isDirectory()) walk(p);
      else if (name.name.endsWith(".webm")) {
        const m = statSync(p).mtimeMs;
        if (!best || m > best.m) best = { p, m };
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return best?.p ?? null;
}

function megabytes(path) {
  return statSync(path).size / (1024 * 1024);
}

// ── 1. record ─────────────────────────────────────────────────────────
if (!SKIP_RECORD) {
  console.log("[demo-gif] Recording demo (Playwright)…");
  // ``npx`` is a ``.cmd`` shim on Windows; recent Node refuses to spawn
  // ``.cmd``/``.bat`` without a shell, so run the recording through one.
  const rec = spawnSync("npx playwright test -c playwright.demo.config.ts", {
    stdio: "inherit",
    shell: true,
  });
  if (rec.status !== 0)
    fail(`Playwright recording failed (exit ${rec.status}).`);
}

// ── 2. resolve inputs ─────────────────────────────────────────────────
const FFMPEG = resolveBin("ffmpeg", ["C:/Program Files/ffmpeg/bin/ffmpeg.exe"]);
if (!FFMPEG)
  fail("ffmpeg not found on PATH. Install it (winget install Gyan.FFmpeg).");

let meta = {};
if (existsSync(META)) meta = JSON.parse(readFileSync(META, "utf-8"));
const videoPath =
  (meta.videoPath && existsSync(meta.videoPath) ? meta.videoPath : null) ??
  findLatestWebm(DEMO_DIR);
if (!videoPath) fail(`No recorded video found under ${DEMO_DIR}.`);

// Trim window: cut the boot lead-in, keep the action window (+small margins).
const start = Math.max(0, (Number(meta.startOffsetMs) || 0) / 1000 - 0.3);
const end =
  Number(meta.endOffsetMs) > 0 ? Number(meta.endOffsetMs) / 1000 + 0.3 : null;

console.log(`[demo-gif] Source : ${videoPath}`);
console.log(
  `[demo-gif] Trim   : ${start.toFixed(2)}s → ${end ? end.toFixed(2) + "s" : "end"}`,
);

// ── 3. encode (with size search) ──────────────────────────────────────
/** Encode the trimmed window straight to an optimised GIF with ffmpeg's
 *  palettegen/paletteuse pipeline (single pass via ``split``). */
function encode(width, fps, colors) {
  mkdirSync(resolve(OUT, ".."), { recursive: true });
  const pre = SPEED !== 1 ? `setpts=PTS/${SPEED},` : "";
  const chain =
    `[0:v]${pre}fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=diff[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
  const args = ["-y", "-ss", String(start)];
  if (end !== null) args.push("-to", String(end));
  args.push("-i", videoPath, "-filter_complex", chain, "-loop", "0", OUT);
  run(FFMPEG, args, "ffmpeg GIF encode");
}

function attempt(width, fps, colors) {
  console.log(
    `[demo-gif] Encoding @ ${width}px ${fps}fps ${colors} colours (speed ×${SPEED})…`,
  );
  encode(width, fps, colors);
  const mb = megabytes(OUT);
  console.log(`[demo-gif]   → ${mb.toFixed(2)} MB`);
  return mb;
}

let finalMb;
if (FORCE_WIDTH && FORCE_FPS && FORCE_COLORS) {
  finalMb = attempt(
    Number(FORCE_WIDTH),
    Number(FORCE_FPS),
    Number(FORCE_COLORS),
  );
} else {
  finalMb = Infinity;
  for (const p of PRESETS) {
    finalMb = attempt(
      Number(FORCE_WIDTH ?? p.width),
      Number(FORCE_FPS ?? p.fps),
      Number(FORCE_COLORS ?? p.colors),
    );
    if (finalMb <= TARGET_MB) break;
  }
}

if (finalMb > TARGET_MB) {
  console.warn(
    `[demo-gif] WARNING: smallest result is ${finalMb.toFixed(2)} MB, above the ${TARGET_MB} MB budget. ` +
      `Shorten the scenario or pass --speed 1.5 / lower --width.`,
  );
}
console.log(`[demo-gif] Done → ${OUT} (${finalMb.toFixed(2)} MB)`);
