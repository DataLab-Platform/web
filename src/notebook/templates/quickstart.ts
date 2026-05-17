/**
 * Bundled "Quickstart" notebook template — loaded on first boot when
 * the browser has no saved notebooks and no ``openIds`` in
 * localStorage. Defined as a TypeScript module rather than a
 * ``.ipynb`` file so VS Code's notebook handler doesn't auto-format
 * the source on save.
 */
import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type NotebookModel,
} from "../types";

const INTRO_MD = [
  "# Welcome to DataLab Web Notebooks",
  "",
  "This is a **quickstart notebook** demonstrating the basics of the",
  "browser-native DataLab notebook environment, powered by",
  "[Sigima](https://datalab-platform.com/) running in",
  "[Pyodide](https://pyodide.org/).",
  "",
  "* Press **Shift+Enter** (or click ▶ Run) to execute a cell.",
  "* Use **+ Code** / **+ Markdown** to insert new cells.",
  "* Notebooks are saved automatically in your browser (IndexedDB).",
  "* Use **File → Notebook → Save notebook as…** to download a `.ipynb`.",
  "",
  "The notebook namespace already exposes `np` (NumPy), `proxy`",
  "(the async DataLab workspace proxy) and `display(...)` so you can",
  "start right away. Calls on `proxy` are coroutines — always",
  "prefix them with `await`.",
].join("\n");

const CREATE_MD = [
  "## Create a synthetic signal",
  "",
  "Let's generate a noisy sine wave and plot it inline with",
  "`display(...)`. At this point the signal lives only in the",
  "notebook namespace.",
].join("\n");

const CREATE_CODE = [
  "from sigima import create_signal",
  "",
  "x = np.linspace(0, 4 * np.pi, 500)",
  "y = np.sin(x) + 0.1 * np.random.default_rng(42).standard_normal(x.size)",
  'sig = create_signal("Noisy sine", x, y)',
  "display(sig)",
].join("\n");

const PROCESS_MD = [
  "## Apply a moving-average filter",
  "",
  "Sigima processings are plain functions that take an object plus a",
  "parameter `DataSet` and return a new object.",
].join("\n");

const PROCESS_CODE = [
  "import sigima.proc.signal as sps",
  "import sigima.params as sp",
  "",
  "smoothed = sps.moving_average(sig, sp.MovingAverageParam.create(n=15))",
  "display(smoothed)",
].join("\n");

const PUBLISH_SIGNAL_MD = [
  "## Publish the signal to the DataLab workspace",
  "",
  "So far the signal only exists inside the notebook. Use `proxy`",
  "to push it to the **Signals** panel, where it can be selected,",
  "annotated and processed from the GUI alongside notebook-driven",
  "computations.",
  "",
  "`proxy.add_signal(...)` returns the new object's UUID. Switch the",
  "active panel with `proxy.set_current_panel(...)` so the new signal",
  "is visible right after the cell runs.",
].join("\n");

const PUBLISH_SIGNAL_CODE = [
  'sig_oid = await proxy.add_signal("Noisy sine (from notebook)", x, y)',
  'await proxy.set_current_panel("signal")',
  'print(f"Signal added to workspace: {sig_oid}")',
].join("\n");

const PUBLISH_IMAGE_MD = [
  "## Publish an image to the workspace",
  "",
  "The same pattern works for 2D data: build a NumPy array, then call",
  "`proxy.add_image(...)`. Below we generate a noisy 2D Gaussian and",
  "switch to the **Images** panel.",
].join("\n");

const PUBLISH_IMAGE_CODE = [
  "size = 256",
  "yy, xx = np.mgrid[0:size, 0:size]",
  "cx, cy = size / 2, size / 2",
  "img = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * 30 ** 2))",
  "img += 0.05 * np.random.default_rng(0).random((size, size))",
  "",
  'img_oid = await proxy.add_image("Noisy Gaussian", img)',
  'await proxy.set_current_panel("image")',
  'print(f"Image added to workspace: {img_oid}")',
].join("\n");

/**
 * Build a fresh "Quickstart" notebook. Each call yields a notebook
 * with new cell ids so opening the template multiple times never
 * collides on stored ids.
 */
export function buildQuickstartNotebook(): NotebookModel {
  const nb = emptyNotebook("Quickstart");
  nb.cells = [
    emptyMarkdownCell(INTRO_MD),
    emptyMarkdownCell(CREATE_MD),
    emptyCodeCell(CREATE_CODE),
    emptyMarkdownCell(PROCESS_MD),
    emptyCodeCell(PROCESS_CODE),
    emptyMarkdownCell(PUBLISH_SIGNAL_MD),
    emptyCodeCell(PUBLISH_SIGNAL_CODE),
    emptyMarkdownCell(PUBLISH_IMAGE_MD),
    emptyCodeCell(PUBLISH_IMAGE_CODE),
  ];
  return nb;
}
