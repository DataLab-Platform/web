/**
 * IndexedDB-backed persistence for notebooks.
 *
 * The schema is intentionally trivial: one ``notebooks`` object store
 * keyed by notebook id, with each record storing the full nbformat v4.5
 * representation plus a small index payload (name, updated timestamp)
 * for cheap listing without parsing the JSON.
 *
 * The store is opened lazily and shared across the application via
 * :func:`getDb`.  All operations are best-effort: persistence failures
 * are surfaced through promise rejections but do *not* corrupt the
 * in-memory model.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { NotebookModel } from "./types";
import {
  ipynbToNotebook,
  notebookToIpynb,
  notebookToJsonString,
} from "./nbformat";

const DB_NAME = "datalab-web.notebooks";
const DB_VERSION = 1;
const STORE = "notebooks";

interface NotebookRecord {
  id: string;
  name: string;
  updatedAt: number;
  /** Full nbformat v4.5 JSON. */
  ipynb: unknown;
}

interface NotebookIndexEntry {
  id: string;
  name: string;
  updatedAt: number;
}

interface Schema extends DBSchema {
  [STORE]: {
    key: string;
    value: NotebookRecord;
    indexes: { "by-updated": number };
  };
}

let _dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!_dbPromise) {
    _dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("by-updated", "updatedAt");
        }
      },
    });
  }
  return _dbPromise;
}

/** Persist (insert-or-update) a notebook. */
export async function saveNotebook(nb: NotebookModel): Promise<void> {
  const db = await getDb();
  const record: NotebookRecord = {
    id: nb.id,
    name: nb.name,
    updatedAt: Date.now(),
    ipynb: notebookToIpynb(nb),
  };
  await db.put(STORE, record);
}

/** Fetch a notebook by id, returning ``null`` if missing. */
export async function loadNotebook(id: string): Promise<NotebookModel | null> {
  const db = await getDb();
  const rec = await db.get(STORE, id);
  if (!rec) return null;
  const nb = ipynbToNotebook(rec.ipynb, rec.name);
  // Force the on-disk id so the returned model survives saveNotebook
  // round-trips without spawning duplicates.
  nb.id = rec.id;
  return nb;
}

/** List the persisted notebooks, newest first. */
export async function listNotebooks(): Promise<NotebookIndexEntry[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, "by-updated");
  return all
    .map((r) => ({ id: r.id, name: r.name, updatedAt: r.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteNotebook(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

/**
 * Trigger a browser download for *nb* as ``<safeName>.ipynb``.
 *
 * Mirrors :func:`MacroPanel.handleExport` so the UX is consistent
 * across panels.
 */
export function downloadNotebookAsIpynb(nb: NotebookModel): void {
  const text = notebookToJsonString(nb);
  const blob = new Blob([text], {
    type: "application/x-ipynb+json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = nb.name.replace(/[^-A-Za-z0-9_.() ]+/g, "_") || "notebook";
  a.download = `${safe}.ipynb`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
