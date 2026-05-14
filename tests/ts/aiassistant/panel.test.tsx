import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { AIAssistantPanel } from "../../../src/components/AIAssistant/AIAssistantPanel";
import type { DataLabRuntime } from "../../../src/runtime/runtime";
import { saveApiKey, saveSettings } from "../../../src/aiassistant/settings";
import { _resetSecureStorageForTests } from "../../../src/aiassistant/secureStorage";

function fakeRuntime(over: Partial<DataLabRuntime> = {}): DataLabRuntime {
  return {
    listSignals: vi.fn(async () => []),
    listProcessings: vi.fn(async () => []),
    applyProcessing: vi.fn(async () => "new-id"),
    ...over,
  } as unknown as DataLabRuntime;
}

function mockOpenAI(
  responses: Array<{ content: string | null; toolCalls?: unknown[] }>,
) {
  let i = 0;
  return vi.fn(async (input: RequestInfo | URL) => {
    // The panel may hit ``/__dev__/openai-key`` on mount as a dev-mode
    // fallback. Return an empty key so the canned chat responses are
    // not accidentally consumed by that probe.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    if (url.includes("/__dev__/openai-key")) {
      return new Response(JSON.stringify({ apiKey: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const next = responses[i++];
    if (!next) throw new Error("ran out of canned responses");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: next.content,
              tool_calls: next.toolCalls?.length ? next.toolCalls : undefined,
            },
            finish_reason: next.toolCalls?.length ? "tool_calls" : "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

beforeEach(async () => {
  window.localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  _resetSecureStorageForTests();
  saveSettings({
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    model: "fake",
    temperature: 0,
  });
  // The API key is no longer persisted by ``saveSettings``; route it
  // through secure storage so the panel hydrates it on mount and skips
  // the dev-key probe (which would otherwise consume a canned fetch).
  await saveApiKey("test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AIAssistantPanel", () => {
  it("renders the empty-state hint", () => {
    render(<AIAssistantPanel runtime={fakeRuntime()} />);
    expect(
      screen.getByText(/Ask the assistant to inspect/i),
    ).toBeInTheDocument();
  });

  it("sends the user message and renders the assistant reply as markdown", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([{ content: "**Hello** there", toolCalls: [] }]),
    );
    render(<AIAssistantPanel runtime={fakeRuntime()} />);
    const textarea = screen.getByLabelText(/AI Assistant input/i);
    const user = userEvent.setup();
    await user.type(textarea, "hi");
    await user.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => {
      expect(screen.getByText("hi")).toBeInTheDocument();
      const bold = screen
        .getByTestId("ai-assistant-panel")
        .querySelector(".ai-markdown strong");
      expect(bold?.textContent).toBe("Hello");
    });
  });

  it("opens a confirmation dialog for mutating tool calls and honours rejection", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([
        {
          content: null,
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "apply_processing",
                arguments: JSON.stringify({
                  id: "s1",
                  processing_id: "fft",
                }),
              },
            },
          ],
        },
        { content: "ok", toolCalls: [] },
      ]),
    );
    const apply = vi.fn(async () => "new-id");
    render(
      <AIAssistantPanel runtime={fakeRuntime({ applyProcessing: apply })} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/AI Assistant input/i), "do it");
    await user.click(screen.getByRole("button", { name: /^Send$/ }));
    const reject = await screen.findByRole("button", { name: /Reject/i });
    fireEvent.click(reject);
    await waitFor(() => {
      expect(screen.getByText(/^ok$/)).toBeInTheDocument();
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it("approving the tool call invokes the runtime", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([
        {
          content: null,
          toolCalls: [
            {
              id: "c1",
              type: "function",
              function: {
                name: "apply_processing",
                arguments: JSON.stringify({
                  id: "s1",
                  processing_id: "fft",
                }),
              },
            },
          ],
        },
        { content: "done", toolCalls: [] },
      ]),
    );
    const apply = vi.fn(async () => "new-id");
    render(
      <AIAssistantPanel runtime={fakeRuntime({ applyProcessing: apply })} />,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/AI Assistant input/i), "go");
    await user.click(screen.getByRole("button", { name: /^Send$/ }));
    const approve = await screen.findByRole("button", { name: /Approve/i });
    fireEvent.click(approve);
    await waitFor(() => {
      expect(apply).toHaveBeenCalledWith("s1", "fft", undefined);
      expect(screen.getByText(/^done$/)).toBeInTheDocument();
    });
  });
});
