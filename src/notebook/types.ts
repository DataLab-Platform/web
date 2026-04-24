/**
 * Notebook & cell models — pure TypeScript, no React.
 *
 * The shape mirrors nbformat v4.5 closely enough that Phase 3 can ship
 * a 1:1 (de)serialiser. For now the in-memory representation is the
 * source of truth.
 */

import type { MimeBundle } from "./NotebookRuntime";

export type CellType = "code" | "markdown";

export type CellOutput =
  | { type: "stream"; kind: "stdout" | "stderr"; text: string }
  | { type: "display_data"; data: MimeBundle }
  | { type: "execute_result"; data: MimeBundle; execCount: number }
  | { type: "error"; ename: string; evalue: string; traceback: string };

export type CellStatus = "idle" | "queued" | "running" | "ok" | "error";

export interface CellModel {
  id: string;
  type: CellType;
  source: string;
  outputs: CellOutput[];
  execCount: number | null;
  status: CellStatus;
}

export interface NotebookModel {
  id: string;
  name: string;
  cells: CellModel[];
}

let _idCounter = 0;
const _idPrefix = `c${Date.now().toString(36)}`;

export function newCellId(): string {
  _idCounter += 1;
  return `${_idPrefix}-${_idCounter.toString(36)}`;
}

export function newNotebookId(): string {
  _idCounter += 1;
  return `nb${_idPrefix}-${_idCounter.toString(36)}`;
}

export function emptyCodeCell(source = ""): CellModel {
  return {
    id: newCellId(),
    type: "code",
    source,
    outputs: [],
    execCount: null,
    status: "idle",
  };
}

export function emptyMarkdownCell(source = ""): CellModel {
  return {
    id: newCellId(),
    type: "markdown",
    source,
    outputs: [],
    execCount: null,
    status: "idle",
  };
}

export function emptyNotebook(name = "Untitled"): NotebookModel {
  return {
    id: newNotebookId(),
    name,
    cells: [emptyCodeCell()],
  };
}
