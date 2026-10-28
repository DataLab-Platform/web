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
import { ThemeProvider } from "../../../src/utils/theme";
import {
  _resetForTests as _resetConversationsForTests,
  newConversation,
  saveConversation,
} from "../../../src/aiassistant/conversationStore";

/** ``onSaveMacro`` for tests that do not exercise macro saving. */
const noSave = vi.fn(async () => undefined);

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
  // Reopen the conversation store on the fresh IndexedDB, so a test never
  // restores the conversation persisted by the previous one.
  _resetConversationsForTests();
  saveSettings({
    provider: "openai",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "test-key",
    model: "fake",
    temperature: 0,
    maxHistoryMessages: 0,
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
    render(<AIAssistantPanel runtime={fakeRuntime()} onSaveMacro={noSave} />);
    expect(
      screen.getByText(/Ask the assistant to inspect/i),
    ).toBeInTheDocument();
  });

  it("sends the user message and renders the assistant reply as markdown", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([{ content: "**Hello** there", toolCalls: [] }]),
    );
    render(<AIAssistantPanel runtime={fakeRuntime()} onSaveMacro={noSave} />);
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
      <AIAssistantPanel
        runtime={fakeRuntime({ applyProcessing: apply })}
        onSaveMacro={noSave}
      />,
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
      <AIAssistantPanel
        runtime={fakeRuntime({ applyProcessing: apply })}
        onSaveMacro={noSave}
      />,
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

const MACRO_CODE = "import numpy as np\nprint(np.pi)";

/** Canned turn requesting ``create_and_run_macro``. */
function macroToolTurn(args: Record<string, unknown>, id = "m1") {
  return {
    content: null,
    toolCalls: [
      {
        id,
        type: "function",
        function: {
          name: "create_and_run_macro",
          arguments: JSON.stringify(args),
        },
      },
    ],
  };
}

function lintOk() {
  return vi.fn(async () => ({
    ok: true,
    syntax_error: null,
    unknown_methods: [],
    missing_await: [],
    proxy_calls: [],
  }));
}

async function send(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/AI Assistant input/i), text);
  await user.click(screen.getByRole("button", { name: /^Send$/ }));
}

describe("AIAssistantPanel — Save to Macros", () => {
  it("saves a macro offered without running it through onSaveMacro", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([
        macroToolTurn({ code: MACRO_CODE, name: "Print pi", autorun: false }),
        { content: "Here is the macro.", toolCalls: [] },
      ]),
    );
    const runMacroCode = vi.fn();
    const onSaveMacro = vi.fn(async () => undefined);
    render(
      <AIAssistantPanel
        runtime={fakeRuntime({ runMacroCode, lintMacro: lintOk() })}
        onSaveMacro={onSaveMacro}
      />,
      { wrapper: ThemeProvider },
    );
    await send("Write a macro printing pi");
    // The approval dialog states that nothing will be executed.
    expect(
      await screen.findByText(/This macro will not be executed/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    const save = await screen.findByRole("button", {
      name: /Save to Macros/i,
    });
    fireEvent.click(save);
    await waitFor(() => {
      expect(onSaveMacro).toHaveBeenCalledWith("Print pi", MACRO_CODE);
      expect(screen.getByRole("button", { name: /Saved ✓/ })).toBeDisabled();
    });
    expect(runMacroCode).not.toHaveBeenCalled();
  });

  it("offers Save to Macros again in a conversation reopened from the history", async () => {
    const conv = newConversation();
    conv.title = "Super-Gaussian";
    conv.messages = [
      { role: "user", content: "Generate a super-Gaussian" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "m1",
            type: "function",
            function: {
              name: "create_and_run_macro",
              arguments: JSON.stringify({ code: MACRO_CODE }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "m1",
        name: "create_and_run_macro",
        content: JSON.stringify({
          ok: true,
          result: {
            stdout: "3.14\n",
            stderr: "",
            status: "ok",
            _macro: { name: "Generate super-Gaussian", code: MACRO_CODE },
          },
        }),
      },
      { role: "assistant", content: "Done." },
    ];
    await saveConversation(conv);
    const onSaveMacro = vi.fn(async () => undefined);
    render(
      <AIAssistantPanel runtime={fakeRuntime()} onSaveMacro={onSaveMacro} />,
      { wrapper: ThemeProvider },
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Save to Macros/i }),
    );
    await waitFor(() =>
      expect(onSaveMacro).toHaveBeenCalledWith(
        "Generate super-Gaussian",
        MACRO_CODE,
      ),
    );
  });

  it("reports a failed save and lets the user retry", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([
        macroToolTurn({ code: MACRO_CODE, name: "Print pi", autorun: false }),
        { content: "ok", toolCalls: [] },
      ]),
    );
    const onSaveMacro = vi
      .fn<(title: string, code: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("panel not ready"))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AIAssistantPanel
        runtime={fakeRuntime({ lintMacro: lintOk() })}
        onSaveMacro={onSaveMacro}
      />,
      { wrapper: ThemeProvider },
    );
    await send("Write it");
    fireEvent.click(await screen.findByRole("button", { name: /Approve/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Save to Macros/i }),
    );
    const retry = await screen.findByRole("button", { name: /Retry save/i });
    fireEvent.click(retry);
    await waitFor(() => {
      expect(onSaveMacro).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("button", { name: /Saved ✓/ })).toBeDisabled();
    });
  });

  it("offers Save to Macros under Python code blocks of a reply", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([
        {
          content: [
            "Use this macro:",
            "",
            "```python",
            MACRO_CODE,
            "```",
            "",
            "```bash",
            "echo not a macro",
            "```",
          ].join("\n"),
          toolCalls: [],
        },
      ]),
    );
    const onSaveMacro = vi.fn(async () => undefined);
    render(
      <AIAssistantPanel runtime={fakeRuntime()} onSaveMacro={onSaveMacro} />,
      { wrapper: ThemeProvider },
    );
    await send("Write a macro that generates a super-gaussian curve");
    const buttons = await screen.findAllByRole("button", {
      name: /Save to Macros/i,
    });
    // One button for the Python block, none for the shell block.
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    await waitFor(() =>
      expect(onSaveMacro).toHaveBeenCalledWith(
        "Write a macro that generates a super-gaussian curve",
        MACRO_CODE,
      ),
    );
  });

  it("never auto-approves a macro run after remembering a macro offered without running it", async () => {
    vi.stubGlobal(
      "fetch",
      mockOpenAI([
        macroToolTurn({ code: MACRO_CODE, autorun: false }, "m1"),
        macroToolTurn({ code: MACRO_CODE, autorun: true }, "m2"),
        { content: "stopped", toolCalls: [] },
      ]),
    );
    const runMacroCode = vi.fn();
    render(
      <AIAssistantPanel
        runtime={fakeRuntime({ runMacroCode, lintMacro: lintOk() })}
        onSaveMacro={noSave}
      />,
      { wrapper: ThemeProvider },
    );
    await send("Write then run");
    await screen.findByText(/This macro will not be executed/i);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Approve/i }));
    // The second call runs the macro: it must be confirmed again.
    await waitFor(() =>
      expect(
        screen.queryByText(/This macro will not be executed/i),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Reject/i }));
    await waitFor(() => {
      expect(screen.getByText(/^stopped$/)).toBeInTheDocument();
    });
    expect(runMacroCode).not.toHaveBeenCalled();
  });
});
