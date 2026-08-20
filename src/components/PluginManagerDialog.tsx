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
import type { PluginRecord, PluginWheelInspection } from "../runtime/runtime";
import { t } from "../i18n/translate";
import { PluginConsentDialog } from "./PluginConsentDialog";
import {
  hashSource,
  hashBytes,
  isPluginHashTrusted,
  isPluginTrusted,
  revokePluginTrust,
  trustPlugin,
  trustPluginHash,
} from "../plugins/trustStore";
import { EXAMPLE_PLUGINS, type ExamplePlugin } from "../plugins/examplePlugins";
import { PluginWheelStore } from "../storage/pluginWheelStore";

interface Props {
  onClose: () => void;
}

export function PluginManagerDialog({ onClose }: Props) {
  const { runtime } = useRuntime();
  const [records, setRecords] = useState<PluginRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errorOpen, setErrorOpen] = useState<PluginRecord | null>(null);
  const [pending, setPending] = useState<
    | { kind: "source"; filename: string; source: string; hash: string }
    | {
        kind: "wheel";
        filename: string;
        bytes: Uint8Array;
        hash: string;
        inspection: PluginWheelInspection;
      }
    | null
  >(null);
  const sourceFileRef = useRef<HTMLInputElement | null>(null);
  const wheelFileRef = useRef<HTMLInputElement | null>(null);

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
    setPending({ kind: "source", filename: file.name, source, hash });
  };

  const handleInstallWheel = async (file: File) => {
    if (!runtime) return;
    setErr(null);
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const [hash, inspection] = await Promise.all([
        hashBytes(bytes),
        runtime.inspectPluginWheel(file.name, bytes.slice()),
      ]);
      if (isPluginHashTrusted(file.name, hash)) {
        await doInstallWheel(file.name, bytes);
      } else {
        setPending({
          kind: "wheel",
          filename: file.name,
          bytes,
          hash,
          inspection,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLoadExample = async (ex: ExamplePlugin) => {
    if (!runtime) return;
    const trusted = await isPluginTrusted(ex.filename, ex.source);
    if (trusted) {
      await doLoad(ex.filename, ex.source);
      return;
    }
    const hash = await hashSource(ex.source);
    setPending({
      kind: "source",
      filename: ex.filename,
      source: ex.source,
      hash,
    });
  };

  const doInstallWheel = async (filename: string, bytes: Uint8Array) => {
    if (!runtime) return;
    setErr(null);
    setBusy(true);
    try {
      await runtime.installPluginWheel(filename, bytes);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

  const handleToggle = async (rec: PluginRecord) => {
    if (!runtime) return;
    setBusy(true);
    try {
      await runtime.setPluginEnabled(rec.record_id, !rec.enabled);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveWheel = async (rec: PluginRecord) => {
    if (!runtime || !rec.artifact_id) return;
    setBusy(true);
    try {
      await runtime.removeUserPluginWheel(rec.artifact_id);
      if (rec.artifact_filename && rec.sha256) {
        revokePluginTrust(rec.artifact_filename, rec.sha256);
      }
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = (source: PluginRecord["source"]): string => {
    switch (source) {
      case "bundled-wheel":
        return t("Bundled wheel");
      case "user-wheel":
        return t("User wheel");
      case "builtin-source":
        return t("Built-in source");
      default:
        return t("User source");
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
          <button
            onClick={() => sourceFileRef.current?.click()}
            disabled={busy}
          >
            {t("Load Python file…")}
          </button>
          <button
            onClick={() => wheelFileRef.current?.click()}
            disabled={busy || !PluginWheelStore.isSupported()}
            title={
              PluginWheelStore.isSupported()
                ? undefined
                : t("Persistent plugin storage requires OPFS.")
            }
          >
            {t("Install wheel…")}
          </button>
          <button
            onClick={handleReloadAll}
            disabled={busy || records.length === 0}
          >
            {t("Reload all")}
          </button>
          <input
            ref={sourceFileRef}
            type="file"
            accept=".py"
            style={{ display: "none" }}
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              ev.target.value = "";
              if (f) void handleLoadFile(f);
            }}
          />
          <input
            ref={wheelFileRef}
            type="file"
            accept=".whl"
            style={{ display: "none" }}
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              ev.target.value = "";
              if (file) void handleInstallWheel(file);
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
              <th>{t("Source")}</th>
              <th>{t("Trust")}</th>
              <th>{t("File")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "#888" }}>
                  {t("No plugin loaded.")}
                </td>
              </tr>
            )}
            {records.map((r) => (
              <tr key={r.record_id}>
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
                  ) : !r.enabled ? (
                    <span>{t("disabled")}</span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td>{sourceLabel(r.source)}</td>
                <td>
                  {r.trust === "verified" ? t("verified") : t("unverified")}
                </td>
                <td>
                  <code style={{ fontSize: 11 }}>
                    {r.artifact_filename ?? r.filename}
                  </code>
                </td>
                <td>
                  {r.artifact_id ? (
                    <>
                      <button onClick={() => handleToggle(r)} disabled={busy}>
                        {r.enabled ? t("Disable") : t("Enable")}
                      </button>
                      {r.operations.can_remove && (
                        <button
                          onClick={() => handleRemoveWheel(r)}
                          disabled={busy}
                        >
                          {t("Remove")}
                        </button>
                      )}
                    </>
                  ) : (
                    <button onClick={() => handleUnload(r)} disabled={busy}>
                      {t("Unload")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {EXAMPLE_PLUGINS.length > 0 && (
          <>
            <h3 style={{ marginBottom: 4 }}>{t("Example plugins")}</h3>
            <p style={{ margin: "0 0 8px", color: "#888", fontSize: 12 }}>
              {t("Bundled examples you can load on demand.")}
            </p>
            <table className="plugins-table" style={{ width: "100%" }}>
              <tbody>
                {EXAMPLE_PLUGINS.map((ex) => {
                  const loaded = records.some(
                    (r) => r.filename === ex.filename,
                  );
                  return (
                    <tr key={ex.filename}>
                      <td>
                        <code style={{ fontSize: 11 }}>{ex.filename}</code>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          onClick={() => void handleLoadExample(ex)}
                          disabled={busy || loaded}
                        >
                          {loaded ? t("loaded") : t("Load")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
        <div className="actions">
          <button onClick={onClose}>{t("Close")}</button>
        </div>
      </div>
      {pending && (
        <PluginConsentDialog
          filename={pending.filename}
          source={pending.kind === "source" ? pending.source : undefined}
          inspection={pending.kind === "wheel" ? pending.inspection : undefined}
          hash={pending.hash}
          onCancel={() => setPending(null)}
          onAccept={async () => {
            if (pending.kind === "source") {
              await trustPlugin(pending.filename, pending.source);
            } else {
              trustPluginHash(pending.filename, pending.hash);
            }
            const accepted = pending;
            setPending(null);
            if (accepted.kind === "source") {
              await doLoad(accepted.filename, accepted.source);
            } else {
              await doInstallWheel(accepted.filename, accepted.bytes);
            }
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
