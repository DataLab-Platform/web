/**
 * Reflect the workspace state (filename + dirty + recovered) in the
 * document title, mirroring desktop application conventions.
 *
 * Format:
 *
 * - clean, named:        ``DataLab-Web — workspace.h5``
 * - dirty, named:        ``DataLab-Web — workspace.h5 •``
 * - dirty, untitled:     ``DataLab-Web — Untitled •``
 * - recovered, untitled: ``DataLab-Web — Untitled • (recovered)``
 *
 * The bullet (``•``) is the conventional dirty marker used by
 * VS Code, Sublime Text, etc. The ``(recovered)`` hint is dropped on
 * the first successful HDF5 save (which clears ``recovered``).
 */

import { useEffect } from "react";

const APP_NAME = "DataLab-Web";

export interface DocumentTitleArgs {
  filename: string | null;
  dirty: boolean;
  recovered: boolean;
}

export function formatDocumentTitle({
  filename,
  dirty,
  recovered,
}: DocumentTitleArgs): string {
  const name = filename ?? "Untitled";
  const dirtyMark = dirty ? " •" : "";
  const recoveredMark = recovered ? " (recovered)" : "";
  return `${APP_NAME} — ${name}${dirtyMark}${recoveredMark}`;
}

export function useDocumentTitle(args: DocumentTitleArgs): void {
  useEffect(() => {
    document.title = formatDocumentTitle(args);
  }, [args.filename, args.dirty, args.recovered, args]);
}
