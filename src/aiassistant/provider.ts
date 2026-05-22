/**
 * Provider facade — resolves :type:`ProviderSettings` to a concrete
 * :type:`LLMProvider` and exposes a single ``chatCompletions`` entry
 * point so callers (the controller) don't have to know about the
 * specific implementations.
 *
 * Cross-reference: ``DataLab/datalab/aiassistant/providers/__init__.py``.
 */

import type {
  ChatCompletionsOptions,
  ChatMessage,
  LLMProvider,
  ProviderResponse,
  ProviderSettings,
  Tool,
} from "./types";
import { MOCK_PROVIDER } from "./providers/mock";
import { OPENAI_PROVIDER } from "./providers/openai";

const REGISTRY: Record<string, LLMProvider> = {
  openai: OPENAI_PROVIDER,
  mock: MOCK_PROVIDER,
};

/** Resolve the provider implementation for the given settings. Falls
 *  back to the OpenAI provider when the kind is unknown — keeps the
 *  app usable after a stale localStorage payload survives an upgrade. */
export function getProvider(settings: ProviderSettings): LLMProvider {
  return REGISTRY[settings.provider] ?? OPENAI_PROVIDER;
}

/** Drive ``settings.provider`` to its underlying ``chatCompletions``. */
export function chatCompletions(
  settings: ProviderSettings,
  messages: ChatMessage[],
  tools: Tool[],
  options?: ChatCompletionsOptions,
): Promise<ProviderResponse> {
  return getProvider(settings).chatCompletions(
    settings,
    messages,
    tools,
    options,
  );
}
