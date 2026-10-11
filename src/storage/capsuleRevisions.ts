/**
 * Flat list of the capsule revisions seen in this browser (IndexedDB).
 *
 * Each exported or inspected capsule is kept by its manifest fingerprint with
 * its manifest, so that any two revisions can be compared later without the
 * files. The list is flat: a revision names its parent by fingerprint and no
 * tree is built. It is a local convenience, never a source of truth: the
 * capsule files are.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface CapsuleRevision {
  /** Manifest fingerprint (``sha256:…``). */
  fingerprint: string;
  name: string;
  /** Fingerprint of the parent revision, or null. */
  revisionOf: string | null;
  datePublished: string;
  /** How the revision reached this browser. */
  source: "exported" | "inspected" | "registry";
  /** When it was recorded here (ms since epoch). */
  recordedAt: number;
  manifest: Record<string, unknown>;
}

const DB_NAME = "datalab-web.capsules";
const DB_VERSION = 1;
const STORE = "revisions";
/** Largest number of revisions kept; the oldest are dropped first. */
export const MAX_REVISIONS = 100;

interface Schema extends DBSchema {
  [STORE]: {
    key: string;
    value: CapsuleRevision;
    indexes: { "by-recordedAt": number };
  };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: "fingerprint" });
        store.createIndex("by-recordedAt", "recordedAt");
      },
    });
  }
  return dbPromise;
}

/** Reset the cached connection (tests delete the database between cases). */
export function _resetForTests(): void {
  dbPromise = null;
}

/** Record a revision (an existing one keeps its first ``source``). */
export async function recordRevision(
  revision: Omit<CapsuleRevision, "recordedAt">,
): Promise<void> {
  const db = await getDb();
  const existing = await db.get(STORE, revision.fingerprint);
  await db.put(STORE, {
    ...revision,
    source: existing?.source ?? revision.source,
    recordedAt: Date.now(),
  });
  const keys = await db.getAllKeysFromIndex(STORE, "by-recordedAt");
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_REVISIONS))) {
    await db.delete(STORE, key);
  }
}

/** Return the revisions, most recently recorded first. */
export async function listRevisions(): Promise<CapsuleRevision[]> {
  const db = await getDb();
  return (await db.getAllFromIndex(STORE, "by-recordedAt")).reverse();
}

/** Forget one revision. */
export async function deleteRevision(fingerprint: string): Promise<void> {
  await (await getDb()).delete(STORE, fingerprint);
}
