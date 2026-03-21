/**
 * PluginConsentDialog — explicit consent gate before loading a plugin.
 *
 * Mirrors the spirit of the desktop "Trust this plugin" prompt, but
 * adapted for the browser: shows the filename, byte size, SHA-256
 * preview and the first lines of source so the user can audit before
 * accepting.
 */

import { useEffect, useMemo } from "react";

interface Props {
  filename: string;
  source: string;
  hash: string;
  onAccept: () => void;
  onCancel: () => void;
}

export function PluginConsentDialog(props: Props) {
  const { filename, source, hash, onAccept, onCancel } = props;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const preview = useMemo(() => {
    return source.split("\n").slice(0, 30).join("\n");
  }, [source]);

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card" style={{ minWidth: 500, maxWidth: 720 }}>
        <h2>Load plugin?</h2>
        <p>
          DataLab-Web is about to execute the following Python plugin.
          Plugins run with full access to the in-browser Python runtime
          (Pyodide). Only proceed if you trust the source.
        </p>
        <table style={{ width: "100%", marginBottom: 8 }}>
          <tbody>
            <tr>
              <td>
                <strong>File</strong>
              </td>
              <td>
                <code>{filename}</code>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Size</strong>
              </td>
              <td>{source.length} bytes</td>
            </tr>
            <tr>
              <td>
                <strong>SHA-256</strong>
              </td>
              <td>
                <code style={{ fontSize: 11 }}>{hash}</code>
              </td>
            </tr>
          </tbody>
        </table>
        <details>
          <summary>Source preview (first 30 lines)</summary>
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
        <div className="actions">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onAccept}>Trust &amp; load</button>
        </div>
      </div>
    </div>
  );
}
