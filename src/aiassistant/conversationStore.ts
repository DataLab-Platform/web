/**
 * IndexedDB-backed persistent store for AI Assistant conversations.
 *
 * Mirrors :mod:`DataLab/datalab/aiassistant/conversation.py` (filesystem
 * JSON files keyed by conversation id) but uses IndexedDB since browsers
 * don't have a writable user-config directory.
 *
 * One object store keyed by conversation id, with a ``by-updated`` index
 * for newest-first listing and capacity pruning. The system prompt is
 * NEVER persisted — it lives in :class:`AIController` and is recomputed
 * on load to pick up any prompt change between sessions.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatMessage } from "./types";

/** Lightweight metadata for the History dialog (no message payload). */
export interface ConversationInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Full persisted conversation. ``messages`` excludes the system prompt. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

const DB_NAME = "datalab-web.aiassistant";
const DB_VERSION = 1;
const STORE = "conversations";

interface Schema extends DBSchema {
  [STORE]: {
    key: string;
    value: Conversation;
    indexes: { "by-updated": number };
  };
}

const DEFAULT_MAX = 200;
let _maxConversations = DEFAULT_MAX;

/** Override the cap (used by tests; future user setting). */
export function setMaxConversations(max: number): void {
  _maxConversations = Math.max(1, Math.floor(max));
}

export function getMaxConversations(): number {
  return _maxConversations;
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

/** Reset the in-memory connection (tests). */
export function _resetForTests(): void {
  _dbPromise = null;
  _maxConversations = DEFAULT_MAX;
}

/** Build a unique time-sortable conversation identifier. */
export function makeConversationId(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, "")
    .slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${stamp}-${rnd}`;
}

/** Derive a short conversation title from its first user message. */
export function deriveTitle(text: string, maxLen = 60): string {
  const collapsed = String(text).replace(/\s+/g, " ").trim();
  if (!collapsed) return "(empty)";
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 1) + "…";
}

/** Build an empty conversation with a fresh id. */
export function newConversation(): Conversation {
  const now = Date.now();
  return {
    id: makeConversationId(),
    title: "",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/** Persist *conv* (insert-or-replace), then prune oldest entries. */
export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDb();
  conv.updatedAt = Date.now();
  await db.put(STORE, conv);
  await _pruneIfNeeded(db);
}

async function _pruneIfNeeded(db: IDBPDatabase<Schema>): Promise<void> {
  const count = await db.count(STORE);
  const surplus = count - _maxConversations;
  if (surplus <= 0) return;
  // Oldest first via the by-updated index.
  const all = await db.getAllFromIndex(STORE, "by-updated");
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (let i = 0; i < surplus; i += 1) {
    await store.delete(all[i].id);
  }
  await tx.done;
}

/** Return conversation metadata sorted from most-recent to oldest. */
export async function listConversations(): Promise<ConversationInfo[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex(STORE, "by-updated");
  return all
    .map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadConversation(
  id: string,
): Promise<Conversation | null> {
  const db = await getDb();
  const rec = await db.get(STORE, id);
  return rec ?? null;
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function clearConversations(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}
