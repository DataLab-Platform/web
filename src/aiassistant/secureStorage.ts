/**
 * Encrypted at-rest storage for the AI Assistant API key.
 *
 * Stores the API key in IndexedDB encrypted with AES-GCM-256. The
 * wrapping key is a Web Crypto :class:`CryptoKey` generated with
 * ``extractable: false`` and persisted in the same database via
 * structured cloning — JS code can therefore call ``encrypt``/
 * ``decrypt`` but can never read the raw key bytes back.
 *
 * Threat model (honest):
 *   - ✅ Protects against passive disk reads: backups, profile sync
 *     (OneDrive, ...), malware that exfiltrates ``localStorage`` files,
 *     browser extensions whose permissions only cover ``localStorage``.
 *   - ✅ Hides the key from a casual look at DevTools → Application.
 *   - ❌ Does NOT protect against an attacker running JS in this origin
 *     (XSS, malicious extension with full host permissions, compromised
 *     dependency). They can call :func:`loadApiKey` themselves.
 *
 * No first-party backend is required; this is a pure-browser solution
 * that survives sessions without prompting the user.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "datalab-web.aiassistant.secrets";
const DB_VERSION = 1;
const STORE = "kv";

/** Stable IDB record id for the (non-extractable) AES-GCM wrapping key. */
const WRAP_KEY_ID = "wrap-key";
/** Stable IDB record id for the encrypted API-key payload. */
const API_KEY_ID = "api-key";

/** Encrypted payload shape. ``iv`` is the 12-byte AES-GCM nonce, regen
 *  on every write. The explicit ``ArrayBuffer`` backing is required by
 *  TypeScript ≥ 5.7's narrower ``BufferSource`` definition (which now
 *  excludes ``SharedArrayBuffer``-backed views). */
interface EncryptedPayload {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: Uint8Array<ArrayBuffer>;
}

interface SecretsRecord {
  id: string;
  /** Present when ``id === WRAP_KEY_ID``. */
  key?: CryptoKey;
  /** Present when ``id === API_KEY_ID``. */
  payload?: EncryptedPayload;
}

interface Schema extends DBSchema {
  [STORE]: {
    key: string;
    value: SecretsRecord;
  };
}

let _dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!_dbPromise) {
    _dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      },
    });
  }
  return _dbPromise;
}

/** Reset the in-memory connection (tests). */
export function _resetSecureStorageForTests(): void {
  _dbPromise = null;
}

function getSubtle(): SubtleCrypto | null {
  // ``crypto.subtle`` is only available in secure contexts (https / localhost).
  // When unavailable we degrade to a no-op so the rest of the app keeps
  // working (the API key just won't persist).
  try {
    return globalThis.crypto?.subtle ?? null;
  } catch {
    return null;
  }
}

/** Lazily fetch — or generate and persist — the non-extractable wrapping
 *  key. Returns ``null`` when Web Crypto is unavailable. */
async function getOrCreateWrapKey(): Promise<CryptoKey | null> {
  const subtle = getSubtle();
  if (!subtle) return null;
  const db = await getDb();
  const existing = await db.get(STORE, WRAP_KEY_ID);
  if (existing?.key) return existing.key;
  const key = await subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    /* extractable */ false,
    ["encrypt", "decrypt"],
  );
  await db.put(STORE, { id: WRAP_KEY_ID, key });
  return key;
}

/** Persist *plaintext* under :data:`API_KEY_ID`, replacing any previous
 *  value. An empty string clears the stored key. */
export async function saveApiKey(plaintext: string): Promise<void> {
  if (!plaintext) {
    await clearApiKey();
    return;
  }
  const subtle = getSubtle();
  const wrapKey = await getOrCreateWrapKey();
  if (!subtle || !wrapKey) return;
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const cipher = await subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, data);
  const db = await getDb();
  await db.put(STORE, {
    id: API_KEY_ID,
    payload: { iv, ciphertext: new Uint8Array(cipher) },
  });
}

/** Decrypt and return the stored API key, or ``""`` when none is set or
 *  decryption fails (corrupted record / Web Crypto unavailable). */
export async function loadApiKey(): Promise<string> {
  const subtle = getSubtle();
  if (!subtle) return "";
  try {
    const db = await getDb();
    const rec = await db.get(STORE, API_KEY_ID);
    if (!rec?.payload) return "";
    const wrapKey = await getOrCreateWrapKey();
    if (!wrapKey) return "";
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: rec.payload.iv },
      wrapKey,
      rec.payload.ciphertext,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return "";
  }
}

/** Remove the encrypted API-key payload (the wrapping key is kept so a
 *  subsequent :func:`saveApiKey` reuses the same origin-bound key). */
export async function clearApiKey(): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE, API_KEY_ID);
  } catch {
    /* ignore */
  }
}

/** True when an encrypted API-key payload exists in storage (without
 *  attempting decryption). */
export async function hasStoredApiKey(): Promise<boolean> {
  try {
    const db = await getDb();
    const rec = await db.get(STORE, API_KEY_ID);
    return Boolean(rec?.payload);
  } catch {
    return false;
  }
}
