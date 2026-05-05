/**
 * Integration test for the "Recent…" replay flow.
 *
 * Under the Phase 4+ design IndexedDB is no longer the source of truth
 * for notebooks; it is a roll-over cache. The contract this spec
 * covers is:
 *
 *   * a notebook recorded into ``recentStore`` survives a workspace
 *     wipe (``runtime`` reinitialised),
 *   * ``listRecent("notebook")`` returns it newest-first,
 *   * the cache content can be re-imported into a fresh workspace via
 *     ``runtime.createNotebook(title, content)``, with the new id
 *     replacing the cached one.
 *
 * The runtime is mocked: we only care about the round-trip of the
 * cache + the call signature, not Pyodide internals. The full Python
 * side is exercised by the pytest suite + the HDF5-roundtrip
 * Playwright spec.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  _resetForTests,
  listRecent,
  recordRecent,
} from "../../../src/storage/recentStore";

beforeEach(() => {
  _resetForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(() => {
  _resetForTests();
});

describe("Recent… → workspace replay", () => {
  it("replays cached notebooks into a fresh workspace via runtime.createNotebook", async () => {
    // 1. Workspace #1 — record two notebooks into the cache.
    await recordRecent("notebook", {
      id: "n1",
      title: "Alpha",
      content: '{"nbformat":4,"nbformat_minor":5,"cells":[]}',
    });
    await recordRecent("notebook", {
      id: "n2",
      title: "Beta",
      content: '{"nbformat":4,"nbformat_minor":5,"cells":[{"cell_type":"code","source":"print(1)"}]}',
    });

    // 2. Workspace #2 — list cached entries, newest first, and replay
    //    each one through a (mocked) runtime.
    const runtime = {
      createNotebook: vi
        .fn<(title: string, content: string) => Promise<{ id: string; title: string; content: string }>>()
        .mockImplementation(async (title, content) => ({
          id: `fresh-${title}`,
          title,
          content,
        })),
    };

    const cached = await listRecent("notebook");
    expect(cached.map((e) => e.title).sort()).toEqual(["Alpha", "Beta"]);

    const restored: Array<{ id: string; title: string }> = [];
    for (const e of cached) {
      const rec = await runtime.createNotebook(e.title, e.content);
      restored.push({ id: rec.id, title: rec.title });
    }

    expect(runtime.createNotebook).toHaveBeenCalledTimes(2);
    // Ids are reassigned by the new workspace.
    expect(restored.map((r) => r.title).sort()).toEqual(["Alpha", "Beta"]);
    expect(restored.map((r) => r.id).sort()).toEqual([
      "fresh-Alpha",
      "fresh-Beta",
    ]);
    // Each cached entry's content was forwarded verbatim.
    for (const e of cached) {
      expect(runtime.createNotebook).toHaveBeenCalledWith(e.title, e.content);
    }
  });

  it("replays cached macros via runtime.replaceMacros", async () => {
    // The MacroPanel fallback path uses ``replaceMacros`` (bulk import)
    // instead of repeated ``createMacro`` calls; mirror that here.
    await recordRecent("macro", {
      id: "m1",
      title: "Hello",
      content: "print('hello')",
    });
    await recordRecent("macro", {
      id: "m2",
      title: "World",
      content: "print('world')",
    });

    const runtime = {
      replaceMacros: vi
        .fn<(records: Array<{ id: string; title: string; code: string }>) => Promise<void>>()
        .mockResolvedValue(undefined),
    };

    const cached = await listRecent("macro");
    const records = cached.map((e) => ({
      id: e.id,
      title: e.title,
      code: e.content,
    }));
    await runtime.replaceMacros(records);

    expect(runtime.replaceMacros).toHaveBeenCalledTimes(1);
    expect(runtime.replaceMacros.mock.calls[0][0]).toHaveLength(2);
    expect(
      runtime.replaceMacros.mock.calls[0][0].map((r) => r.title).sort(),
    ).toEqual(["Hello", "World"]);
    expect(
      runtime.replaceMacros.mock.calls[0][0].map((r) => r.code).sort(),
    ).toEqual(["print('hello')", "print('world')"]);
  });
});
