/**
 * PluginConsentDialog — explicit consent gate before loading a plugin.
 *
 * Mirrors the spirit of the desktop "Trust this plugin" prompt, but
 * adapted for the browser: shows the filename, byte size, SHA-256
 * preview and the first lines of source so the user can audit before
 * accepting.
 */

import { useEffect, useMemo } from "react";
import { t } from "../i18n/translate";
import type { PluginWheelInspection } from "../runtime/runtime";

interface Props {
  filename: string;
  source?: string;
  inspection?: PluginWheelInspection;
  hash: string;
  onAccept: () => void;
  onCancel: () => void;
}

export function PluginConsentDialog(props: Props) {
  const { filename, source, inspection, hash, onAccept, onCancel } = props;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const preview = useMemo(() => {
    return source?.split("\n").slice(0, 30).join("\n") ?? "";
  }, [source]);
  const size = inspection?.size_bytes ?? source?.length ?? 0;

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card" style={{ minWidth: 500, maxWidth: 720 }}>
        <h2>{inspection ? t("Install plugin wheel?") : t("Load plugin?")}</h2>
        <p>
          {inspection
            ? t(
                "This wheel contains Python code that is not sandboxed after installation. It can access the APIs exposed by Pyodide and this browser origin. Only proceed if you trust its source.",
              )
            : t(
                "DataLab-Web is about to execute the following Python plugin. Plugins run with full access to the in-browser Python runtime (Pyodide). Only proceed if you trust the source.",
              )}
        </p>
        <table style={{ width: "100%", marginBottom: 8 }}>
          <tbody>
            <tr>
              <td>
                <strong>{t("File")}</strong>
              </td>
              <td>
                <code>{filename}</code>
              </td>
            </tr>
            <tr>
              <td>
                <strong>{t("Size")}</strong>
              </td>
              <td>{t("{count} bytes", { count: size })}</td>
            </tr>
            <tr>
              <td>
                <strong>{t("SHA-256")}</strong>
              </td>
              <td>
                <code style={{ fontSize: 11 }}>{hash}</code>
              </td>
            </tr>
            {inspection && (
              <>
                <tr>
                  <td>
                    <strong>{t("Distribution")}</strong>
                  </td>
                  <td>
                    {inspection.distribution} {inspection.version}
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>{t("Python tags")}</strong>
                  </td>
                  <td>{inspection.tags.join(", ")}</td>
                </tr>
                <tr>
                  <td>
                    <strong>{t("Web entry points")}</strong>
                  </td>
                  <td>
                    {inspection.entry_points.map((entry) => (
                      <code key={entry.name} style={{ display: "block" }}>
                        {entry.name} = {entry.module}:{entry.attribute}
                      </code>
                    ))}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        {source && (
          <details>
            <summary>{t("Source preview (first 30 lines)")}</summary>
            <pre
              style={{
                maxHeight: 240,
                overflow: "auto",
                background: "#1e1e1e",
                color: "#d4d4d4",
                padding: 8,
                fontSize: 11,
              }}
            >
              {preview}
            </pre>
          </details>
        )}
        {inspection && inspection.dependencies.length > 0 && (
          <details>
            <summary>{t("Dependencies")}</summary>
            <ul>
              {inspection.dependencies.map((dependency) => (
                <li key={dependency.requirement}>
                  <code>{dependency.requirement}</code>
                  {dependency.installed_version
                    ? ` (${dependency.installed_version})`
                    : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="actions">
          <button onClick={onCancel}>{t("Cancel")}</button>
          <button onClick={onAccept}>
            {inspection ? t("Trust & install") : t("Trust & load")}
          </button>
        </div>
      </div>
    </div>
  );
}
