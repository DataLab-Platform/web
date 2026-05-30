/**
 * PluginManagerDialog — DataLab-Web counterpart of the desktop
 * "Plugins > Configure plugins…" dialog.
 *
 * Shows the live list of registered plugins (status, name, version,
 * error if any), and exposes the four operations expected by the
 * desktop UX: load from file, unload, reload all, view error trace.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRuntime } from "../runtime/RuntimeContext";
import type { PluginRecord } from "../runtime/runtime";
import { t } from "../i18n/translate";
import { PluginConsentDialog } from "./PluginConsentDialog";
import {
  hashSource,
  isPluginTrusted,
  trustPlugin,
} from "../plugins/trustStore";

interface Props {
  onClose: () => void;
}

export function PluginManagerDialog({ onClose }: Props) {
  const { runtime } = useRuntime();
  const [records, setRecords] = useState<PluginRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errorOpen, setErrorOpen] = useState<PluginRecord | null>(null);
  const [pending, setPending] = useState<{
    filename: string;
    source: string;
    hash: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    if (!runtime) return;
    try {
      setRecords(await runtime.listPlugins());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [runtime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending && !errorOpen) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, pending, errorOpen]);

  const handleLoadFile = async (file: File) => {
    if (!runtime) return;
    const source = await file.text();
    const trusted = await isPluginTrusted(file.name, source);
    if (trusted) {
      await doLoad(file.name, source);
      return;
    }
    const hash = await hashSource(source);
    setPending({ filename: file.name, source, hash });
  };

  const doLoad = async (filename: string, source: string) => {
    if (!runtime) return;
    setErr(null);
    setBusy(true);
    try {
      await runtime.loadPluginSource(filename, source);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnload = async (rec: PluginRecord) => {
    if (!runtime) return;
    setBusy(true);
    try {
      await runtime.unloadPlugin(rec.name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleReloadAll = async () => {
    if (!runtime) return;
    setBusy(true);
    try {
      await runtime.reloadPlugins();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card" style={{ minWidth: 600, maxWidth: 900 }}>
        <h2>{t("Plugins")}</h2>
        <div
          className="actions"
          style={{ justifyContent: "flex-start", marginBottom: 8 }}
        >
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            {t("Load from file…")}
          </button>
          <button
            onClick={handleReloadAll}
            disabled={busy || records.length === 0}
          >
            {t("Reload all")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".py"
            style={{ display: "none" }}
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = "";
              if (f) void handleLoadFile(f);
            }}
          />
        </div>
        {err && <div className="error">{err}</div>}
        <table className="plugins-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>{t("Name")}</th>
              <th>{t("Version")}</th>
              <th>{t("Status")}</th>
              <th>{t("File")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "#888" }}>
                  {t("No plugin loaded.")}
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.name}>
                <td>{r.info?.name ?? r.name}</td>
                <td>{r.info?.version ?? "—"}</td>
                <td>
                  {r.error ? (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setErrorOpen(r);
                      }}
                      style={{ color: "#c62828" }}
                    >
                      {t("error")}
                    </a>
                  ) : r.loaded ? (
                    <span style={{ color: "#2e7d32" }}>{t("loaded")}</span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td>
                  <code style={{ fontSize: 11 }}>{r.filename}</code>
                </td>
                <td>
                  <button onClick={() => handleUnload(r)} disabled={busy}>
                    {t("Unload")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
      {pending && (
        <PluginConsentDialog
          filename={pending.filename}
          source={pending.source}
          hash={pending.hash}
          onCancel={() => setPending(null)}
          onAccept={async () => {
            await trustPlugin(pending.filename, pending.source);
            const { filename, source } = pending;
            setPending(null);
            await doLoad(filename, source);
          }}
        />
      )}
      {errorOpen && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="card" style={{ minWidth: 540, maxWidth: 800 }}>
            <h2>{t("Plugin error")}</h2>
            <p>
              <code>{errorOpen.filename}</code>
            </p>
            <pre
              style={{
                maxHeight: 360,
                overflow: "auto",
                background: "#1e1e1e",
                color: "#d4d4d4",
                padding: 8,
                fontSize: 11,
              }}
            >
              {errorOpen.error}
            </pre>
            <div className="actions">
              <button onClick={() => setErrorOpen(null)}>{t("Close")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
