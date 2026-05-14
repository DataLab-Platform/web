/**
 * Tests for the AI Assistant conversation store (IndexedDB-backed).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  _resetForTests,
  clearConversations,
  deleteConversation,
  deriveTitle,
  listConversations,
  loadConversation,
  newConversation,
  renameConversation,
  saveConversation,
  setMaxConversations,
} from "../../../src/aiassistant/conversationStore";

beforeEach(() => {
  _resetForTests();
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});
afterEach(() => {
  _resetForTests();
});

describe("conversationStore", () => {
  it("starts empty", async () => {
    expect(await listConversations()).toEqual([]);
  });

  it("persists and reloads a conversation", async () => {
    const conv = newConversation();
    conv.title = "Hello";
    conv.messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    await saveConversation(conv);

    const reloaded = await loadConversation(conv.id);
    expect(reloaded?.title).toBe("Hello");
    expect(reloaded?.messages).toHaveLength(2);
    expect(reloaded?.messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("lists conversations newest-first via ``updatedAt``", async () => {
    const a = newConversation();
    a.title = "A";
    await saveConversation(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = newConversation();
    b.title = "B";
    await saveConversation(b);
    await new Promise((r) => setTimeout(r, 5));
    const c = newConversation();
    c.title = "C";
    await saveConversation(c);

    const titles = (await listConversations()).map((info) => info.title);
    expect(titles).toEqual(["C", "B", "A"]);
  });

  it("deletes a conversation", async () => {
    const conv = newConversation();
    await saveConversation(conv);
    expect(await loadConversation(conv.id)).not.toBeNull();
    await deleteConversation(conv.id);
    expect(await loadConversation(conv.id)).toBeNull();
  });

  it("prunes oldest entries past the cap", async () => {
    setMaxConversations(2);
    const a = newConversation();
    a.title = "A";
    await saveConversation(a);
    await new Promise((r) => setTimeout(r, 5));
    const b = newConversation();
    b.title = "B";
    await saveConversation(b);
    await new Promise((r) => setTimeout(r, 5));
    const c = newConversation();
    c.title = "C";
    await saveConversation(c);

    const titles = (await listConversations()).map((info) => info.title);
    expect(titles).toEqual(["C", "B"]);
    expect(await loadConversation(a.id)).toBeNull();
  });

  it("clears every conversation", async () => {
    await saveConversation(newConversation());
    await saveConversation(newConversation());
    await clearConversations();
    expect(await listConversations()).toEqual([]);
  });

  it("derives a short title from the first user message", () => {
    expect(deriveTitle("  hello   world  ")).toBe("hello world");
    expect(deriveTitle("")).toBe("(empty)");
    const long = "x".repeat(100);
    const t = deriveTitle(long, 20);
    expect(t.length).toBe(20);
    expect(t.endsWith("…")).toBe(true);
  });

  it("renameConversation updates the title without bumping updatedAt", async () => {
    const conv = newConversation();
    conv.title = "Original";
    conv.messages = [{ role: "user", content: "hi" }];
    await saveConversation(conv);
    const before = (await loadConversation(conv.id))!.updatedAt;
    // Wait one ms so a save-style bump would be detectable.
    await new Promise((resolve) => setTimeout(resolve, 2));
    await renameConversation(conv.id, "Renamed");
    const after = await loadConversation(conv.id);
    expect(after?.title).toBe("Renamed");
    expect(after?.updatedAt).toBe(before);
    // Persists the body untouched.
    expect(after?.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("renameConversation no-ops on unknown ids", async () => {
    await renameConversation("nope-does-not-exist", "x");
    expect(await listConversations()).toEqual([]);
  });

  it("conversation usage round-trips through save/load", async () => {
    const conv = newConversation();
    conv.title = "U";
    conv.messages = [{ role: "user", content: "hi" }];
    conv.usage = { promptTokens: 11, completionTokens: 22, totalTokens: 33 };
    await saveConversation(conv);
    const reloaded = await loadConversation(conv.id);
    expect(reloaded?.usage).toEqual({
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
    });
  });
});
