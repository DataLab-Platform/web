import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { getRootIconUrl } from "../assets/rootIcons";
import { t } from "../i18n/translate";
import { useRuntime } from "../runtime/RuntimeContext";
import type {
  PluginInstrumentAcquisition,
  PluginInstrumentFrame,
  PluginInstrumentSession,
} from "../runtime/runtime";
import { DataSetForm, stripTransientValues } from "./DataSetForm";

const InstrumentPlot = lazy(() => import("./InstrumentPlot"));

/** Delay between a settings change and the refresh of the view. */
const REFRESH_DELAY_MS = 150;

interface Props {
  pluginId: string;
  toolId: string;
  onAcquired: (result: PluginInstrumentAcquisition) => void | Promise<void>;
  onClose: () => void;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Window of a plugin instrument: live view on the left, settings on the
 * right. The view is refreshed when settings change, and periodically in
 * live mode; each acquisition is added to the workspace in a new group.
 */
export function InstrumentWindow({
  pluginId,
  toolId,
  onAcquired,
  onClose,
}: Props) {
  const { runtime } = useRuntime();
  const [session, setSession] = useState<PluginInstrumentSession | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [valid, setValid] = useState(true);
  const [frame, setFrame] = useState<PluginInstrumentFrame | null>(null);
  const [live, setLive] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // One preview at a time; a request made meanwhile runs right after it.
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    runtime
      .openPluginInstrument(pluginId, toolId)
      .then((opened) => {
        if (cancelled) return;
        setSession(opened);
        setValues(opened.settings.values);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [pluginId, runtime, toolId]);

  const settingsValues = useCallback(
    () =>
      session
        ? stripTransientValues(session.settings.schema, valuesRef.current)
        : {},
    [session],
  );

  const refresh = useCallback(async () => {
    if (!runtime || !session) return;
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }
    inFlightRef.current = true;
    try {
      const next = await runtime.previewPluginInstrument(
        pluginId,
        toolId,
        settingsValues(),
      );
      if (!mountedRef.current) return;
      setFrame(next);
      setError(null);
    } catch (reason) {
      if (mountedRef.current) setError(errorMessage(reason));
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current && mountedRef.current) {
        pendingRef.current = false;
        void refresh();
      }
    }
  }, [pluginId, runtime, session, settingsValues, toolId]);

  // Settings changes refresh the view once they settle.
  useEffect(() => {
    if (!session || !valid) return;
    const timer = window.setTimeout(() => void refresh(), REFRESH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [refresh, session, valid, values]);

  // Live mode: a new frame every period, skipped while one is computed.
  useEffect(() => {
    if (!live || !session || !valid) return;
    const timer = window.setInterval(() => {
      if (!inFlightRef.current) void refresh();
    }, session.live_interval_ms);
    return () => window.clearInterval(timer);
  }, [live, refresh, session, valid]);

  const acquire = async () => {
    if (!runtime || !session) return;
    setAcquiring(true);
    setError(null);
    setStatus(null);
    try {
      const result = await runtime.acquirePluginInstrument(
        pluginId,
        toolId,
        settingsValues(),
      );
      await onAcquired(result);
      if (mountedRef.current) {
        setStatus(
          t("{count} objects added to group '{group}'", {
            count: result.object_ids.length,
            group: result.group_title,
          }),
        );
      }
    } catch (reason) {
      if (mountedRef.current) setError(errorMessage(reason));
    } finally {
      if (mountedRef.current) setAcquiring(false);
    }
  };

  const title = session?.title ?? t("Instrument");
  return (
    <div className="instrument-window-layer" role="dialog" aria-label={title}>
      <div className="card instrument-window">
        <header className="applications-header">
          <div className="applications-header-title">
            <h2>{title}</h2>
          </div>
          <button
            className="dialog-close-button"
            onClick={onClose}
            aria-label={t("Close")}
            title={t("Close")}
          >
            ×
          </button>
        </header>
        <div className="instrument-window-body">
          <section className="instrument-view" aria-label={t("Live view")}>
            <div className="instrument-plot">
              {frame && (
                <Suspense fallback={null}>
                  <InstrumentPlot
                    frame={frame}
                    revision={`${pluginId}:${toolId}`}
                  />
                </Suspense>
              )}
            </div>
            <p className="instrument-summary">{frame?.summary ?? ""}</p>
          </section>
          <section className="instrument-settings">
            <div className="instrument-form">
              {session && (
                <DataSetForm
                  schema={session.settings.schema}
                  values={values}
                  onChange={setValues}
                  resolveActive={(current) =>
                    runtime!.resolvePluginInstrumentActive(
                      pluginId,
                      toolId,
                      current,
                    )
                  }
                  onStateChange={(state) => setValid(state.valid)}
                />
              )}
            </div>
            {!valid && <div className="error">{t("Invalid settings")}</div>}
            {error && <div className="error">{error}</div>}
            {status && <div className="applications-status">{status}</div>}
            <div className="instrument-commands">
              <button
                type="button"
                aria-pressed={live}
                className={live ? "active" : ""}
                onClick={() => setLive(!live)}
                disabled={!session}
                title={t("Refresh the view continuously")}
              >
                <img src={getRootIconUrl("refresh-auto.svg")} alt="" />
                {t("Live")}
              </button>
              <button
                type="button"
                onClick={() => void acquire()}
                disabled={!session || !valid || acquiring}
                title={t("Add an acquisition to the workspace, in a new group")}
              >
                <img src={getRootIconUrl("record.svg")} alt="" />
                {acquiring ? t("Acquiring…") : t("Acquire")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
