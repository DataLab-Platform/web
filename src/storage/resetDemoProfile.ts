import { t } from "../i18n/translate";
import { DEMO_STORAGE_PREFIX } from "./profile";

const owned = (name: string) => name.startsWith(DEMO_STORAGE_PREFIX);

function clearKeys(storage: Storage): void {
  for (let i = storage.length - 1; i >= 0; --i) {
    const name = storage.key(i);
    if (name && owned(name)) storage.removeItem(name);
  }
}

/** Called from a fresh document (no runtime, workers or DB connections).
 * The caller must first ask the user to close other demo tabs. */
export async function resetDemoProfile(): Promise<void> {
  if (import.meta.env.VITE_WASM64_DEMO !== "1")
    throw new Error("Not a demo build");

  const databases = await indexedDB.databases();
  for (const { name } of databases) {
    if (!name || !owned(name)) continue;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error(t("Close other demo tabs and retry.")));
    });
  }
  if ("caches" in globalThis) {
    for (const name of await caches.keys()) {
      if (owned(name)) await caches.delete(name);
    }
  }
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const entries = root as FileSystemDirectoryHandle & {
      keys(): AsyncIterableIterator<string>;
    };
    for await (const name of entries.keys()) {
      if (owned(name)) await root.removeEntry(name, { recursive: true });
    }
  }
  clearKeys(sessionStorage);
  clearKeys(localStorage);
}
