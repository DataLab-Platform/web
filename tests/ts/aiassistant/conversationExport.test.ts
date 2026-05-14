/**
 * Tests for the conversation Markdown export helpers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  conversationToMarkdown,
  downloadMarkdown,
  sanitizeFilename,
} from "../../../src/aiassistant/conversationExport";
import type { Conversation } from "../../../src/aiassistant/conversationStore";

const FIXED_CREATED = Date.UTC(2025, 0, 1, 12, 0, 0);
const FIXED_UPDATED = Date.UTC(2025, 0, 1, 12, 5, 0);

function makeConv(messages: Conversation["messages"]): Conversation {
  return {
    id: "test-id",
    title: "Test conversation",
    createdAt: FIXED_CREATED,
    updatedAt: FIXED_UPDATED,
    messages,
    usage: { promptTokens: 40, completionTokens: 10, totalTokens: 50 },
  };
}

describe("conversationToMarkdown", () => {
  it("renders a multi-turn conversation including tool calls and results", () => {
    const md = conversationToMarkdown(
      makeConv([
        { role: "user", content: "list signals please" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "list_signals", arguments: "{}" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "c1",
          name: "list_signals",
          content: '{"ok":true,"result":[]}',
        },
        { role: "assistant", content: "There are no signals yet." },
      ]),
    );
    expect(md).toMatchSnapshot();
  });

  it("renders multimodal user content with an image placeholder", () => {
    const md = conversationToMarkdown(
      makeConv([
        {
          role: "user",
          content: [
            { type: "text", text: "what is in this image?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,AAAA" },
            },
          ],
        },
        { role: "assistant", content: "A plot." },
      ]),
    );
    expect(md).toContain("## You");
    expect(md).toContain("what is in this image?");
    expect(md).toContain("> _(image attached)_");
    expect(md).toContain("## Assistant");
  });

  it("falls back to (untitled conversation) when title is empty", () => {
    const conv = makeConv([{ role: "user", content: "hi" }]);
    conv.title = "";
    const md = conversationToMarkdown(conv);
    expect(md.startsWith("# (untitled conversation)")).toBe(true);
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["plain", "plain"],
    ["with / slash", "with slash"],
    ["a:b*c?d|e", "a b c d e"],
    ["", "conversation"],
    ["   ", "conversation"],
    ["multi   spaces", "multi spaces"],
  ])("sanitizes %s -> %s", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it("clamps to maxLen", () => {
    expect(sanitizeFilename("x".repeat(200), 10)).toBe("xxxxxxxxxx");
  });
});

describe("downloadMarkdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL, triggers a click, and revokes the URL", () => {
    // jsdom does not implement these by default — install no-op stubs
    // before spying so ``vi.spyOn`` can monkey-patch them.
    if (typeof URL.createObjectURL !== "function") {
      (URL as { createObjectURL: (b: Blob) => string }).createObjectURL =
        () => "";
    }
    if (typeof URL.revokeObjectURL !== "function") {
      (URL as { revokeObjectURL: (s: string) => void }).revokeObjectURL =
        () => {};
    }
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockReturnValue();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    downloadMarkdown("hello.md", "# hi\n");
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith("blob:fake");
  });
});
