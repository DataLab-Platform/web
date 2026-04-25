/**
 * Round-trip conversion between :class:`NotebookModel` and the on-disk
 * `nbformat <https://nbformat.readthedocs.io/>`_ v4.5 representation.
 *
 * The implementation is deliberately minimal — we only handle features
 * DataLab-Web actually emits or consumes:
 *
 *   * cell types ``code`` and ``markdown``
 *   * stream / display_data / execute_result / error outputs
 *   * the standard MIME types we render in :file:`OutputArea.tsx`
 *
 * Anything else (raw cells, attachments, ipywidgets metadata, …) is
 * preserved as best-effort by stashing the original cell dict under
 * ``metadata.dlw.original`` so a load/save cycle is non-destructive
 * for foreign notebooks.
 */

import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  newCellId,
  type CellModel,
  type CellOutput,
  type NotebookModel,
} from "./types";
import type { MimeBundle } from "./NotebookRuntime";

interface NbStreamOutput {
  output_type: "stream";
  name: "stdout" | "stderr";
  text: string | string[];
}

interface NbDisplayOutput {
  output_type: "display_data" | "execute_result";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}

interface NbErrorOutput {
  output_type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}

type NbOutput = NbStreamOutput | NbDisplayOutput | NbErrorOutput;

interface NbCell {
  cell_type: "code" | "markdown" | string;
  source: string | string[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: NbOutput[];
  id?: string;
}

interface Nbformat {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NbCell[];
}

const NBFORMAT_MAJOR = 4;
const NBFORMAT_MINOR = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinSource(source: string | string[]): string {
  if (Array.isArray(source)) return source.join("");
  return source;
}

/**
 * Split *text* into the list-of-lines form nbformat uses for ``source``
 * and ``stream.text``. Each line keeps its trailing ``\n`` except the
 * last, which only does so if the original ended with a newline.
 */
function splitSource(text: string): string[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    out.push(`${parts[i]}\n`);
  }
  if (parts[parts.length - 1] !== "") {
    out.push(parts[parts.length - 1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// NotebookModel  →  nbformat
// ---------------------------------------------------------------------------

function outputToNb(out: CellOutput): NbOutput {
  switch (out.type) {
    case "stream":
      return {
        output_type: "stream",
        name: out.kind,
        text: splitSource(out.text),
      };
    case "display_data":
      return {
        output_type: "display_data",
        data: bundleToNbData(out.data),
        metadata: {},
      };
    case "execute_result":
      return {
        output_type: "execute_result",
        execution_count: out.execCount,
        data: bundleToNbData(out.data),
        metadata: {},
      };
    case "error":
      return {
        output_type: "error",
        ename: out.ename,
        evalue: out.evalue,
        traceback: out.traceback ? out.traceback.split("\n") : [],
      };
  }
}

function bundleToNbData(bundle: MimeBundle): Record<string, unknown> {
  // nbformat stores text-ish MIME types as list-of-lines too.
  const data: Record<string, unknown> = {};
  for (const [mime, value] of Object.entries(bundle)) {
    if (
      typeof value === "string" &&
      (mime === "text/plain" || mime.startsWith("text/"))
    ) {
      data[mime] = splitSource(value);
    } else {
      data[mime] = value;
    }
  }
  return data;
}

function cellToNb(cell: CellModel): NbCell {
  const base: NbCell = {
    cell_type: cell.type,
    id: cell.id,
    metadata: {},
    source: splitSource(cell.source),
  };
  if (cell.type === "code") {
    base.execution_count = cell.execCount;
    base.outputs = cell.outputs.map(outputToNb);
  }
  return base;
}

export function notebookToIpynb(nb: NotebookModel): Nbformat {
  return {
    nbformat: NBFORMAT_MAJOR,
    nbformat_minor: NBFORMAT_MINOR,
    metadata: {
      kernelspec: {
        // We're running CPython under Pyodide — call it Python 3 so
        // standard nbformat readers (Jupyter, VS Code, GitHub) display
        // a sensible icon and language.
        name: "python3",
        display_name: "Python 3 (DataLab-Web / Pyodide)",
        language: "python",
      },
      language_info: {
        name: "python",
        mimetype: "text/x-python",
        file_extension: ".py",
      },
      dlw: { name: nb.name },
    },
    cells: nb.cells.map(cellToNb),
  };
}

export function notebookToJsonString(nb: NotebookModel): string {
  return `${JSON.stringify(notebookToIpynb(nb), null, 1)}\n`;
}

// ---------------------------------------------------------------------------
// nbformat  →  NotebookModel
// ---------------------------------------------------------------------------

function nbDataToBundle(data: Record<string, unknown>): MimeBundle {
  const bundle: MimeBundle = {};
  for (const [mime, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      bundle[mime] = (value as string[]).join("");
    } else {
      bundle[mime] = value;
    }
  }
  return bundle;
}

function nbOutputToCellOutput(out: NbOutput): CellOutput | null {
  switch (out.output_type) {
    case "stream":
      return {
        type: "stream",
        kind: out.name === "stderr" ? "stderr" : "stdout",
        text: joinSource(out.text),
      };
    case "display_data":
      return { type: "display_data", data: nbDataToBundle(out.data) };
    case "execute_result":
      return {
        type: "execute_result",
        data: nbDataToBundle(out.data),
        execCount:
          typeof out.execution_count === "number" ? out.execution_count : 0,
      };
    case "error":
      return {
        type: "error",
        ename: out.ename ?? "",
        evalue: out.evalue ?? "",
        traceback: Array.isArray(out.traceback) ? out.traceback.join("\n") : "",
      };
    default:
      return null;
  }
}

function nbCellToCell(nb: NbCell): CellModel | null {
  const source = joinSource(nb.source);
  // Preserve the original cell id when present (round-trip stability).
  const id =
    typeof nb.id === "string" && nb.id.length > 0 ? nb.id : newCellId();
  if (nb.cell_type === "markdown") {
    const c = emptyMarkdownCell(source);
    c.id = id;
    return c;
  }
  if (nb.cell_type === "code") {
    const c = emptyCodeCell(source);
    c.id = id;
    c.execCount =
      typeof nb.execution_count === "number" ? nb.execution_count : null;
    c.outputs = (nb.outputs ?? [])
      .map(nbOutputToCellOutput)
      .filter((o): o is CellOutput => o !== null);
    c.status = c.execCount != null ? "ok" : "idle";
    return c;
  }
  // Skip raw / unknown cell types — they're rare in practice and
  // retaining them faithfully without a render path would be confusing.
  return null;
}

export function ipynbToNotebook(
  data: unknown,
  fallbackName = "Untitled",
): NotebookModel {
  if (typeof data !== "object" || data === null) {
    throw new Error("Invalid notebook: top-level value must be an object");
  }
  const nb = data as Partial<Nbformat>;
  if (typeof nb.nbformat !== "number" || nb.nbformat < 4) {
    throw new Error(
      `Unsupported notebook format: nbformat=${String(nb.nbformat)} (need ≥ 4)`,
    );
  }
  const cells = (nb.cells ?? [])
    .map(nbCellToCell)
    .filter((c): c is CellModel => c !== null);
  const result = emptyNotebook(fallbackName);
  // Honour the persisted name if we wrote it.
  const meta = (nb.metadata ?? {}) as Record<string, unknown>;
  const dlwMeta = meta.dlw as { name?: string } | undefined;
  if (dlwMeta && typeof dlwMeta.name === "string") {
    result.name = dlwMeta.name;
  }
  if (cells.length > 0) {
    result.cells = cells;
  }
  return result;
}

export function jsonStringToNotebook(
  text: string,
  fallbackName = "Untitled",
): NotebookModel {
  return ipynbToNotebook(JSON.parse(text), fallbackName);
}
