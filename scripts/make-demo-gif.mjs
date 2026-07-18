#!/usr/bin/env node
/**
 * Record the scripted DataLab-Web demo and convert it to an optimised
 * animated GIF suitable for the README / website.
 *
 * Pipeline:
 *   1. Run ``playwright.demo.config.ts`` (single spec). This boots Pyodide,
 *      drives the feature showcase and captures the action window as lossless
 *      per-frame PNGs via the DevTools screencast API, writing them (with
 *      millisecond timestamps) under ``test-results/demo/frames/`` plus a
 *      ``meta.json`` manifest.
 *   2. Assemble the frames into an optimised GIF with ffmpeg (concat demuxer →
 *      palettegen/paletteuse), reproducing the original pacing from the frame
 *      timestamps.
 *   3. If the GIF exceeds the size budget, retry with gradually cheaper
 *      settings (fps → width) until it fits.
 *
 * Lossless frames (rather than Playwright's ~0.5 Mb/s VP8 WebM) are what make
 * the GIF crisp: the WebM's block artefacts otherwise cap quality before the
 * 256-colour quantisation.
 *
 * Requirements: ``ffmpeg`` on PATH.
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
 *   node scripts/make-demo-gif.mjs --width 1280 --fps 25 --colors 256
 *   node scripts/make-demo-gif.mjs --target-mb 12 --out doc/images/demo.gif
 *   node scripts/make-demo-gif.mjs --speed 1.5      # faster playback
 *   node scripts/make-demo-gif.mjs --theme dark     # record in dark mode
 *   node scripts/make-demo-gif.mjs --quality low    # smaller 820px GIF (<=4 MB)
 *
 * Quality profiles (``--quality``, default ``high``):
 *   high — 1280px (native capture resolution), 25 fps, 256-colour global
 *          palette: the sharpest, smoothest GIF (~12 MB budget).
 *   low  — 820px, 20 fps: a smaller drop-in variant (<=4 MB budget).
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
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
// Force the recorded UI theme ("light" | "dark"). When omitted the app
// follows the browser's ``prefers-color-scheme`` (light in headless Chromium).
const THEME = arg("theme", null);
if (THEME !== null && THEME !== "light" && THEME !== "dark") {
  fail(`--theme must be "light" or "dark" (got "${THEME}").`);
}
// Quality profile ("high" | "low"). ``high`` (default) is the sharper, smoother
// encoding pinned to 820px; ``low`` reproduces the original legacy settings
// (smaller file, lower quality).
const QUALITY = arg("quality", "high");
if (QUALITY !== "high" && QUALITY !== "low") {
  fail(`--quality must be "high" or "low" (got "${QUALITY}").`);
}
// Default output name carries a ``-light``/``-dark`` suffix when a theme is
// forced, so the two variants don't overwrite each other. An explicit
// ``--out`` always wins.
const DEFAULT_OUT = THEME
  ? `doc/images/datalab-web-demo-${THEME}.gif`
  : "doc/images/datalab-web-demo.gif";
const OUT = resolve(ROOT, arg("out", DEFAULT_OUT));

// Per-quality encoding profiles. Each drives the size-search preset ladder
// (cheapest-last, first that fits the budget wins), the default size budget and
// the palettegen/paletteuse tuning. Both source from the lossless screencast
// frames; ``high`` outputs at the native 1280px capture resolution (no
// downscale) at 25 fps with a global palette (``stats_mode=full``), while
// ``low`` is a smaller 820px drop-in variant.
const QUALITY_PROFILES = {
  low: {
    targetMb: 4,
    statsMode: "diff",
    bayerScale: 3,
    presets: [
      { width: 820, fps: 20, colors: 256 },
      { width: 820, fps: 15, colors: 224 },
      { width: 820, fps: 12, colors: 192 },
    ],
  },
  high: {
    targetMb: 12,
    statsMode: "full",
    bayerScale: 4,
    presets: [
      { width: 1280, fps: 25, colors: 256 },
      { width: 1280, fps: 20, colors: 256 },
      { width: 1100, fps: 20, colors: 256 },
      { width: 960, fps: 20, colors: 224 },
      { width: 820, fps: 20, colors: 192 },
    ],
  },
};
const PROFILE = QUALITY_PROFILES[QUALITY];

const TARGET_MB = Number(arg("target-mb", String(PROFILE.targetMb)));
const SPEED = Number(arg("speed", "1")); // >1 = faster playback
// Forced overrides (skip the auto size-search when all three are given).
const FORCE_WIDTH = arg("width", null);
const FORCE_FPS = arg("fps", null);
const FORCE_COLORS = arg("colors", null);

// Progressive presets, cheapest-last. The first that fits the budget wins.
// ``colors`` is the GIF palette size (max 256); fewer colours + lower fps
// + smaller width all shrink the file.
const PRESETS = PROFILE.presets;

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

function megabytes(path) {
  return statSync(path).size / (1024 * 1024);
}

/** Build an ffmpeg ``concat`` demuxer script from the screencast frame manifest,
 *  using each frame's timestamp delta as its on-screen duration so the GIF
 *  reproduces the original (variable) pacing. Returns the script path. */
function buildConcatFile(frames, framesDir) {
  // The concat demuxer resolves relative entries against the *script* file's
  // directory, so emit absolute (forward-slash) paths to avoid surprises.
  const path = (f) => resolve(ROOT, framesDir, f).replace(/\\/g, "/");
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const nextT = frames[i + 1]?.t;
    const prevT = frames[i - 1]?.t;
    // Duration until the next frame; clamp to a sane floor and fall back to the
    // previous gap (or ~50 ms) for the final frame.
    const durMs =
      nextT !== undefined
        ? Math.max(10, nextT - frames[i].t)
        : Math.max(10, frames[i].t - (prevT ?? frames[i].t - 50));
    lines.push(`file '${path(frames[i].file)}'`);
    lines.push(`duration ${(durMs / 1000).toFixed(4)}`);
  }
  // The concat demuxer ignores the last ``duration``; repeat the final frame so
  // it is held for its intended time.
  lines.push(`file '${path(frames[frames.length - 1].file)}'`);
  const out = join(DEMO_DIR, "frames.txt");
  writeFileSync(out, lines.join("\n"), "utf-8");
  return out;
}

// ── 1. record ─────────────────────────────────────────────────────────
if (!SKIP_RECORD) {
  console.log("[demo-gif] Recording demo (Playwright)…");
  // ``npx`` is a ``.cmd`` shim on Windows; recent Node refuses to spawn
  // ``.cmd``/``.bat`` without a shell, so run the recording through one.
  const rec = spawnSync("npx playwright test -c playwright.demo.config.ts", {
    stdio: "inherit",
    shell: true,
    env: THEME ? { ...process.env, DEMO_THEME: THEME } : process.env,
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

// The GIF is always built from the lossless screencast frames captured by the
// spec over the (already-trimmed) action window.
const framesDir =
  meta.framesDir && existsSync(meta.framesDir) ? meta.framesDir : null;
const hasFrames =
  framesDir &&
  Array.isArray(meta.frames) &&
  meta.frames.length > 0 &&
  existsSync(join(framesDir, meta.frames[0].file));
if (!hasFrames)
  fail(
    "No screencast frames found (meta.frames). Re-record without " +
      "--skip-record.",
  );

// Build the ffmpeg concat script (per-frame durations from the timestamps).
const concatFile = buildConcatFile(meta.frames, framesDir);

console.log(
  `[demo-gif] Source : ${meta.frames.length} lossless frames (${framesDir})`,
);

// ── 3. encode (with size search) ──────────────────────────────────────
/** Encode the trimmed window straight to an optimised GIF with ffmpeg's
 *  palettegen/paletteuse pipeline (single pass via ``split``). */
function encode(width, fps, colors) {
  mkdirSync(resolve(OUT, ".."), { recursive: true });
  const pre = SPEED !== 1 ? `setpts=PTS/${SPEED},` : "";
  const chain =
    `[0:v]${pre}fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];` +
    `[a]palettegen=max_colors=${colors}:stats_mode=${PROFILE.statsMode}[p];` +
    `[b][p]paletteuse=dither=bayer:bayer_scale=${PROFILE.bayerScale}:diff_mode=rectangle`;
  // The concat demuxer carries per-frame durations; ``fps`` in the filter
  // resamples this variable-rate input to the target constant frame rate.
  const args = [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatFile,
    "-filter_complex",
    chain,
    "-loop",
    "0",
    OUT,
  ];
  run(FFMPEG, args, "ffmpeg GIF encode");
}

function attempt(width, fps, colors) {
  console.log(
    `[demo-gif] Encoding @ ${width}px ${fps}fps ${colors} colours ` +
      `(quality=${QUALITY}, speed ×${SPEED})…`,
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
