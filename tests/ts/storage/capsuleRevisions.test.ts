/**
 * Tests for the flat list of capsule revisions (``capsuleRevisions``).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  MAX_REVISIONS,
  _resetForTests,
  deleteRevision,
  listRevisions,
  recordRevision,
} from "../../../src/storage/capsuleRevisions";

function revision(fingerprint: string, revisionOf: string | null = null) {
  return {
    fingerprint,
    name: `Capsule ${fingerprint}`,
    revisionOf,
    datePublished: "2026-10-11T00:00:00Z",
    source: "inspected" as const,
    manifest: { "@graph": [{ "@id": "./" }] },
  };
}

beforeEach(() => {
  _resetForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  // Fake ``Date`` only: fake-indexeddb schedules its work on real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1000);
});
afterEach(() => {
  vi.useRealTimers();
  _resetForTests();
});

describe("capsuleRevisions", () => {
  it("lists revisions most recent first, parents by fingerprint", async () => {
    await recordRevision({ ...revision("sha256:a"), source: "exported" });
    vi.setSystemTime(2000);
    await recordRevision(revision("sha256:b", "sha256:a"));
    const list = await listRevisions();
    expect(list.map((r) => r.fingerprint)).toEqual(["sha256:b", "sha256:a"]);
    expect(list[0].revisionOf).toBe("sha256:a");
    expect(list[0].manifest).toEqual({ "@graph": [{ "@id": "./" }] });
  });

  it("keeps the first source of a revision seen again", async () => {
    await recordRevision({ ...revision("sha256:a"), source: "exported" });
    vi.setSystemTime(2000);
    await recordRevision(revision("sha256:a"));
    const [only] = await listRevisions();
    expect(only.source).toBe("exported");
    expect(only.recordedAt).toBe(2000);
  });

  it("drops the oldest revisions beyond the cap, and deletes on request", async () => {
    for (let i = 0; i <= MAX_REVISIONS; i++) {
      vi.setSystemTime(1000 + i);
      await recordRevision(revision(`sha256:${i}`));
    }
    let list = await listRevisions();
    expect(list).toHaveLength(MAX_REVISIONS);
    expect(list.some((r) => r.fingerprint === "sha256:0")).toBe(false);
    await deleteRevision(`sha256:${MAX_REVISIONS}`);
    list = await listRevisions();
    expect(list[0].fingerprint).toBe(`sha256:${MAX_REVISIONS - 1}`);
  });
});
