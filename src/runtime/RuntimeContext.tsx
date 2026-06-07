import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DataLabRuntime, type RuntimeApi } from "./runtime";
import { createWorkerRuntime } from "./WorkerRuntimeProxy";
import { getRuntimeMode } from "./runtimeMode";
import { activateRemoteBridge, type RemoteBridgeHandle } from "./remoteBridge";
import { getCurrentPanel, getSelection } from "./selectionState";
import { t } from "../i18n/translate";

interface RuntimeContextValue {
  runtime: RuntimeApi | null;
  status: "loading" | "ready" | "error";
  message: string;
  error: string | null;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<RuntimeApi | null>(null);
  const [status, setStatus] =
    useState<RuntimeContextValue["status"]>("loading");
  const [message, setMessage] = useState(t("Initialising…"));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let remoteBridgeHandle: RemoteBridgeHandle | null = null;
    // Boot the runtime either in-thread (default) or inside a Dedicated
    // Web Worker (opt-in, see ``getRuntimeMode``). Both resolve to the same
    // ``RuntimeApi`` façade, so the rest of this effect is mode-agnostic.
    const onProgress = (msg: string) => {
      if (!cancelled) setMessage(msg);
    };
    const boot =
      getRuntimeMode() === "worker"
        ? createWorkerRuntime(onProgress)
        : DataLabRuntime.load(onProgress);
    boot
      .then((rt) => {
        if (cancelled) return;
        setRuntime(rt);
        setStatus("ready");
        // Activate the iframe-embedded remote-control bridge if (and only
        // if) the URL carries a ``?allowedOrigins=`` parameter. No-op
        // otherwise — the standalone app is unaffected. The handle is
        // disposed by the cleanup function below.
        try {
          remoteBridgeHandle = activateRemoteBridge(rt, {
            version: import.meta.env.VITE_APP_VERSION,
            getSelection,
            getCurrentPanel,
          });
          if (remoteBridgeHandle && import.meta.env.DEV) {
            console.info(
              "%c[remoteBridge] active for origins: " +
                remoteBridgeHandle.allowedOrigins.join(", "),
              "color:#0e639c;font-weight:bold",
            );
          }
        } catch (err) {
          console.error("[remoteBridge] activation failed", err);
        }
        if (import.meta.env.DEV) {
          // Expose for ad-hoc debugging from the DevTools console.
          // Examples (in DevTools console, no page reload needed):
          //   await runtime.runPython("list(_STORE.keys())")
          //   await runtime.listSignals()
          //   await runtime.reloadBootstrap()  // re-run bootstrap.py
          (window as unknown as { runtime: RuntimeApi }).runtime = rt;
          console.info(
            "%c[runtime] ready \u2014 try `await runtime.listSignals()`",
            "color:#0e639c;font-weight:bold",
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
      remoteBridgeHandle?.dispose();
      remoteBridgeHandle = null;
    };
  }, []);

  // Hot-reload: a small Vite plugin (plugins/vite-plugin-python-hmr.ts)
  // watches .py files and pushes the new source via a custom HMR event.
  // We re-execute it inside the live Pyodide instance instead of forcing a
  // full page reload (which would mean another 30 s of cold-start).
  useEffect(() => {
    if (!import.meta.hot || !runtime) return;
    const handler = (data: { path: string; source: string }) => {
      if (!data?.source) return;
      const isProcessor = data.path.endsWith("processor.py");
      const promise = isProcessor
        ? runtime.reloadProcessor(data.source)
        : runtime.reloadBootstrap(data.source);
      promise.catch((err) => console.error("[runtime] hot-reload failed", err));
    };
    import.meta.hot.on("datalab-web:python-update", handler);
    return () => {
      import.meta.hot?.off?.("datalab-web:python-update", handler);
    };
  }, [runtime]);

  const value = useMemo<RuntimeContextValue>(
    () => ({ runtime, status, message, error }),
    [runtime, status, message, error],
  );

  return (
    <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) {
    throw new Error("useRuntime must be used within a RuntimeProvider");
  }
  return ctx;
}
