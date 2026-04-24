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
  "(the Sigima runtime proxy) and `display(...)` so you can start",
  "right away.",
].join("\n");

const CREATE_MD = [
  "## Create a synthetic signal",
  "",
  "Let's generate a noisy sine wave and plot it.",
].join("\n");

const CREATE_CODE = [
  "from sigima import create_signal",
  "",
  "x = np.linspace(0, 4 * np.pi, 500)",
  "y = np.sin(x) + 0.1 * np.random.default_rng(42).standard_normal(x.size)",
  'sig = create_signal("Noisy sine", x, y)',
  "display(sig)",
].join("\n");

const PROCESS_MD = "## Apply a moving-average filter";

const PROCESS_CODE = [
  "import sigima.proc.signal as sps",
  "import sigima.params as sp",
  "",
  "smoothed = sps.moving_average(sig, sp.MovingAverageParam.create(n=15))",
  "display(smoothed)",
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
  ];
  return nb;
}
