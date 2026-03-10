import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { SigimaRuntime } from "./runtime";

interface SigimaContextValue {
  runtime: SigimaRuntime | null;
  status: "loading" | "ready" | "error";
  message: string;
  error: string | null;
}

const SigimaContext = createContext<SigimaContextValue | null>(null);

export function SigimaProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<SigimaRuntime | null>(null);
  const [status, setStatus] = useState<SigimaContextValue["status"]>("loading");
  const [message, setMessage] = useState("Initialising…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    SigimaRuntime.load((msg) => {
      if (!cancelled) setMessage(msg);
    })
      .then((rt) => {
        if (cancelled) return;
        setRuntime(rt);
        setStatus("ready");
        if (import.meta.env.DEV) {
          // Expose for ad-hoc debugging from the DevTools console.
          // Examples (in DevTools console, no page reload needed):
          //   await sigima.runPython("list(_STORE.keys())")
          //   await sigima.listSignals()
          //   await sigima.reloadBootstrap()  // re-run bootstrap.py
          (window as unknown as { sigima: SigimaRuntime }).sigima = rt;
          console.info(
            "%c[sigima] runtime ready — try `await sigima.listSignals()`",
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
      promise.catch((err) => console.error("[sigima] hot-reload failed", err));
    };
    import.meta.hot.on("datalab-web:python-update", handler);
    return () => {
      import.meta.hot?.off?.("datalab-web:python-update", handler);
    };
  }, [runtime]);

  const value = useMemo<SigimaContextValue>(
    () => ({ runtime, status, message, error }),
    [runtime, status, message, error],
  );

  return <SigimaContext.Provider value={value}>{children}</SigimaContext.Provider>;
}

export function useSigima(): SigimaContextValue {
  const ctx = useContext(SigimaContext);
  if (!ctx) {
    throw new Error("useSigima must be used within a SigimaProvider");
  }
  return ctx;
}
