/**
 * Integration test: capture_view tool wires plotCapture +
 * followupMessages correctly so a vision model would see an inline
 * image on its next turn.
 *
 * Drives the controller end-to-end with the MockProvider:
 *   1. mock asks for ``capture_view``
 *   2. controller runs the tool, which appends a ``role:"user"``
 *      message containing an ``image_url`` part
 *   3. mock returns prose, controller stops
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AIController } from "../../../src/aiassistant/controller";
import { BUILTIN_TOOLS } from "../../../src/aiassistant/tools";
import {
  _resetRegistryForTests,
  registerActivePlot,
} from "../../../src/aiassistant/plotCapture";
import {
  getMockRequests,
  resetMockProvider,
  setMockScript,
} from "../../../src/aiassistant/providers/mock";
import type {
  ChatMessage,
  ChatMessageContentPart,
  ProviderSettings,
} from "../../../src/aiassistant/types";
import type { DataLabRuntime } from "../../../src/runtime/runtime";

const settings: ProviderSettings = {
  provider: "mock",
  baseUrl: "",
  apiKey: "",
  model: "mock",
  temperature: 0,
};

const runtime = {} as DataLabRuntime;

afterEach(() => {
  _resetRegistryForTests();
  resetMockProvider();
  vi.unstubAllGlobals();
});

describe("capture_view tool (multimodal followup)", () => {
  it("appends a synthetic user message carrying an inline image", async () => {
    const gd = document.createElement("div");
    Object.defineProperty(gd, "clientWidth", { value: 320, configurable: true });
    Object.defineProperty(gd, "clientHeight", { value: 240, configurable: true });
    registerActivePlot("signal", gd);
    vi.stubGlobal("window", {
      ...window,
      Plotly: { toImage: async () => "data:image/png;base64,ZmFrZQ==" },
    });
    setMockScript([
      {
        content: null,
        toolCalls: [{ name: "capture_view", arguments: { panel: "signal" } }],
      },
      { content: "I see a sine wave." },
    ]);
    const ctrl = new AIController({
      runtime,
      tools: BUILTIN_TOOLS,
      systemPrompt: "s",
      getSettings: () => settings,
      confirmTool: async () => true,
    });
    const text = await ctrl.sendUserMessage("look");
    expect(text).toBe("I see a sine wave.");
    const followup = ctrl
      .getHistory()
      .find(
        (m): m is Extract<ChatMessage, { role: "user" }> =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === "image_url"),
      );
    expect(followup).toBeDefined();
    const imagePart = (followup!.content as ChatMessageContentPart[]).find(
      (p) => p.type === "image_url",
    );
    expect(imagePart).toBeDefined();
    expect(imagePart!.type === "image_url" && imagePart.image_url.url).toMatch(
      /^data:image\/png;base64,/,
    );
    // The mock recorded both turns; the second turn must include the
    // followup message in its messages payload (i.e. the controller
    // forwarded the image to the model).
    const requests = getMockRequests();
    expect(requests).toHaveLength(2);
    const secondTurnMessages = requests[1]!.messages;
    expect(
      secondTurnMessages.some(
        (m) =>
          m.role === "user" &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === "image_url"),
      ),
    ).toBe(true);
  });
});
