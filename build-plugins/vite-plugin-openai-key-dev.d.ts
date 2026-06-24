import type { Plugin } from "vite";
/**
 * Vite plugin (dev-server only): expose the developer's
 * ``OPENAI_API_KEY`` shell variable through a tiny local endpoint so
 * the AI Assistant settings dialog can pre-fill the field.
 *
 * The route is ``GET /__dev__/openai-key`` and returns
 * ``{ apiKey: string }`` — empty string when the variable is unset.
 *
 * Security:
 *
 * - Only registered by ``configureServer`` → never exists in
 *   ``vite build`` output, so the key is **never** baked into the
 *   shipped bundle.
 * - The dev server binds to localhost by default; the key never
 *   leaves the developer's machine.
 * - If the developer publishes the dev server (``vite --host``), any
 *   user reaching the endpoint can read the key. The plugin therefore
 *   refuses the request unless the request hostname looks local.
 */
export declare function openAiKeyDevEndpoint(): Plugin;
