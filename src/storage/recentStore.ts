/**
 * Unified IndexedDB-backed cache for macros & notebooks.
 *
 * Why a single store?
 *   * Macros and notebooks are now both owned by the Python ``_STORE``
 *     and serialised to the workspace HDF5 file. IndexedDB is no
 *     longer the source of truth for either — it is a *roll-over
 *     cache* of recently-touched documents.
 *   * The cache survives workspace switches (HDF5 open/close), so the
 *     user can re-open a macro/notebook they were working on in a
 *     previous session — even if the current workspace doesn't
 *     contain it.
 *   * A single object store keyed by ``"<kind>:<id>"`` keeps the schema
 *     trivial and the LRU policy uniform across kinds.
 *
 * Capacity is configurable per kind (default 50 entries). When the
 * cap is exceeded on insert, the oldest entries (by ``lastSeen``) are
 * evicted.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type RecentKind = "macro" | "notebook";

/**
 * One cached document. ``content`` carries the full payload:
 *   * macros: Python source code,
 *   * notebooks: serialised nbformat v4.5 JSON.
 */
export interface RecentEntry {
  kind: RecentKind;
  id: string;
  title: string;
  content: string;
  lastSeen: number;
}

const DB_NAME = "datalab-web.recent";
const DB_VERSION = 1;
const STORE = "entries";

interface Schema extends DBSchema {
  [STORE]: {
    key: [RecentKind, string]; // compound key: ["<kind>", "<id>"]
    value: RecentEntry;
    indexes: {
      "by-kind-lastSeen": [RecentKind, number];
    };
  };
}

/** Default per-kind cap. */
const DEFAULT_MAX: Record<RecentKind, number> = { macro: 50, notebook: 50 };

const _maxEntries: Record<RecentKind, number> = { ...DEFAULT_MAX };

/** Override the per-kind cap (useful for tests, or future user setting). */
export function setMaxEntries(kind: RecentKind, max: number): void {
  _maxEntries[kind] = Math.max(1, Math.floor(max));
}

export function getMaxEntries(kind: RecentKind): number {
  return _maxEntries[kind];
}

let _dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!_dbPromise) {
    _dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, {
            keyPath: ["kind", "id"],
          });
          store.createIndex("by-kind-lastSeen", ["kind", "lastSeen"]);
        }
      },
    });
  }
  return _dbPromise;
}

/**
 * Reset the in-memory database promise. Tests use this between cases
 * (after calling ``indexedDB.deleteDatabase``) so a fresh instance is
 * created on the next operation.
 */
export function _resetForTests(): void {
  _dbPromise = null;
  _maxEntries.macro = DEFAULT_MAX.macro;
  _maxEntries.notebook = DEFAULT_MAX.notebook;
}

/** Insert-or-update *entry* and evict oldest items if the cap is exceeded. */
export async function recordRecent(
  kind: RecentKind,
  payload: { id: string; title: string; content: string },
): Promise<void> {
  const db = await getDb();
  const entry: RecentEntry = {
    kind,
    id: payload.id,
    title: payload.title,
    content: payload.content,
    lastSeen: Date.now(),
  };
  await db.put(STORE, entry);
  await _evictIfNeeded(db, kind);
}

async function _evictIfNeeded(
  db: IDBPDatabase<Schema>,
  kind: RecentKind,
): Promise<void> {
  const cap = _maxEntries[kind];
  // ``IDBKeyRange.bound`` over ``[kind, 0]`` … ``[kind, +Infinity]``
  // selects every entry of the requested kind in ascending lastSeen.
  const range = IDBKeyRange.bound(
    [kind, -Infinity],
    [kind, Number.MAX_SAFE_INTEGER],
  );
  const all = await db.getAllFromIndex(STORE, "by-kind-lastSeen", range);
  const surplus = all.length - cap;
  if (surplus <= 0) return;
  const tx = db.transaction(STORE, "readwrite");
  const objectStore = tx.objectStore(STORE);
  for (let i = 0; i < surplus; i += 1) {
    const victim = all[i];
    await objectStore.delete([victim.kind, victim.id]);
  }
  await tx.done;
}

/** List entries of *kind*, newest first. */
export async function listRecent(kind: RecentKind): Promise<RecentEntry[]> {
  const db = await getDb();
  const range = IDBKeyRange.bound(
    [kind, -Infinity],
    [kind, Number.MAX_SAFE_INTEGER],
  );
  const all = await db.getAllFromIndex(STORE, "by-kind-lastSeen", range);
  return all.sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Fetch a single entry by id; returns ``null`` if missing. */
export async function getRecent(
  kind: RecentKind,
  id: string,
): Promise<RecentEntry | null> {
  const db = await getDb();
  const rec = await db.get(STORE, [kind, id]);
  return rec ?? null;
}

export async function removeRecent(
  kind: RecentKind,
  id: string,
): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, [kind, id]);
}

export async function clearRecent(kind: RecentKind): Promise<void> {
  const db = await getDb();
  const range = IDBKeyRange.bound(
    [kind, -Infinity],
    [kind, Number.MAX_SAFE_INTEGER],
  );
  const all = await db.getAllFromIndex(STORE, "by-kind-lastSeen", range);
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const r of all) await store.delete([r.kind, r.id]);
  await tx.done;
}
