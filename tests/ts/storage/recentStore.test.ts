/**
 * Tests for the unified IndexedDB cache (``recentStore``).
 *
 * Uses ``fake-indexeddb`` to provide an in-memory IDB implementation
 * inside jsdom. Each test starts from a fresh database to avoid
 * cross-pollution.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
// Re-importing the polyfill is the simplest way to obtain a fresh
// in-memory database between tests — fake-indexeddb's
// ``deleteDatabase`` is unreliable under jsdom (it hangs when the
// connection is still open, even after ``db.close()``).
import { IDBFactory } from "fake-indexeddb";

import {
  _resetForTests,
  clearRecent,
  getRecent,
  listRecent,
  recordRecent,
  removeRecent,
  setMaxEntries,
} from "../../../src/storage/recentStore";

beforeEach(() => {
  _resetForTests();
  // Swap in a brand-new IDBFactory so the next ``openDB`` call sees an
  // empty database — no need to call ``deleteDatabase`` at all.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(() => {
  _resetForTests();
});

describe("recentStore", () => {
  it("starts empty", async () => {
    expect(await listRecent("macro")).toEqual([]);
    expect(await listRecent("notebook")).toEqual([]);
  });

  it("records and retrieves an entry", async () => {
    await recordRecent("macro", { id: "m1", title: "M", content: "x = 1" });
    const got = await getRecent("macro", "m1");
    expect(got?.title).toBe("M");
    expect(got?.content).toBe("x = 1");
    expect(got?.kind).toBe("macro");
    expect(typeof got?.lastSeen).toBe("number");
  });

  it("returns null for unknown id", async () => {
    expect(await getRecent("macro", "nope")).toBeNull();
  });

  it("update overwrites the previous entry (insert-or-update)", async () => {
    await recordRecent("macro", { id: "m1", title: "Old", content: "a" });
    await recordRecent("macro", { id: "m1", title: "New", content: "b" });
    const list = await listRecent("macro");
    expect(list.length).toBe(1);
    expect(list[0].title).toBe("New");
    expect(list[0].content).toBe("b");
  });

  it("isolates entries by kind", async () => {
    await recordRecent("macro", { id: "x", title: "Mac", content: "" });
    await recordRecent("notebook", { id: "x", title: "Nb", content: "" });
    expect((await listRecent("macro")).map((e) => e.title)).toEqual(["Mac"]);
    expect((await listRecent("notebook")).map((e) => e.title)).toEqual(["Nb"]);
  });

  it("lists newest first", async () => {
    await recordRecent("macro", { id: "a", title: "A", content: "" });
    // Force monotonic timestamps by spacing recordRecent calls.
    await new Promise((r) => setTimeout(r, 5));
    await recordRecent("macro", { id: "b", title: "B", content: "" });
    await new Promise((r) => setTimeout(r, 5));
    await recordRecent("macro", { id: "c", title: "C", content: "" });
    const titles = (await listRecent("macro")).map((e) => e.title);
    expect(titles).toEqual(["C", "B", "A"]);
  });

  it("evicts oldest entries beyond the cap (LRU)", async () => {
    setMaxEntries("macro", 2);
    await recordRecent("macro", { id: "1", title: "1", content: "" });
    await new Promise((r) => setTimeout(r, 5));
    await recordRecent("macro", { id: "2", title: "2", content: "" });
    await new Promise((r) => setTimeout(r, 5));
    await recordRecent("macro", { id: "3", title: "3", content: "" });
    const titles = (await listRecent("macro")).map((e) => e.title);
    expect(titles).toEqual(["3", "2"]);
    expect(await getRecent("macro", "1")).toBeNull();
  });

  it("eviction is per-kind", async () => {
    setMaxEntries("macro", 1);
    setMaxEntries("notebook", 1);
    await recordRecent("macro", { id: "m1", title: "M1", content: "" });
    await recordRecent("notebook", { id: "n1", title: "N1", content: "" });
    expect((await listRecent("macro")).length).toBe(1);
    expect((await listRecent("notebook")).length).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    await recordRecent("macro", { id: "m2", title: "M2", content: "" });
    expect((await listRecent("macro")).map((e) => e.title)).toEqual(["M2"]);
    // notebook side untouched
    expect((await listRecent("notebook")).map((e) => e.title)).toEqual(["N1"]);
  });

  it("removeRecent removes a single entry", async () => {
    await recordRecent("macro", { id: "a", title: "A", content: "" });
    await recordRecent("macro", { id: "b", title: "B", content: "" });
    await removeRecent("macro", "a");
    const ids = (await listRecent("macro")).map((e) => e.id);
    expect(ids).toEqual(["b"]);
  });

  it("clearRecent wipes one kind only", async () => {
    await recordRecent("macro", { id: "a", title: "A", content: "" });
    await recordRecent("notebook", { id: "x", title: "X", content: "" });
    await clearRecent("macro");
    expect(await listRecent("macro")).toEqual([]);
    expect((await listRecent("notebook")).length).toBe(1);
  });
});
