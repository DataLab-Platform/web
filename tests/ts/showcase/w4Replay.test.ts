/**
 * Tests for the replayed AI Assistant session of the W4 showcase scenario:
 * the scripted provider and the guard restoring the user's AI state.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import {
  _resetForTests,
  getMaxConversations,
  listConversations,
  newConversation,
  saveConversation,
} from "../../../src/aiassistant/conversationStore";
import { DEFAULT_SETTINGS } from "../../../src/aiassistant/settings";
import type { ChatMessage } from "../../../src/aiassistant/types";
import { PauseController } from "../../../src/showcase/pause";
import {
  AIAssistantStateGuard,
  lastToolOutput,
  lastToolResult,
  ReplayProvider,
} from "../../../src/showcase/scenarios/w4_replay";

const timing = { speed: 0, check: true, pause: new PauseController() };

function toolMessage(result: unknown): ChatMessage {
  return {
    role: "tool",
    tool_call_id: "call-1",
    name: "create_and_run_macro",
    content: JSON.stringify(result),
  };
}

describe("ReplayProvider", () => {
  it("replays the scripted turns, then stops", async () => {
    const provider = new ReplayProvider(
      [
        {
          content: "Running a macro",
          toolCalls: [
            { name: "create_and_run_macro", arguments: { code: "x" } },
          ],
        },
        { content: (messages) => `seen ${lastToolOutput(messages)}` },
      ],
      timing,
    );
    const deltas: string[] = [];
    const first = await provider.chatCompletions(DEFAULT_SETTINGS, [], [], {
      onDelta: (delta) => deltas.push(delta.contentDelta ?? ""),
    });
    expect(first.content).toBe("Running a macro");
    expect(deltas.join("")).toBe("Running a macro");
    expect(first.toolCalls).toHaveLength(1);
    expect(first.toolCalls[0].function.name).toBe("create_and_run_macro");
    expect(JSON.parse(first.toolCalls[0].function.arguments)).toEqual({
      code: "x",
    });
    const second = await provider.chatCompletions(
      DEFAULT_SETTINGS,
      [toolMessage({ ok: true, result: { stdout: "FWHM = 3.77\n" } })],
      [],
    );
    expect(second.content).toBe("seen FWHM = 3.77\n");
    expect(provider.answered).toBe(2);
    const extra = await provider.chatCompletions(DEFAULT_SETTINGS, [], []);
    expect(extra).toEqual({ content: "", toolCalls: [] });
  });

  it("builds tool calls from the conversation", async () => {
    const provider = new ReplayProvider(
      [
        {
          toolCalls: (messages) => [
            {
              name: "apply_processing",
              arguments: { id: (lastToolResult(messages) as string[])[0] },
            },
          ],
        },
      ],
      timing,
    );
    const response = await provider.chatCompletions(
      DEFAULT_SETTINGS,
      [toolMessage({ ok: true, result: ["sig-1"] })],
      [],
    );
    expect(response.content).toBeNull();
    expect(JSON.parse(response.toolCalls[0].function.arguments)).toEqual({
      id: "sig-1",
    });
  });

  it("stops at once when the assistant is stopped", async () => {
    const provider = new ReplayProvider([{ content: "never" }], timing);
    const controller = new AbortController();
    controller.abort();
    await expect(
      provider.chatCompletions(DEFAULT_SETTINGS, [], [], {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("lastToolOutput", () => {
  it("reads the stdout of the last tool result only when it succeeded", () => {
    expect(lastToolOutput([])).toBe("");
    expect(
      lastToolOutput([
        toolMessage({ ok: true, result: { stdout: "old" } }),
        toolMessage({ ok: true, result: { stdout: "new" } }),
      ]),
    ).toBe("new");
    expect(lastToolOutput([toolMessage({ ok: false, error: "boom" })])).toBe(
      "",
    );
  });
});

describe("AIAssistantStateGuard", () => {
  beforeEach(() => {
    _resetForTests();
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    window.localStorage.clear();
  });

  afterEach(() => {
    _resetForTests();
    window.localStorage.clear();
  });

  it("restores the user's AI Assistant state exactly", async () => {
    const settings = '{"provider":"openai","model":"my-model"}';
    window.localStorage.setItem("datalab-web.aiassistant.settings", settings);
    window.localStorage.setItem("datalab-web.aiPanelVisible", "true");
    const mine = newConversation();
    mine.messages = [{ role: "user", content: "mine" }];
    await saveConversation(mine);
    const cap = getMaxConversations();

    const guard = await AIAssistantStateGuard.capture();
    expect(guard.panelVisible).toBe(true);
    expect(guard.panelCollapsed).toBe(false);
    expect(guard.hasConversations).toBe(true);
    expect(getMaxConversations()).toBeGreaterThan(cap);

    // What the replayed session leaves behind.
    window.localStorage.setItem("datalab-web.aiPanelVisible", "false");
    window.localStorage.setItem("datalab-web.aiPanelCollapsed", "false");
    window.localStorage.setItem(
      "datalab-web.aiassistant.inputHistory",
      '["demo"]',
    );
    const demo = newConversation();
    demo.messages = [{ role: "user", content: "demo" }];
    await saveConversation(demo);
    expect(await guard.newConversations()).toEqual([demo.id]);

    await guard.restore();
    expect(
      window.localStorage.getItem("datalab-web.aiassistant.settings"),
    ).toBe(settings);
    expect(window.localStorage.getItem("datalab-web.aiPanelVisible")).toBe(
      "true",
    );
    expect(window.localStorage.getItem("datalab-web.aiPanelCollapsed")).toBe(
      null,
    );
    expect(
      window.localStorage.getItem("datalab-web.aiassistant.inputHistory"),
    ).toBe(null);
    expect((await listConversations()).map((c) => c.id)).toEqual([mine.id]);
    expect(getMaxConversations()).toBe(cap);
  });
});
