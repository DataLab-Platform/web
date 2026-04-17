import { useEffect, useMemo, useRef, useState } from "react";

/** One source signal exposed in the preview. */
export interface SaveToDirectorySource {
  id: string;
  /** Group-prefixed title displayed alongside the generated filename. */
  displayLabel: string;
}

/** Resolved parameters returned by the dialog when the user clicks OK. */
export interface SaveToDirectoryResult {
  /** Final basenames (without directory but *with* extension), one per
   *  source object — already deduplicated against each other. */
  basenames: string[];
  extension: string;
  overwrite: boolean;
}

interface Props {
  sources: SaveToDirectorySource[];
  extensions: string[];
  /** Async helper that asks the Python side to format basenames using the
   *  current pattern (without extension). */
  formatBasenames: (pattern: string) => Promise<string[]>;
  /** Optional initial state (re-used across invocations). */
  initialPattern?: string;
  initialExtension?: string;
  initialOverwrite?: boolean;
  onSubmit: (result: SaveToDirectoryResult) => void;
  onCancel: () => void;
}

const HELP_TEXT = `Pattern accepts a Python format string. Two extra modifiers are supported:
"upper" for uppercase and "lower" for lowercase.

Available placeholders:
  {title}                           Object title
  {index}                           1-based index
  {count}                           Total number of selected objects
  {xlabel}, {xunit}, {ylabel},      Axis information for signals
  {yunit}
  {metadata[key]}                   Specific metadata value

Examples:
  {index:03d}                       3-digit index with leading zeros
  {title:20.20}                     Title truncated to 20 characters
  {title:20.20upper}                Truncated, upper case
  {title:20.20lower}                Truncated, lower case`;

/** Add an `_N` suffix to the duplicate filenames so each entry is unique. */
function deduplicate(filenames: string[]): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let original of filenames) {
    let candidate = original;
    const dot = original.lastIndexOf(".");
    const stem = dot > 0 ? original.slice(0, dot) : original;
    const ext = dot > 0 ? original.slice(dot) : "";
    let k = 1;
    while (used.has(candidate)) {
      candidate = `${stem}_${k}${ext}`;
      k += 1;
    }
    used.add(candidate);
    out.push(candidate);
  }
  return out;
}

/**
 * "Save to directory…" dialog — browser-native counterpart of DataLab
 * desktop's ``SaveToDirectoryGUIParam`` editor.
 *
 * Lets the user choose a basename pattern, an extension and whether to
 * overwrite existing files; shows a live preview built by delegating
 * pattern expansion to Sigima's ``format_basenames`` helper.
 */
export function SaveToDirectoryDialog(props: Props) {
  const {
    sources,
    extensions,
    formatBasenames,
    initialPattern,
    initialExtension,
    initialOverwrite,
    onSubmit,
    onCancel,
  } = props;

  const [pattern, setPattern] = useState(initialPattern ?? "{title}");
  const [extension, setExtension] = useState(
    initialExtension && extensions.includes(initialExtension)
      ? initialExtension
      : (extensions[0] ?? ""),
  );
  const [overwrite, setOverwrite] = useState(initialOverwrite ?? false);
  const [basenames, setBasenames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Debounced preview generation: avoid hammering Pyodide while typing.
  const sourceIds = useMemo(() => sources.map((s) => s.id), [sources]);
  const reqIdRef = useRef(0);
  useEffect(() => {
    if (sourceIds.length === 0) {
      setBasenames([]);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    const handle = window.setTimeout(() => {
      formatBasenames(pattern)
        .then((names) => {
          if (reqIdRef.current !== reqId) return;
          setBasenames(names);
          setError(null);
        })
        .catch((err) => {
          if (reqIdRef.current !== reqId) return;
          setBasenames([]);
          setError(err instanceof Error ? err.message : String(err));
        });
    }, 150);
    return () => window.clearTimeout(handle);
  }, [pattern, sourceIds, formatBasenames]);

  const previewFilenames = useMemo(() => {
    if (error || basenames.length === 0) return [];
    const ext = extension ? `.${extension}` : "";
    return deduplicate(basenames.map((b) => `${b}${ext}`));
  }, [basenames, extension, error]);

  const canSubmit = !error && previewFilenames.length === sources.length;

  const handleOk = () => {
    if (!canSubmit) return;
    onSubmit({
      basenames: previewFilenames,
      extension,
      overwrite,
    });
  };

  return (
    <div className="overlay">
      <div className="card" style={{ minWidth: 520, maxWidth: "90vw" }}>
        <h2>Save to directory…</h2>
        <p
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            margin: "0 0 10px",
          }}
        >
          {sources.length} object{sources.length > 1 ? "s" : ""} will be written
          to the selected directory.
        </p>
        <div className="row">
          <label htmlFor="stdir-pattern">Basename pattern</label>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              id="stdir-pattern"
              type="text"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              style={{ flex: 1 }}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              title="Show pattern syntax help"
            >
              ?
            </button>
          </div>
        </div>
        <div className="row">
          <label htmlFor="stdir-ext">Extension</label>
          <select
            id="stdir-ext"
            value={extension}
            onChange={(e) => setExtension(e.target.value)}
          >
            {extensions.map((ext) => (
              <option key={ext} value={ext}>
                .{ext}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span />
          <label
            style={{ display: "flex", alignItems: "center", gap: 6 }}
            title="Overwrite existing files (only when writing to a real directory)"
          >
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite existing files
          </label>
        </div>
        {showHelp && (
          <pre
            style={{
              background: "var(--panel-alt, rgba(0,0,0,0.25))",
              padding: 8,
              fontSize: 11,
              maxHeight: 200,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              margin: "8px 0",
            }}
          >
            {HELP_TEXT}
          </pre>
        )}
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, marginBottom: 4 }}>Preview</div>
          <div
            style={{
              border: "1px solid var(--border)",
              background: "var(--panel-alt, rgba(0,0,0,0.25))",
              padding: 6,
              fontSize: 11,
              fontFamily: "var(--font-mono, monospace)",
              maxHeight: 180,
              overflow: "auto",
            }}
          >
            {error ? (
              <div className="error">Invalid pattern: {error}</div>
            ) : previewFilenames.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>
                (computing preview…)
              </div>
            ) : (
              previewFilenames.map((name, i) => (
                <div key={`${sources[i].id}-${i}`}>
                  <span style={{ color: "var(--text-dim)" }}>
                    {sources[i].displayLabel}:{" "}
                  </span>
                  {name}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={handleOk} disabled={!canSubmit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
