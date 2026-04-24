import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DataLabRuntime } from "./runtime";

interface RuntimeContextValue {
  runtime: DataLabRuntime | null;
  status: "loading" | "ready" | "error";
  message: string;
  error: string | null;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<DataLabRuntime | null>(null);
  const [status, setStatus] = useState<RuntimeContextValue["status"]>("loading");
  const [message, setMessage] = useState("Initialising…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    DataLabRuntime.load((msg) => {
      if (!cancelled) setMessage(msg);
    })
      .then((rt) => {
        if (cancelled) return;
        setRuntime(rt);
        setStatus("ready");
        if (import.meta.env.DEV) {
          // Expose for ad-hoc debugging from the DevTools console.
          // Examples (in DevTools console, no page reload needed):
          //   await runtime.runPython("list(_STORE.keys())")
          //   await runtime.listSignals()
          //   await runtime.reloadBootstrap()  // re-run bootstrap.py
          (window as unknown as { runtime: DataLabRuntime }).runtime = rt;
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
