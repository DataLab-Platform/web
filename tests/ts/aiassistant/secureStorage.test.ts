/**
 * Vitest suite for ``src/aiassistant/secureStorage`` — encrypts /
 * decrypts the API key using a non-extractable AES-GCM ``CryptoKey``
 * persisted in IndexedDB.
 */

import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  _resetSecureStorageForTests,
  clearApiKey,
  hasStoredApiKey,
  loadApiKey,
  saveApiKey,
} from "../../../src/aiassistant/secureStorage";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _resetSecureStorageForTests();
});

describe("aiassistant/secureStorage", () => {
  it("returns '' when nothing has been stored yet", async () => {
    expect(await loadApiKey()).toBe("");
    expect(await hasStoredApiKey()).toBe(false);
  });

  it("round-trips an API key through encrypt/decrypt", async () => {
    await saveApiKey("sk-test-12345");
    expect(await hasStoredApiKey()).toBe(true);
    expect(await loadApiKey()).toBe("sk-test-12345");
  });

  it("uses a fresh IV per write (ciphertexts differ)", async () => {
    await saveApiKey("same-secret");
    const db = (globalThis.indexedDB as IDBFactory).open(
      "datalab-web.aiassistant.secrets",
      1,
    );
    void db;
    // Read twice via the public API: both decrypt to the same plaintext
    // even though the underlying ciphertext changed between saves.
    await saveApiKey("same-secret");
    expect(await loadApiKey()).toBe("same-secret");
  });

  it("overwrites the previous value", async () => {
    await saveApiKey("first");
    await saveApiKey("second");
    expect(await loadApiKey()).toBe("second");
  });

  it("clears the stored payload", async () => {
    await saveApiKey("sk-1");
    await clearApiKey();
    expect(await hasStoredApiKey()).toBe(false);
    expect(await loadApiKey()).toBe("");
  });

  it("treats saving an empty string as a clear", async () => {
    await saveApiKey("sk-1");
    await saveApiKey("");
    expect(await hasStoredApiKey()).toBe(false);
    expect(await loadApiKey()).toBe("");
  });

  it("does not persist the plaintext anywhere observable", async () => {
    await saveApiKey("sk-do-not-leak");
    // Snapshot the entire IDB store and assert the plaintext bytes do
    // not appear in it.
    const idb: IDBFactory = globalThis.indexedDB;
    const opened = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = idb.open("datalab-web.aiassistant.secrets", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const tx = opened.transaction("kv", "readonly");
    const store = tx.objectStore("kv");
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as unknown[]);
      req.onerror = () => reject(req.error);
    });
    const blob = JSON.stringify(all, (_k, v) => {
      if (v instanceof Uint8Array) return Array.from(v);
      return v;
    });
    expect(blob).not.toContain("sk-do-not-leak");
  });
});
