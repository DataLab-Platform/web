/**
 * Runtime execution-mode selector.
 *
 * DataLab-Web can run its Pyodide runtime two ways:
 *
 *   * **worker** (default) — Pyodide and the runtime live in a Dedicated Web
 *     Worker ({@link kernelWorker}), driven from the UI thread through
 *     {@link WorkerRuntimeProxy}. This keeps the UI thread responsive during
 *     heavy work and unlocks synchronous OPFS spills (DEW ADR #2). It is the
 *     nominal mode and needs no special HTTP headers (transferables, not
 *     ``SharedArrayBuffer``), so plain static hosting keeps working.
 *   * **main** — {@link DataLabRuntime} runs on the UI thread, exactly as it
 *     originally shipped. Kept as a **backup / escape hatch** (e.g. to rule
 *     out a worker-specific issue): select it with ``?runtime=main``.
 *
 * The mode is resolved once per page load, in priority order:
 *   1. ``?runtime=worker`` / ``?runtime=main`` URL parameter (handy for E2E
 *      and as the user-facing backup switch).
 *   2. ``localStorage["datalab-web:runtime"]`` (persisted developer choice).
 *   3. ``VITE_RUNTIME_WORKER`` build-time env (``"0"``/``"false"`` → main).
 *   4. Default: worker.
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
  if (raw === "0" || raw === "false") return "main";
  return null;
}

/** Resolve the runtime execution mode for this page load. */
export function getRuntimeMode(): RuntimeMode {
  return fromUrl() ?? fromStorage() ?? fromEnv() ?? "worker";
}
