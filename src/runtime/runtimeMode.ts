/**
 * Runtime execution-mode selector.
 *
 * DataLab-Web can run its Pyodide runtime two ways:
 *
 *   * **in-thread** (default) — {@link DataLabRuntime} runs on the UI thread,
 *     exactly as it always has. Zero risk; this is what ships.
 *   * **worker** — Pyodide and the runtime live in a Dedicated Web Worker
 *     ({@link kernelWorker}), driven from the UI thread through
 *     {@link WorkerRuntimeProxy}. This unlocks synchronous OPFS spills
 *     (DEW ADR #2) but is still being end-to-end validated, so it is strictly
 *     opt-in.
 *
 * The mode is resolved once per page load, in priority order:
 *   1. ``?runtime=worker`` / ``?runtime=main`` URL parameter (handy for E2E).
 *   2. ``localStorage["datalab-web:runtime"]`` (persisted developer choice).
 *   3. ``VITE_RUNTIME_WORKER`` build-time env (``"1"``/``"true"`` → worker).
 *   4. Default: in-thread.
 */
export type RuntimeMode = "main" | "worker";

const STORAGE_KEY = "datalab-web:runtime";

function fromUrl(): RuntimeMode | null {
  try {
    const raw = new URLSearchParams(window.location.search)
      .get("runtime")
      ?.toLowerCase();
    if (raw === "worker") return "worker";
    if (raw === "main") return "main";
  } catch {
    /* ignore — URL unavailable */
  }
  return null;
}

function fromStorage(): RuntimeMode | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)?.toLowerCase();
    if (raw === "worker") return "worker";
    if (raw === "main") return "main";
  } catch {
    /* ignore — localStorage unavailable */
  }
  return null;
}

function fromEnv(): RuntimeMode | null {
  const raw = String(import.meta.env.VITE_RUNTIME_WORKER ?? "").toLowerCase();
  if (raw === "1" || raw === "true") return "worker";
  return null;
}

/** Resolve the runtime execution mode for this page load. */
export function getRuntimeMode(): RuntimeMode {
  return fromUrl() ?? fromStorage() ?? fromEnv() ?? "main";
}
