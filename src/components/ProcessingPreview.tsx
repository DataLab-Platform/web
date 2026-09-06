import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { t } from "../i18n/translate";
import {
  ProcessingPreviewController,
  type ProcessingPreviewState,
} from "../runtime/ProcessingPreviewController";
import type { FeatureDescriptor, RuntimeApi } from "../runtime/runtime";

const ProcessingPreviewPlot = lazy(() => import("./ProcessingPreviewPlot"));

interface Props {
  runtime: RuntimeApi;
  feature: FeatureDescriptor;
  sourceIds: string[];
  values: Record<string, unknown>;
  valid: boolean;
  resolving: boolean;
  dragging: boolean;
}

export interface ProcessingPreviewHandle {
  stop: () => void;
}

interface SourceOption {
  id: string;
  label: string;
}

export const ProcessingPreview = forwardRef<ProcessingPreviewHandle, Props>(
  function ProcessingPreview(props, ref) {
    const { runtime, feature, sourceIds, values, valid, resolving, dragging } =
      props;
    const [enabled, setEnabled] = useState(false);
    const [sourceId, setSourceId] = useState(sourceIds[0] ?? "");
    const [sources, setSources] = useState<SourceOption[]>(() =>
      sourceIds.map((id) => ({ id, label: id })),
    );
    const [state, setState] = useState<ProcessingPreviewState>({
      status: "idle",
    });
    const [sourceRevision, setSourceRevision] = useState(0);
    const [result, setResult] = useState<
      Extract<ProcessingPreviewState, { status: "result" }>["result"] | null
    >(null);
    const mountedRef = useRef(true);
    const enabledRef = useRef(false);
    const timerRef = useRef<number | null>(null);
    const draggingRef = useRef(dragging);
    const previousDraggingRef = useRef(dragging);
    const dirtySinceDispatchRef = useRef(false);
    const lastDispatchAtRef = useRef(0);
    const immediateOnEnableRef = useRef(false);
    const requestPreviewRef = useRef<() => void>(() => undefined);
    const controller = useMemo(
      () =>
        new ProcessingPreviewController((next) => {
          if (!mountedRef.current) return;
          setState(next);
          if (next.status === "result") setResult(next.result);
        }, runtime),
      [runtime],
    );

    const stop = useCallback(() => {
      enabledRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      controller.close();
    }, [controller]);

    useImperativeHandle(ref, () => ({ stop }), [stop]);

    useEffect(() => {
      let cancelled = false;
      void Promise.all(
        sourceIds.map(async (id) => {
          try {
            const object = await runtime.getObject(id);
            return { id, label: `${id}: ${object.title}` };
          } catch {
            return { id, label: id };
          }
        }),
      ).then((options) => {
        if (!cancelled) setSources(options);
      });
      return () => {
        cancelled = true;
      };
    }, [runtime, sourceIds]);

    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        stop();
      };
    }, [stop]);

    useEffect(
      () =>
        runtime.onWorkspaceMutation(() => {
          if (!mountedRef.current || !enabledRef.current) return;
          controller.invalidateSource();
          setState((current) =>
            current.status === "result"
              ? { ...current, current: false }
              : current,
          );
          setSourceRevision((revision) => revision + 1);
        }),
      [controller, runtime],
    );

    useLayoutEffect(() => {
      if (!enabled) return;
      controller.markDirty();
      setState((current) =>
        current.status === "result" ? { ...current, current: false } : current,
      );
    }, [controller, enabled, sourceRevision, values]);

    const requestPreview = useCallback(() => {
      if (!enabledRef.current || !valid || resolving || !sourceId) return;
      controller.request({
        featureId: feature.id,
        sourceId,
        params: values,
      });
    }, [controller, feature.id, resolving, sourceId, valid, values]);

    useLayoutEffect(() => {
      requestPreviewRef.current = requestPreview;
    }, [requestPreview]);

    const clearTimer = useCallback(() => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }, []);

    const dispatchPreview = useCallback(() => {
      dirtySinceDispatchRef.current = false;
      lastDispatchAtRef.current = Date.now();
      void requestPreviewRef.current();
    }, []);

    useEffect(() => {
      if (!enabled) {
        clearTimer();
        dirtySinceDispatchRef.current = false;
        return;
      }
      dirtySinceDispatchRef.current = true;
      if (!valid) {
        clearTimer();
        controller.invalidate();
        return;
      }
      if (resolving) {
        clearTimer();
        return;
      }
      if (immediateOnEnableRef.current) {
        immediateOnEnableRef.current = false;
        clearTimer();
        dispatchPreview();
        return;
      }
      if (draggingRef.current) {
        if (timerRef.current !== null) return;
        const remaining = Math.max(
          0,
          200 - (Date.now() - lastDispatchAtRef.current),
        );
        if (remaining === 0) {
          dispatchPreview();
        } else {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            dispatchPreview();
          }, remaining);
        }
        return;
      }
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        dispatchPreview();
      }, 300);
    }, [
      clearTimer,
      controller,
      dispatchPreview,
      enabled,
      resolving,
      sourceRevision,
      sourceId,
      valid,
      values,
    ]);

    useEffect(() => {
      const wasDragging = previousDraggingRef.current;
      previousDraggingRef.current = dragging;
      draggingRef.current = dragging;
      if (
        wasDragging &&
        !dragging &&
        enabled &&
        valid &&
        !resolving &&
        dirtySinceDispatchRef.current
      ) {
        clearTimer();
        dispatchPreview();
      }
    }, [clearTimer, dispatchPreview, dragging, enabled, resolving, valid]);

    const toggle = (checked: boolean) => {
      enabledRef.current = checked;
      immediateOnEnableRef.current = checked;
      setEnabled(checked);
      controller.setEnabled(checked);
      if (!checked) {
        setState({ status: "idle" });
        setResult(null);
      }
    };

    const changeSource = (nextSourceId: string) => {
      controller.invalidate();
      setSourceId(nextSourceId);
      setState({ status: "idle" });
      setResult(null);
    };

    const status = !valid
      ? t("Invalid parameters")
      : resolving
        ? t("Updating preview…")
        : state.status === "computing"
          ? t("Computing preview…")
          : state.status === "result"
            ? state.current
              ? t("Preview up to date")
              : t("Updating preview…")
            : state.status === "error"
              ? t("Preview failed")
              : "";

    return (
      <section className="processing-preview" aria-label={t("Preview")}>
        <div className="processing-preview-toolbar">
          <label className="dataset-form-check">
            <input
              name="preview_enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => toggle(event.target.checked)}
            />
            <span>{t("Preview")}</span>
          </label>
          {sourceIds.length > 1 && (
            <label className="processing-preview-source">
              <span>{t("Preview source")}</span>
              <select
                value={sourceId}
                disabled={!enabled}
                onChange={(event) => changeSource(event.target.value)}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="processing-preview-stage">
          {result && (
            <Suspense fallback={null}>
              <ProcessingPreviewPlot result={result} />
            </Suspense>
          )}
        </div>
        <div className="processing-preview-status" aria-live="polite">
          {status}
        </div>
        {state.status === "error" && (
          <pre className="processing-preview-error">{state.error}</pre>
        )}
      </section>
    );
  },
);
