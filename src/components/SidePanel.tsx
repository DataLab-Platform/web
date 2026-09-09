/**
 * SidePanel — DataLab-style "Creation parameters" / "Properties" tabs.
 *
 * Mirrors the bottom-left tabbed dock from the desktop app: each tab
 * embeds a :class:`DataSetForm` rendering a guidata DataSet sent over
 * by the Python side.  Edits are staged locally; an explicit "Apply"
 * button (or Ctrl+Enter) commits them to Sigima.  An "unsaved
 * changes" indicator + "Reset" button flag pending edits.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AnalysisResult,
  LastProcessingInfo,
  PropertiesSnapshot,
  SchemaWithValues,
  RuntimeApi,
} from "../runtime/runtime";
import {
  DataSetForm,
  stripTransientValues,
  validateDataSetValues,
  type DataSetFormProps,
} from "./DataSetForm";
import { ObjectStatsCard } from "./ObjectStatsCard";
import { MetadataEditor } from "./MetadataEditor";
import { CurveStyleEditor } from "./CurveStyleEditor";
import { ArrayPreview } from "./ArrayPreview";
import { useMessage } from "./ConfirmDialog";
import { getRootIconUrl } from "../assets/rootIcons";
import { t } from "../i18n/translate";

const CREATION_ICON = getRootIconUrl("libre-gui-add.svg");
const PROPERTIES_ICON = getRootIconUrl("properties.svg");
const PROCESSING_ICON = getRootIconUrl("libre-gui-cogs.svg");
const RESULTS_ICON = getRootIconUrl("analysis.svg");

type TabId = "creation" | "properties" | "processing" | "results";

interface Props {
  runtime: RuntimeApi;
  currentId: string | null;
  /** Which object panel the side panel is currently mirroring.  Lets
   *  panel-specific subviews (e.g. the curve-style editor for signals)
   *  branch on the active panel without having to query the runtime. */
  panelKind: "signal" | "image";
  /** Bumped by the parent whenever the underlying object changed (e.g.
   *  a feature was applied), to force a re-fetch. */
  refreshNonce: number;
  /** Notifies the parent that the current object's data may have
   *  changed so it can refresh the plot / tree. */
  onObjectChanged: (oid: string) => void;
  /** Tab to focus when ``currentId`` becomes non-null.  The parent
   *  bumps it after :meth:`createSignalTyped` to surface the Creation
   *  tab automatically. */
  preferredTab: TabId;
  /** Cached analysis results for the current object (drives the
   *  "Results" tab content). */
  results: AnalysisResult[];
  /** Drop one (or all when ``key`` is null) result(s) from the current
   *  object's metadata. */
  onClearResults: (key: string | null) => void;
  /** Width in pixels assigned by the host (drag-to-resize). */
  width?: number;
}

/** Browser detection for the Document Picture-in-Picture API
 *  (Chromium-based browsers, ``window.documentPictureInPicture``). */
function pipApiSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "documentPictureInPicture" in window &&
    typeof (window as unknown as { documentPictureInPicture: unknown })
      .documentPictureInPicture === "object"
  );
}

/** Copy the parent document's stylesheets into the PiP window so the
 *  detached panel keeps the dark DataLab theme.  We clone ``<style>``
 *  elements directly and re-create ``<link rel="stylesheet">`` ones to
 *  side-step CORS issues. */
function copyStylesheets(target: Document): void {
  for (const node of Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]'),
  )) {
    const clone = node.cloneNode(true);
    target.head.appendChild(clone);
  }
}

export function SidePanel(props: Props) {
  const {
    runtime,
    currentId,
    panelKind,
    refreshNonce,
    onObjectChanged,
    preferredTab,
    results,
    onClearResults,
    width,
  } = props;
  const [active, setActive] = useState<TabId>(preferredTab);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  // Tracks the live PiP window plus its ``pagehide`` handler so it can be
  // closed and its listener detached from any code path (dock button or
  // unmount), independently of when the window was opened.
  const pipRef = useRef<{ win: Window; onHide: () => void } | null>(null);
  const notify = useMessage();
  // Cached "last processing" payload for the current object.  Fetched
  // here (not just inside the Processing tab) so the tab header can be
  // shown / hidden without mounting the panel first.
  const [lastProcessing, setLastProcessing] =
    useState<LastProcessingInfo | null>(null);
  const hasProcessing = lastProcessing !== null;

  useEffect(() => {
    let cancelled = false;
    if (!currentId) {
      setLastProcessing(null);
      return;
    }
    runtime
      .getLastProcessing(currentId)
      .then((p) => {
        if (!cancelled) setLastProcessing(p);
      })
      .catch(() => {
        if (!cancelled) setLastProcessing(null);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, currentId, refreshNonce]);

  // If the active tab disappears (e.g. user selected a fresh object
  // without a processing record), fall back to Properties.
  useEffect(() => {
    if (active === "processing" && !hasProcessing) {
      setActive("properties");
    }
  }, [active, hasProcessing]);

  // Re-honour the parent's preferred tab when it bumps after a Create
  // action (the parent flips ``preferredTab`` to "creation" then).
  useEffect(() => {
    setActive(preferredTab);
  }, [preferredTab, currentId]);

  // Cleanup the PiP window when the side panel unmounts. We read the live
  // window from ``pipRef`` (not the captured ``pipWindow`` state) so a
  // window opened after mount is still closed and its listener detached.
  useEffect(() => {
    return () => {
      const entry = pipRef.current;
      if (entry) {
        entry.win.removeEventListener("pagehide", entry.onHide);
        if (!entry.win.closed) entry.win.close();
        pipRef.current = null;
      }
    };
  }, []);

  const handlePopOut = useCallback(async () => {
    if (!pipApiSupported()) {
      await notify({
        kind: "warning",
        title: "Pop-out unavailable",
        message:
          "Pop-out requires the Document Picture-in-Picture API " +
          "(Chrome / Edge 116+).",
      });
      return;
    }
    try {
      const win = await (
        window as unknown as {
          documentPictureInPicture: {
            requestWindow: (opts: {
              width: number;
              height: number;
            }) => Promise<Window>;
          };
        }
      ).documentPictureInPicture.requestWindow({
        width: Math.max(width ?? 360, 480),
        height: 720,
      });
      copyStylesheets(win.document);
      win.document.title = "DataLab Web — Object panel";
      win.document.body.style.margin = "0";
      win.document.body.style.background = "var(--panel)";
      // Defensive: close any previous PiP window before tracking the new
      // one (the dock button normally closes it first).
      const prev = pipRef.current;
      if (prev) {
        prev.win.removeEventListener("pagehide", prev.onHide);
        if (!prev.win.closed) prev.win.close();
      }
      const onHide = () => {
        const entry = pipRef.current;
        if (entry) {
          entry.win.removeEventListener("pagehide", entry.onHide);
          pipRef.current = null;
        }
        setPipWindow(null);
      };
      win.addEventListener("pagehide", onHide);
      pipRef.current = { win, onHide };
      setPipWindow(win);
    } catch (err) {
      // User dismissed the picker, or browser denied — silently ignore.
      console.warn("Pop-out failed:", err);
    }
  }, [width, notify]);

  const handleDock = useCallback(() => {
    const entry = pipRef.current;
    if (entry) {
      entry.win.removeEventListener("pagehide", entry.onHide);
      if (!entry.win.closed) entry.win.close();
      pipRef.current = null;
    }
    setPipWindow(null);
  }, []);

  const popped = pipWindow !== null && !pipWindow.closed;

  const body = (
    <>
      <div className="side-panel-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={active === "creation"}
          className={
            "side-panel-tab" + (active === "creation" ? " active" : "")
          }
          onClick={() => setActive("creation")}
        >
          {CREATION_ICON && (
            <img src={CREATION_ICON} alt="" className="switcher-tab-icon" />
          )}
          {t("Creation")}
        </button>
        <button
          role="tab"
          aria-selected={active === "properties"}
          className={
            "side-panel-tab" + (active === "properties" ? " active" : "")
          }
          onClick={() => setActive("properties")}
        >
          {PROPERTIES_ICON && (
            <img src={PROPERTIES_ICON} alt="" className="switcher-tab-icon" />
          )}
          {t("Properties")}
        </button>
        {hasProcessing && (
          <button
            role="tab"
            aria-selected={active === "processing"}
            className={
              "side-panel-tab" + (active === "processing" ? " active" : "")
            }
            onClick={() => setActive("processing")}
            title={
              lastProcessing
                ? t("Edit parameters of: {label}", {
                    label: lastProcessing.label,
                  })
                : undefined
            }
          >
            {PROCESSING_ICON && (
              <img src={PROCESSING_ICON} alt="" className="switcher-tab-icon" />
            )}
            {t("Processing")}
          </button>
        )}
        <button
          role="tab"
          aria-selected={active === "results"}
          className={"side-panel-tab" + (active === "results" ? " active" : "")}
          onClick={() => setActive("results")}
        >
          {RESULTS_ICON && (
            <img src={RESULTS_ICON} alt="" className="switcher-tab-icon" />
          )}
          {t("Results")}
          {results.length > 0 ? ` (${results.length})` : ""}
        </button>
        <button
          type="button"
          className="side-panel-popout"
          title={
            popped
              ? t("Dock the panel back into the main window")
              : t("Open the panel in a separate floating window")
          }
          onClick={popped ? handleDock : handlePopOut}
          aria-label={popped ? t("Dock panel") : t("Pop out panel")}
        >
          {popped ? "⇲" : "⇱"}
        </button>
      </div>
      <div className="side-panel-body">
        {!currentId && (
          <div className="side-panel-empty">{t("No object selected.")}</div>
        )}
        {currentId && active === "creation" && (
          <CreationPanel
            runtime={runtime}
            oid={currentId}
            panelKind={panelKind}
            refreshNonce={refreshNonce}
            onApplied={() => onObjectChanged(currentId)}
          />
        )}
        {currentId && active === "properties" && (
          <PropertiesPanel
            runtime={runtime}
            oid={currentId}
            panelKind={panelKind}
            refreshNonce={refreshNonce}
            onApplied={() => onObjectChanged(currentId)}
          />
        )}
        {currentId && active === "processing" && lastProcessing && (
          <ProcessingPanel
            runtime={runtime}
            oid={currentId}
            refreshNonce={refreshNonce}
            info={lastProcessing}
            onApplied={() => onObjectChanged(currentId)}
          />
        )}
        {currentId && active === "results" && (
          <ResultsPanel results={results} onClear={onClearResults} />
        )}
      </div>
    </>
  );

  if (popped && pipWindow) {
    // Render a placeholder in the docked slot so users know where the
    // panel went, and portal the real content into the PiP window.
    return (
      <>
        <aside
          className="side-panel side-panel-popped-placeholder"
          aria-label="Object panel (popped out)"
          style={width !== undefined ? { width } : undefined}
        >
          <div className="side-panel-placeholder">
            <p>Object panel is in a separate window.</p>
            <button
              type="button"
              className="results-clear-all"
              onClick={handleDock}
            >
              Dock back here
            </button>
          </div>
        </aside>
        {createPortal(
          <aside
            className="side-panel side-panel-popped"
            aria-label="Object panel"
          >
            {body}
          </aside>,
          pipWindow.document.body,
        )}
      </>
    );
  }

  return (
    <aside
      className="side-panel"
      aria-label="Object panel"
      style={width !== undefined ? { width } : undefined}
    >
      {body}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Creation tab (NewSignalParam editor)
// ---------------------------------------------------------------------------

interface SubProps {
  runtime: RuntimeApi;
  oid: string;
  refreshNonce: number;
  onApplied: () => void;
}

interface PropertiesProps extends SubProps {
  panelKind: "signal" | "image";
}

function CreationPanel({
  runtime,
  oid,
  panelKind,
  refreshNonce,
  onApplied,
}: PropertiesProps) {
  // ``payload`` is cleared to ``null`` at the start of every fetch so
  // the inner ``EditableForm`` (whose ``useState`` snapshots ``values``
  // at mount time) is unmounted between two objects.  Without this,
  // switching from object A to object B briefly re-renders the form
  // with B's id but A's stale values; an in-place ``Apply`` made from
  // that state would then write A's values back into B.
  const [payload, setPayload] = useState<
    (SchemaWithValues & { stype: string }) | null
  >(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Derived-state pattern: when ``oid`` or ``refreshNonce`` changes we must
  // clear ``payload`` *during the same render* so that ``EditableForm`` is
  // not remounted with the previous payload.  ``useEffect`` runs *after*
  // the render that sees the new prop, which would otherwise cause
  // ``EditableForm`` to snapshot stale values into its draft state.
  const [shownKey, setShownKey] = useState(`${oid}:${refreshNonce}`);
  const currentKey = `${oid}:${refreshNonce}`;
  if (shownKey !== currentKey) {
    setShownKey(currentKey);
    setPayload(null);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPayload(null);
    runtime
      .getCreationParamSchema(oid)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setAvailable(false);
          setPayload(null);
        } else {
          setAvailable(true);
          setPayload(p);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      // Dispatch to the correct backend helper: image objects cache a
      // ``NewImageParam`` (no ``generate_1d_data``) and must go through
      // ``update_image_creation_params``.  Hard-coding the signal path
      // here used to silently drop image edits with a Pyodide
      // ``AttributeError``.
      if (panelKind === "image") {
        await runtime.updateImageCreationParams(oid, values);
      } else {
        await runtime.updateSignalCreationParams(oid, values);
      }
      onApplied();
    },
    [runtime, oid, panelKind, onApplied],
  );

  if (loading) return <div className="side-panel-info">Loading…</div>;
  if (!available) {
    return (
      <div className="side-panel-info">
        This object has no editable creation parameters (it was loaded from a
        file or created via a processing step).
      </div>
    );
  }
  if (!payload) return null;
  return (
    <EditableForm
      key={`creation:${oid}:${refreshNonce}`}
      schema={payload.schema}
      values={payload.values}
      onApply={apply}
      initialError={error}
    />
  );
}

// ---------------------------------------------------------------------------
// Properties tab (full SignalObj DataSet editor)
// ---------------------------------------------------------------------------

function PropertiesPanel({
  runtime,
  oid,
  panelKind,
  refreshNonce,
  onApplied,
}: PropertiesProps) {
  // See ``CreationPanel`` for the rationale of clearing the snapshot at the
  // start of each fetch (avoids leaking the previous object's values into
  // the inner stateful form).
  const [snapshot, setSnapshot] = useState<PropertiesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Derived-state pattern: clear payload synchronously when ``oid`` or
  // ``refreshNonce`` changes (see ``CreationPanel`` for the rationale).
  const [shownKey, setShownKey] = useState(`${oid}:${refreshNonce}`);
  const currentKey = `${oid}:${refreshNonce}`;
  if (shownKey !== currentKey) {
    setShownKey(currentKey);
    setSnapshot(null);
    setLoading(true);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    runtime
      .getPropertiesSnapshot(oid)
      .then((p) => {
        if (!cancelled && p !== null) setSnapshot(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, oid, refreshNonce]);

  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      await runtime.setObjectPropertyValues(oid, values);
      onApplied();
    },
    [runtime, oid, onApplied],
  );

  if (loading) return <div className="side-panel-info">Loading…</div>;
  if (error && !snapshot) return <div className="error">{error}</div>;
  if (!snapshot) return null;
  return (
    <div className="properties-panel">
      <ObjectStatsCard stats={snapshot.stats} error={null} />
      <ArrayPreview
        runtime={runtime}
        oid={oid}
        stats={snapshot.stats}
        signalPreview={snapshot.signal_preview}
        refreshNonce={refreshNonce}
        onApplied={onApplied}
      />
      <EditableForm
        key={`properties:${oid}:${refreshNonce}`}
        schema={snapshot.schema.schema}
        values={snapshot.schema.values}
        onApply={apply}
        initialError={error}
      />
      {panelKind === "signal" && (
        <CurveStyleEditor
          runtime={runtime}
          oid={oid}
          refreshNonce={refreshNonce}
          onApplied={onApplied}
        />
      )}
      <MetadataEditor
        runtime={runtime}
        oid={oid}
        refreshNonce={refreshNonce}
        onChanged={() => onApplied()}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing tab — re-edit the parameters of the last applied feature
// and re-run it on the same source(s), replacing the current object's
// data in place.  Mirrors DataLab desktop's "Processing" dock tab.
// ---------------------------------------------------------------------------

interface ProcessingPanelProps extends SubProps {
  info: LastProcessingInfo;
}

function ProcessingPanel({
  runtime,
  oid,
  info,
  onApplied,
}: ProcessingPanelProps) {
  const sourceOid = info.source_ids[0];
  const missingDependencyMessages = [
    info.missing_source_ids.length > 0
      ? t("Source object(s) no longer exist: {ids}", {
          ids: info.missing_source_ids.join(", "),
        })
      : null,
    info.missing_operand_id
      ? t("Operand object no longer exists: {id}", {
          id: info.missing_operand_id,
        })
      : null,
  ].filter((message): message is string => message !== null);
  const dependenciesMissing = missingDependencyMessages.length > 0;
  const dependencyError = missingDependencyMessages.join(" ");
  const resolveChoices = useCallback(
    (itemName: string, values: Record<string, unknown>) =>
      runtime.resolveFeatureChoices(
        info.feature_id,
        itemName,
        values,
        sourceOid,
      ),
    [runtime, info.feature_id, sourceOid],
  );
  const resolveCallbacks = useCallback(
    (itemName: string, values: Record<string, unknown>) =>
      runtime.resolveFeatureCallbacks(
        info.feature_id,
        itemName,
        values,
        sourceOid,
      ),
    [runtime, info.feature_id, sourceOid],
  );
  const resolveActive = useCallback(
    (values: Record<string, unknown>) =>
      runtime.resolveFeatureActive(info.feature_id, values),
    [runtime, info.feature_id],
  );
  const apply = useCallback(
    async (values: Record<string, unknown>) => {
      if (dependenciesMissing) return;
      const runtimeValues = info.schema
        ? stripTransientValues(info.schema, values)
        : values;
      await runtime.reapplyLastProcessing(oid, runtimeValues);
      onApplied();
    },
    [dependenciesMissing, runtime, oid, info.schema, onApplied],
  );

  const persistentValues = useMemo(
    () => stripTransientValues(info.schema ?? {}, info.values ?? {}),
    [info.schema, info.values],
  );
  const transientValues = useMemo(
    () => extractTransientValues(info.schema ?? {}, info.values ?? {}),
    [info.schema, info.values],
  );

  // Key on the canonical applied values (not ``refreshNonce``) so the
  // form is only re-initialised when the Python-side baseline actually
  // changes.  ``refreshNonce`` bumps *before* the parent's async
  // ``getLastProcessing`` re-fetch resolves, so keying on it would
  // remount the form with the stale ``info.values`` snapshot — making
  // freshly-typed values appear to revert to the previous baseline
  // after Apply.
  // Computed unconditionally to satisfy the rules-of-hooks even when the
  // early-return branch below is taken.
  const valuesKey = useMemo(
    () => JSON.stringify(persistentValues),
    [persistentValues],
  );

  // Parameterless features: nothing to edit, just expose a "Re-apply"
  // button so the user can still trigger the recomputation.
  if (!info.has_params || !info.schema) {
    return (
      <div className="processing-panel">
        <ProcessingHeader info={info} />
        {dependenciesMissing && <div className="error">{dependencyError}</div>}
        <div className="side-panel-info">
          This processing has no parameters.
        </div>
        <div className="editable-form-footer">
          <span className="editable-form-status">&nbsp;</span>
          <div className="editable-form-buttons">
            <button
              type="button"
              className="editable-form-apply"
              onClick={() => void apply({})}
              disabled={dependenciesMissing}
              title="Re-apply this processing"
            >
              Re-apply
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="processing-panel">
      <ProcessingHeader info={info} />
      {dependenciesMissing && <div className="error">{dependencyError}</div>}
      <EditableForm
        key={`processing:${oid}:${valuesKey}`}
        schema={info.schema}
        values={persistentValues}
        transientValues={transientValues}
        onApply={apply}
        resolveChoices={dependenciesMissing ? undefined : resolveChoices}
        resolveCallbacks={dependenciesMissing ? undefined : resolveCallbacks}
        resolveActive={dependenciesMissing ? undefined : resolveActive}
        autoSliders
        validateBeforeApply
        disabled={dependenciesMissing}
      />
    </div>
  );
}

function ProcessingHeader({ info }: { info: LastProcessingInfo }) {
  return (
    <div className="processing-panel-header">
      <div className="processing-panel-title">{info.label}</div>
      {info.menu_path && (
        <div className="processing-panel-path">{info.menu_path}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditableForm — shared wrapper adding "Apply" / "Reset" + dirty
// indicator on top of :class:`DataSetForm`.  Mirrors guidata's
// "DataSetEditDialog" Apply/Reset behaviour without modal blocking.
// ---------------------------------------------------------------------------

interface EditableFormProps extends Pick<
  DataSetFormProps,
  "resolveChoices" | "resolveCallbacks" | "resolveActive"
> {
  schema: SchemaWithValues["schema"];
  values: Record<string, unknown>;
  transientValues?: Record<string, unknown>;
  onApply: (values: Record<string, unknown>) => Promise<void>;
  initialError?: string | null;
  autoSliders?: boolean;
  validateBeforeApply?: boolean;
  disabled?: boolean;
}

function EditableForm({
  schema,
  values,
  transientValues,
  onApply,
  initialError = null,
  resolveChoices,
  resolveCallbacks,
  resolveActive,
  autoSliders = false,
  validateBeforeApply = false,
  disabled = false,
}: EditableFormProps) {
  // Snapshot of the values that are currently committed in Python.
  // Anything different from this counts as "unsaved".
  const initialValues = { ...values, ...transientValues };
  const [appliedValues, setAppliedValues] = useState(initialValues);
  const [draft, setDraft] = useState(initialValues);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [formState, setFormState] = useState({
    valid: validateDataSetValues(schema, values),
    resolving: false,
  });
  const formRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!transientValues) return;
    const mergeLatestContext = (current: Record<string, unknown>) => ({
      ...stripTransientValues(schema, current),
      ...transientValues,
    });
    setAppliedValues(mergeLatestContext);
    setDraft(mergeLatestContext);
  }, [schema, transientValues]);

  const dirty = useMemo(
    () => !valuesEqual(draft, appliedValues),
    [draft, appliedValues],
  );
  const invalid = validateBeforeApply && !formState.valid;
  const resolving = validateBeforeApply && formState.resolving;

  const handleApply = useCallback(async () => {
    if (disabled || !dirty || busy || invalid || resolving) return;
    setBusy(true);
    setError(null);
    try {
      await onApply(draft);
      setAppliedValues(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [disabled, dirty, busy, draft, invalid, onApply, resolving]);

  const handleReset = useCallback(() => {
    setDraft(appliedValues);
    setError(null);
  }, [appliedValues]);

  // Ctrl+Enter / Cmd+Enter inside the form triggers Apply.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void handleApply();
      }
    },
    [handleApply],
  );

  return (
    <div className="side-panel-form" ref={formRef} onKeyDown={handleKeyDown}>
      {error && <div className="error">{error}</div>}
      <fieldset className="editable-form-fields" disabled={disabled}>
        <DataSetForm
          schema={schema}
          values={draft}
          onChange={setDraft}
          resolveChoices={resolveChoices}
          resolveCallbacks={resolveCallbacks}
          resolveActive={resolveActive}
          autoSliders={autoSliders}
          onStateChange={validateBeforeApply ? setFormState : undefined}
        />
      </fieldset>
      <div
        className={
          "editable-form-footer" + (dirty ? " editable-form-dirty" : "")
        }
      >
        <span className="editable-form-status" aria-live="polite">
          {busy
            ? "Applying…"
            : disabled
              ? t("Processing unavailable")
              : resolving
                ? t("Updating parameters…")
                : invalid
                  ? t("Invalid parameters")
                  : dirty
                    ? "● Unsaved changes"
                    : "All changes applied"}
        </span>
        <div className="editable-form-buttons">
          <button
            type="button"
            className="editable-form-reset"
            onClick={handleReset}
            disabled={disabled || !dirty || busy || resolving}
            title="Discard unapplied changes"
          >
            Reset
          </button>
          <button
            type="button"
            className="editable-form-apply"
            onClick={() => void handleApply()}
            disabled={disabled || !dirty || busy || invalid || resolving}
            title="Apply changes (Ctrl+Enter)"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

/** Cheap deep-equality for plain JSON values — schema values are
 *  always serialisable so :func:`JSON.stringify` is sufficient and
 *  avoids pulling a third-party comparator. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function extractTransientValues(
  schema: SchemaWithValues["schema"],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const persistent = stripTransientValues(schema, values);
  return Object.fromEntries(
    Object.entries(values).filter(([name]) => !(name in persistent)),
  );
}

// ---------------------------------------------------------------------------
// Results tab (TableResult / GeometryResult viewer)
// ---------------------------------------------------------------------------

interface ResultsPanelProps {
  results: AnalysisResult[];
  onClear: (key: string | null) => void;
}

function ResultsPanel({ results, onClear }: ResultsPanelProps) {
  if (results.length === 0) {
    return (
      <div className="side-panel-empty">
        No analysis result yet. Use the <em>Analysis</em> menu to compute one.
      </div>
    );
  }
  return (
    <div className="results-panel">
      <div className="results-panel-toolbar">
        <button
          className="results-clear-all"
          type="button"
          onClick={() => onClear(null)}
          title="Remove every analysis result from this signal"
        >
          Clear all results
        </button>
      </div>
      {results.map((r) => (
        <ResultCard
          key={r.metadata_key}
          result={r}
          onRemove={() => onClear(r.metadata_key)}
        />
      ))}
    </div>
  );
}

function ResultCard({
  result,
  onRemove,
}: {
  result: AnalysisResult;
  onRemove: () => void;
}) {
  // Both categories now render the same way: a header row + one data row
  // per coordinate / table row, with an optional leading ROI column.
  // Geometry results expose their Qt-aligned displayed values in
  // ``data`` (e.g. a single Δx column for a segment); fall back to the
  // raw ``coords`` for legacy payloads that predate that field.
  const rows: (number | string | null)[][] =
    result.category === "table" ? result.data : (result.data ?? result.coords);
  return (
    <div className="result-card">
      <div className="result-card-header">
        <span className="result-card-title">{result.title}</span>
        <button
          type="button"
          className="result-card-remove"
          onClick={onRemove}
          title="Remove this result"
          aria-label="Remove this result"
        >
          ×
        </button>
      </div>
      <table className="result-card-table">
        <thead>
          <tr>
            {result.roi_indices && <th>ROI</th>}
            {result.headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {result.roi_indices && (
                <td>
                  {result.roi_indices[ri] === -1 ? "—" : result.roi_indices[ri]}
                </td>
              )}
              {row.map((cell, ci) => (
                <td key={ci}>{formatCell(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: number | string | null): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return String(v);
  const abs = Math.abs(v);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) return v.toExponential(3);
  return Number(v.toPrecision(5)).toString();
}
