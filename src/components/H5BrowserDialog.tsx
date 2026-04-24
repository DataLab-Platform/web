/**
 * H5BrowserDialog — full reimplementation of Qt DataLab's HDF5 browser.
 *
 * Mirrors :class:`datalab.widgets.h5browser.H5BrowserDialog`:
 *
 *   * top: file selector combobox + Open / Close buttons (multi-file
 *     support — every file lives in its own ``H5Importer`` on the
 *     Python side);
 *   * left pane: 4-column tree (Name / Size / Type / Value) with
 *     expand/collapse, recursive checkboxes for "supported" nodes
 *     (1-D / 2-D numeric arrays);
 *   * right pane: Plotly preview on top (signal curve or image
 *     heatmap), tabbed "Group / Attributes" panel below with a
 *     "Show array" button to inspect raw data;
 *   * footer: ``Show only supported data`` / ``Show values`` toggles,
 *     ``Check all`` / ``Uncheck all`` buttons, OK / Cancel buttons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Plot from "react-plotly.js";
import { getH5IconUrl } from "../assets/h5Icons";
import type {
  H5BrowserArray,
  H5BrowserFile,
  H5BrowserNode,
  H5BrowserNodeAttrs,
  H5BrowserPreview,
} from "../runtime/runtime";
import { useRuntime } from "../runtime/RuntimeContext";

interface Props {
  /** Optional already-opened files (e.g. opened by the caller before
   *  showing the dialog). */
  initial?: H5BrowserFile[];
  /** Called with the list of object ids created in the model when the
   *  user clicks OK. */
  onImport: (oids: string[], uint32Clipped: boolean) => void;
  onCancel: () => void;
}

interface OpenFileState {
  file: H5BrowserFile;
  /** Set of node ids currently checked. */
  checked: Set<string>;
  /** Set of node ids currently expanded. */
  expanded: Set<string>;
}

function collectIds(node: H5BrowserNode, out: Set<string>) {
  out.add(node.id);
  for (const c of node.children) collectIds(c, out);
}

function collectSupportedIds(node: H5BrowserNode, out: Set<string>) {
  if (node.is_supported) out.add(node.id);
  for (const c of node.children) collectSupportedIds(c, out);
}

function findNode(root: H5BrowserNode, id: string): H5BrowserNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

export function H5BrowserDialog({ initial, onImport, onCancel }: Props) {
  const { runtime } = useRuntime();
  const [files, setFiles] = useState<OpenFileState[]>(() =>
    (initial ?? []).map((f) => ({
      file: f,
      checked: new Set<string>(),
      expanded: defaultExpanded(f.root),
    })),
  );
  const [currentFileId, setCurrentFileId] = useState<string | null>(
    () => initial?.[0]?.file_id ?? null,
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showOnlySupported, setShowOnlySupported] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [preview, setPreview] = useState<H5BrowserPreview | null>(null);
  const [attrs, setAttrs] = useState<H5BrowserNodeAttrs | null>(null);
  const [activeTab, setActiveTab] = useState<"group" | "attrs">("group");
  const [arrayDialog, setArrayDialog] = useState<H5BrowserArray | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track which file ids we own (so we close them on unmount); files
  // passed via ``initial`` are still cleaned up — the caller is
  // responsible for not reopening them after onCancel/onImport.
  const ownedFileIds = useRef<Set<string>>(
    new Set((initial ?? []).map((f) => f.file_id)),
  );

  // Esc closes the dialog.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup any still-open files on unmount.
  useEffect(() => {
    return () => {
      if (!runtime) return;
      const ids = Array.from(ownedFileIds.current);
      ids.forEach((fid) => void runtime.closeH5Browser(fid).catch(() => {}));
    };
  }, [runtime]);

  const currentFile = useMemo(
    () => files.find((f) => f.file.file_id === currentFileId) ?? null,
    [files, currentFileId],
  );

  const totalChecked = useMemo(
    () => files.reduce((acc, f) => acc + f.checked.size, 0),
    [files],
  );

  // ------------------------------------------------------------------
  // File open / close
  // ------------------------------------------------------------------

  const handleAddFile = useCallback(async () => {
    if (!runtime) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".h5,.hdf5,.hdf,.he5";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const opened = await runtime.openH5Browser(file.name, bytes);
        ownedFileIds.current.add(opened.file_id);
        setFiles((prev) => [
          ...prev,
          {
            file: opened,
            checked: new Set<string>(),
            expanded: defaultExpanded(opened.root),
          },
        ]);
        setCurrentFileId(opened.file_id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    };
    input.click();
  }, [runtime]);

  const handleCloseFile = useCallback(async () => {
    if (!runtime || !currentFileId) return;
    const fid = currentFileId;
    try {
      await runtime.closeH5Browser(fid);
    } catch {
      /* swallow — UI cleanup is the main goal */
    }
    ownedFileIds.current.delete(fid);
    setFiles((prev) => {
      const next = prev.filter((f) => f.file.file_id !== fid);
      setCurrentFileId(next[0]?.file.file_id ?? null);
      return next;
    });
    setSelectedNodeId(null);
    setPreview(null);
    setAttrs(null);
  }, [runtime, currentFileId]);

  const handleCancel = useCallback(() => {
    if (!runtime) {
      onCancel();
      return;
    }
    const ids = Array.from(ownedFileIds.current);
    ownedFileIds.current.clear();
    Promise.all(
      ids.map((fid) => runtime.closeH5Browser(fid).catch(() => {})),
    ).finally(() => onCancel());
  }, [runtime, onCancel]);

  // ------------------------------------------------------------------
  // Tree mutation helpers
  // ------------------------------------------------------------------

  const updateCurrent = useCallback(
    (mutate: (state: OpenFileState) => OpenFileState) => {
      setFiles((prev) =>
        prev.map((f) => (f.file.file_id === currentFileId ? mutate(f) : f)),
      );
    },
    [currentFileId],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      updateCurrent((s) => {
        const next = new Set(s.expanded);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...s, expanded: next };
      });
    },
    [updateCurrent],
  );

  const setExpandedAll = useCallback(
    (expand: boolean) => {
      updateCurrent((s) => {
        const next = new Set<string>();
        if (expand) collectIds(s.file.root, next);
        else next.add(s.file.root.id);
        return { ...s, expanded: next };
      });
    },
    [updateCurrent],
  );

  const restoreLayout = useCallback(() => {
    updateCurrent((s) => ({ ...s, expanded: defaultExpanded(s.file.root) }));
  }, [updateCurrent]);

  const toggleCheck = useCallback(
    (id: string) => {
      updateCurrent((s) => {
        const next = new Set(s.checked);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...s, checked: next };
      });
    },
    [updateCurrent],
  );

  const toggleAll = useCallback(
    (state: boolean) => {
      updateCurrent((s) => {
        const next = new Set<string>();
        if (state) collectSupportedIds(s.file.root, next);
        return { ...s, checked: next };
      });
    },
    [updateCurrent],
  );

  // ------------------------------------------------------------------
  // Selection / preview loading
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!runtime || !currentFileId || !selectedNodeId) {
      setPreview(null);
      setAttrs(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      runtime.getH5BrowserNodeAttrs(currentFileId, selectedNodeId),
      runtime.getH5BrowserPreview(currentFileId, selectedNodeId),
    ])
      .then(([a, p]) => {
        if (cancelled) return;
        setAttrs(a);
        setPreview(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, currentFileId, selectedNodeId]);

  const handleSelectNode = useCallback((id: string) => {
    setSelectedNodeId(id);
  }, []);

  const handleShowArray = useCallback(async () => {
    if (!runtime || !currentFileId || !selectedNodeId) return;
    try {
      const arr = await runtime.getH5BrowserArray(
        currentFileId,
        selectedNodeId,
      );
      setArrayDialog(arr);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runtime, currentFileId, selectedNodeId]);

  // ------------------------------------------------------------------
  // Import (OK button)
  // ------------------------------------------------------------------

  const handleAccept = useCallback(async () => {
    if (!runtime || totalChecked === 0) return;
    setBusy(true);
    setError(null);
    const allOids: string[] = [];
    let uintClipped = false;
    try {
      for (const f of files) {
        if (f.checked.size === 0) continue;
        const result = await runtime.importH5BrowserNodes(
          f.file.file_id,
          Array.from(f.checked),
        );
        allOids.push(...result.oids);
        if (result.uint32_clipped) uintClipped = true;
      }
      // Close all owned files before notifying the caller.
      const ids = Array.from(ownedFileIds.current);
      ownedFileIds.current.clear();
      await Promise.all(
        ids.map((fid) => runtime.closeH5Browser(fid).catch(() => {})),
      );
      onImport(allOids, uintClipped);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [runtime, files, totalChecked, onImport]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="h5browser-title"
      onClick={handleCancel}
    >
      <div
        className="card h5browser-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="h5browser-title">HDF5 Browser</h2>

        <div className="h5browser-toolbar">
          <select
            className="h5browser-file-combo"
            value={currentFileId ?? ""}
            onChange={(e) => setCurrentFileId(e.target.value || null)}
            disabled={files.length === 0}
          >
            {files.length === 0 && <option value="">— no file open —</option>}
            {files.map((f) => (
              <option key={f.file.file_id} value={f.file.file_id}>
                {f.file.filename}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleAddFile} disabled={busy}>
            Open…
          </button>
          <button
            type="button"
            onClick={handleCloseFile}
            disabled={!currentFileId || busy}
          >
            Close
          </button>
          <span className="h5browser-spacer" />
          <button type="button" onClick={() => setExpandedAll(true)}>
            Expand all
          </button>
          <button type="button" onClick={() => setExpandedAll(false)}>
            Collapse all
          </button>
          <button type="button" onClick={restoreLayout}>
            Restore
          </button>
        </div>

        <div className="h5browser-body">
          {/* Left pane: tree --------------------------------------------------- */}
          <div className="h5browser-tree-pane">
            {currentFile ? (
              <table className="h5browser-tree">
                <thead>
                  <tr>
                    <th className="h5browser-col-name">Name</th>
                    <th className="h5browser-col-shape">Size</th>
                    <th className="h5browser-col-dtype">Type</th>
                    {showValues && (
                      <th className="h5browser-col-value">Value</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <TreeRows
                    node={currentFile.file.root}
                    depth={0}
                    state={currentFile}
                    showOnlySupported={showOnlySupported}
                    showValues={showValues}
                    selectedNodeId={selectedNodeId}
                    onToggleExpand={toggleExpand}
                    onToggleCheck={toggleCheck}
                    onSelect={handleSelectNode}
                  />
                </tbody>
              </table>
            ) : (
              <div className="h5browser-empty">
                Click <strong>Open…</strong> to load an HDF5 file.
              </div>
            )}
          </div>

          {/* Right pane: preview + attributes ---------------------------------- */}
          <div className="h5browser-preview-pane">
            <div className="h5browser-preview-plot">
              <PreviewPlot preview={preview} />
            </div>
            <div className="h5browser-preview-attrs">
              <div className="h5browser-tabs">
                <button
                  type="button"
                  className={
                    "h5browser-tab" +
                    (activeTab === "group" ? " h5browser-tab-active" : "")
                  }
                  onClick={() => setActiveTab("group")}
                >
                  Group
                </button>
                <button
                  type="button"
                  className={
                    "h5browser-tab" +
                    (activeTab === "attrs" ? " h5browser-tab-active" : "")
                  }
                  onClick={() => setActiveTab("attrs")}
                >
                  Attributes
                </button>
                <span className="h5browser-spacer" />
                <button
                  type="button"
                  onClick={handleShowArray}
                  disabled={!isArraySelected(currentFile, selectedNodeId)}
                  title="Show raw array data"
                >
                  Show array
                </button>
              </div>
              <div className="h5browser-tab-body">
                {activeTab === "group" && <GroupTable attrs={attrs} />}
                {activeTab === "attrs" && <AttrsTable attrs={attrs} />}
              </div>
            </div>
          </div>
        </div>

        {error && <div className="error h5browser-error">{error}</div>}

        <div className="h5browser-footer">
          <label>
            <input
              type="checkbox"
              checked={showOnlySupported}
              onChange={(e) => setShowOnlySupported(e.target.checked)}
            />{" "}
            Show only supported data
          </label>
          <label>
            <input
              type="checkbox"
              checked={showValues}
              onChange={(e) => setShowValues(e.target.checked)}
            />{" "}
            Show values
          </label>
          <span className="h5browser-spacer" />
          <button
            type="button"
            onClick={() => toggleAll(true)}
            disabled={!currentFile}
          >
            Check all
          </button>
          <button
            type="button"
            onClick={() => toggleAll(false)}
            disabled={!currentFile}
          >
            Uncheck all
          </button>
          <span className="h5browser-spacer" />
          <button type="button" onClick={handleCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={busy || totalChecked === 0}
          >
            OK ({totalChecked})
          </button>
        </div>

        {arrayDialog && (
          <ArrayDialog
            data={arrayDialog}
            onClose={() => setArrayDialog(null)}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

function defaultExpanded(root: H5BrowserNode): Set<string> {
  // Expand root + first-level children, like Qt's H5TreeWidget.add_root.
  const out = new Set<string>([root.id]);
  for (const c of root.children) out.add(c.id);
  return out;
}

function isArraySelected(
  current: OpenFileState | null,
  nodeId: string | null,
): boolean {
  if (!current || !nodeId) return false;
  const node = findNode(current.file.root, nodeId);
  return !!node && node.is_array;
}

interface TreeRowsProps {
  node: H5BrowserNode;
  depth: number;
  state: OpenFileState;
  showOnlySupported: boolean;
  showValues: boolean;
  selectedNodeId: string | null;
  onToggleExpand: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onSelect: (id: string) => void;
}

function shouldRender(
  node: H5BrowserNode,
  showOnlySupported: boolean,
): boolean {
  if (!showOnlySupported) return true;
  if (node.is_supported) return true;
  // Render groups whose subtree contains a supported descendant.
  for (const c of node.children) {
    if (shouldRender(c, true)) return true;
  }
  return false;
}

function TreeRows(props: TreeRowsProps): JSX.Element | null {
  const {
    node,
    depth,
    state,
    showOnlySupported,
    showValues,
    selectedNodeId,
    onToggleExpand,
    onToggleCheck,
    onSelect,
  } = props;
  if (!shouldRender(node, showOnlySupported)) return null;

  const expanded = state.expanded.has(node.id);
  const checked = state.checked.has(node.id);
  const isSelected = selectedNodeId === node.id;
  const hasChildren = node.children.length > 0;
  const iconUrl = getH5IconUrl(node.icon_name);

  return (
    <>
      <tr
        className={
          "h5browser-row" + (isSelected ? " h5browser-row-selected" : "")
        }
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => hasChildren && onToggleExpand(node.id)}
      >
        <td className="h5browser-cell-name">
          <span
            className="h5browser-indent"
            style={{ paddingLeft: depth * 14 }}
          />
          {hasChildren ? (
            <button
              type="button"
              className="h5browser-expand"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(node.id);
              }}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? "▾" : "▸"}
            </button>
          ) : (
            <span className="h5browser-expand-spacer" />
          )}
          {node.is_supported ? (
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggleCheck(node.id)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="h5browser-check-spacer" />
          )}
          {iconUrl && <img src={iconUrl} alt="" className="h5browser-icon" />}
          <span title={node.id}>{node.name}</span>
        </td>
        <td className="h5browser-cell-mono">{node.shape_str}</td>
        <td className="h5browser-cell-mono">{node.dtype_str}</td>
        {showValues && (
          <td className="h5browser-cell-value" title={node.text}>
            {node.text}
          </td>
        )}
      </tr>
      {expanded &&
        node.children.map((c) => (
          <TreeRows
            key={c.id}
            node={c}
            depth={depth + 1}
            state={state}
            showOnlySupported={showOnlySupported}
            showValues={showValues}
            selectedNodeId={selectedNodeId}
            onToggleExpand={onToggleExpand}
            onToggleCheck={onToggleCheck}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Right pane components
// ---------------------------------------------------------------------------

function PreviewPlot({ preview }: { preview: H5BrowserPreview | null }) {
  if (!preview) {
    return <div className="h5browser-empty">Select a node to preview…</div>;
  }
  if (preview.kind === "unsupported") {
    return (
      <div className="h5browser-empty">
        Unsupported data{preview.error ? ` (${preview.error})` : ""}
      </div>
    );
  }
  if (preview.kind === "signal") {
    return (
      <Plot
        data={[
          {
            type: "scatter" as const,
            mode: "lines" as const,
            x: preview.x,
            y: preview.y,
            line: { width: 1 },
          },
        ]}
        layout={{
          autosize: true,
          margin: { l: 40, r: 10, t: 10, b: 30 },
          showlegend: false,
        }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        config={{ displayModeBar: false }}
      />
    );
  }
  // image
  return (
    <Plot
      data={[
        {
          type: "heatmap" as const,
          z: preview.data,
          colorscale: "Jet" as const,
          showscale: false,
        },
      ]}
      layout={{
        autosize: true,
        margin: { l: 40, r: 10, t: 10, b: 30 },
        yaxis: { autorange: "reversed" as const, scaleanchor: "x" as const },
      }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
      config={{ displayModeBar: false }}
    />
  );
}

function GroupTable({ attrs }: { attrs: H5BrowserNodeAttrs | null }) {
  if (!attrs) {
    return <div className="h5browser-empty">Select a node…</div>;
  }
  const rows: [string, string][] = [
    ["Path", attrs.path],
    ["Name", attrs.name],
    ["Description", attrs.description],
    ["Textual preview", attrs.text_preview],
  ];
  return (
    <table className="h5browser-attrs">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>
              <pre>{v}</pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AttrsTable({ attrs }: { attrs: H5BrowserNodeAttrs | null }) {
  if (!attrs) {
    return <div className="h5browser-empty">Select a node…</div>;
  }
  const entries = Object.entries(attrs.attributes);
  if (entries.length === 0) {
    return <div className="h5browser-empty">No HDF5 attributes.</div>;
  }
  return (
    <table className="h5browser-attrs">
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>
              <pre>{stringifyAttr(v)}</pre>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function stringifyAttr(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// "Show array" sub-dialog
// ---------------------------------------------------------------------------

function ArrayDialog({
  data,
  onClose,
}: {
  data: H5BrowserArray;
  onClose: () => void;
}) {
  // Render up to 200 rows × 50 cols to keep the DOM manageable.
  const flat = useMemo(() => flattenForGrid(data.data), [data.data]);
  const truncatedRows = flat.length > 200;
  const rows = flat.slice(0, 200);
  const truncatedCols = rows.some((r) => r.length > 50);
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{ zIndex: 11 }}
    >
      <div
        className="card h5browser-array-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>
          Array — shape {data.shape.join(" × ")} ({data.dtype})
        </h2>
        <div className="h5browser-array-grid">
          <table>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.slice(0, 50).map((v, j) => (
                    <td key={j}>{formatCell(v)}</td>
                  ))}
                  {row.length > 50 && <td>…</td>}
                </tr>
              ))}
              {truncatedRows && (
                <tr>
                  <td colSpan={Math.min(rows[0]?.length ?? 1, 51)}>…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(truncatedRows || truncatedCols) && (
          <div className="h5browser-array-truncated">
            View truncated to 200 rows × 50 columns.
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function flattenForGrid(value: unknown): unknown[][] {
  if (!Array.isArray(value)) return [[value]];
  if (value.length === 0) return [[]];
  if (Array.isArray(value[0])) {
    return value.map((row) => (Array.isArray(row) ? row : [row]));
  }
  return [value];
}

function formatCell(value: unknown): string {
  if (typeof value === "number") {
    if (Number.isInteger(value)) return String(value);
    return value.toPrecision(6);
  }
  if (value === null || value === undefined) return "";
  return String(value);
}
