/**
 * "Signal & image processing" notebook template — merged transposition
 * of the ``simple_macro.py`` and ``imageproc_macro.py`` macro templates.
 *
 * Demonstrates the end-to-end ``proxy`` workflow on both panels:
 * generate data with NumPy, publish it to the workspace with
 * ``proxy.add_signal`` / ``proxy.add_image``, then run a registered
 * processing through ``proxy.calc(...)``.
 */
import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type NotebookModel,
} from "../types";

const INTRO_MD = [
  "# Signal & image processing",
  "",
  "This notebook mirrors the **Simple example** and **Image processing**",
  "macro templates in a single tour of the `proxy` workspace API.",
  "Every cell uses `await` because `proxy` methods are coroutines.",
  "",
  "Steps:",
  "1. Generate a 1D signal, push it to the **Signals** panel and run a",
  "   moving-average filter through `proxy.calc(...)`.",
  "2. Generate a noisy 2D Gaussian, push it to the **Images** panel and",
  "   run an FFT.",
  "",
  "Use `await proxy.list_features()` at any point to discover the",
  "available `feature_id` strings. Signal features use a bare id",
  "(e.g. `\"moving_average\"`); image features are namespaced under",
  "`\"image:...\"` (e.g. `\"image:fft\"`).",
].join("\n");

const SIGNAL_MD = [
  "## 1. Create and publish a sinc signal",
  "",
  "Generate the data with NumPy, then upload it to the workspace.",
  "`proxy.add_signal` returns the new object's UUID; keep it around to",
  "feed `proxy.calc` below.",
].join("\n");

const SIGNAL_CODE = [
  "x = np.linspace(-10, 10, 500)",
  "y = np.sin(x) / (x + 1e-9)",
  "",
  'sig_oid = await proxy.add_signal("sinc", x, y)',
  'await proxy.set_current_panel("signal")',
  'print(f"Created signal {sig_oid}")',
].join("\n");

const SIGNAL_CALC_MD = [
  "### Apply a moving-average filter",
  "",
  "`proxy.calc(feature_id, sources=[...], params={...})` is the generic",
  "entry point for any registered processing — equivalent to picking it",
  "from the **Processing** menu in the DataLab GUI. The result is",
  "automatically added to the same panel.",
].join("\n");

const SIGNAL_CALC_CODE = [
  "result_ids = await proxy.calc(",
  '    "moving_average",',
  "    sources=[sig_oid],",
  '    params={"n": 15},',
  ")",
  'print(f"Moving-average result: {result_ids}")',
].join("\n");

const IMAGE_MD = [
  "## 2. Create and publish a noisy 2D Gaussian",
  "",
  "Same pattern, this time on a 2D NumPy array.",
].join("\n");

const IMAGE_CODE = [
  "size = 256",
  "yy, xx = np.mgrid[0:size, 0:size]",
  "cx, cy = size / 2, size / 2",
  "img = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * 30 ** 2))",
  "img += 0.05 * np.random.default_rng(0).random((size, size))",
  "",
  'img_oid = await proxy.add_image("gaussian", img)',
  'await proxy.set_current_panel("image")',
  'print(f"Created image {img_oid}")',
].join("\n");

const IMAGE_CALC_MD = [
  "### Apply an FFT to the image",
  "",
  "The `image:` prefix selects an image-side processing — see",
  "`await proxy.list_features()` for the full catalogue.",
].join("\n");

const IMAGE_CALC_CODE = [
  'result_ids = await proxy.calc("image:fft", sources=[img_oid])',
  'print(f"FFT result: {result_ids}")',
].join("\n");

/**
 * Build a fresh "Signal & image processing" notebook (new cell ids on
 * every call so it can be opened multiple times safely).
 */
export function buildSignalImageProcessingNotebook(): NotebookModel {
  const nb = emptyNotebook("Signal & image processing");
  nb.cells = [
    emptyMarkdownCell(INTRO_MD),
    emptyMarkdownCell(SIGNAL_MD),
    emptyCodeCell(SIGNAL_CODE),
    emptyMarkdownCell(SIGNAL_CALC_MD),
    emptyCodeCell(SIGNAL_CALC_CODE),
    emptyMarkdownCell(IMAGE_MD),
    emptyCodeCell(IMAGE_CODE),
    emptyMarkdownCell(IMAGE_CALC_MD),
    emptyCodeCell(IMAGE_CALC_CODE),
  ];
  return nb;
}
