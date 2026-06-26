/**
 * Generic cancellable progress dialog, mirroring DataLab Qt's
 * ``QProgressDialog`` behaviour: the dialog only becomes visible
 * after ``minDuration`` (default 400 ms) has elapsed, so short
 * operations don't flash a modal at the user.
 *
 * A single :class:`ProgressProvider` is mounted near the application
 * root (see ``src/main.tsx``) and exposes :func:`useProgress`, which
 * returns a ``runWithProgress`` function. Callers describe a sequence
 * of asynchronous steps; the hook iterates over them, updates the
 * bar, and surfaces a Cancel button that aborts the iteration at the
 * next step boundary.
 *
 * Example usage::
 *
 *     const runWithProgress = useProgress();
 *     const { results, cancelled } = await runWithProgress({
 *       title: "Opening files…",
 *       total: files.length,
 *       step: async (i, { signal, setLabel }) => {
 *         setLabel(files[i].name);
 *         return await openOne(files[i], signal);
 *       },
 *     });
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t } from "../i18n/translate";

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

export interface ProgressStepContext {
  /** Aborted when the user clicks Cancel. */
  signal: AbortSignal;
  /** Update the secondary label shown under the progress bar. */
  setLabel: (label: string) => void;
}

export interface ProgressOptions<T> {
  title: string;
  /** Total number of steps. Used both for the bar and the iteration. */
  total: number;
  /**
   * Per-step worker. Receives the step index (0-based) and a context
   * with an :class:`AbortSignal` plus a label setter. Throw to abort.
   */
  step: (index: number, ctx: ProgressStepContext) => Promise<T>;
  /**
   * Minimum elapsed milliseconds before the dialog becomes visible.
   * Mirrors ``QProgressDialog.setMinimumDuration``. Defaults to 400.
   */
  minDuration?: number;
  /** Show the Cancel button. Defaults to ``true``. */
  cancellable?: boolean;
  /**
   * Render an indeterminate (animated) bar with no count/percentage, for
   * a single opaque operation whose progress cannot be measured (e.g. one
   * long Sigima call). Defaults to ``false``.
   */
  indeterminate?: boolean;
  /** Initial secondary label (shown under the progress bar). */
  initialLabel?: string;
}

export interface ProgressResult<T> {
  /** Successful per-step results, in order. Length may be < total on cancel. */
  results: T[];
  /** ``true`` if the user clicked Cancel before completion. */
  cancelled: boolean;
}

export type RunWithProgressFn = <T>(
  options: ProgressOptions<T>,
) => Promise<ProgressResult<T>>;

// ---------------------------------------------------------------------
// Internal state shape
// ---------------------------------------------------------------------

interface ProgressState {
  title: string;
  value: number;
  total: number;
  label: string;
  cancellable: boolean;
  indeterminate: boolean;
  onCancel: () => void;
}

// ---------------------------------------------------------------------
// Presentational dialog
// ---------------------------------------------------------------------

interface ProgressDialogProps {
  state: ProgressState;
}

/** Pure presentational progress dialog. */
export function ProgressDialog({ state }: ProgressDialogProps) {
  const { title, value, total, label, cancellable, indeterminate, onCancel } =
    state;
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  useEffect(() => {
    if (!cancellable) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cancellable, onCancel]);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card progress-dialog">
        <h2>{title}</h2>
        <div
          className="progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={indeterminate ? undefined : total}
          aria-valuenow={indeterminate ? undefined : value}
        >
          {indeterminate ? (
            <div className="progress-bar-fill indeterminate" />
          ) : (
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          )}
        </div>
        {!indeterminate && (
          <div className="progress-meta">
            <span className="progress-count">
              {value} / {total}
            </span>
            <span className="progress-pct">{pct}%</span>
          </div>
        )}
        {label && <p className="progress-label">{label}</p>}
        {cancellable && (
          <div className="actions">
            <button onClick={onCancel}>{t("Cancel")}</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Provider + hook
// ---------------------------------------------------------------------

const ProgressContext = createContext<RunWithProgressFn | null>(null);

export function ProgressProvider(props: { children: ReactNode }) {
  const [state, setState] = useState<ProgressState | null>(null);
  // Keep latest state in a ref so the runWithProgress closure can mutate
  // without being re-created on every render of consumers.
  const stateRef = useRef<ProgressState | null>(null);
  stateRef.current = state;

  const runWithProgress = useCallback<RunWithProgressFn>(async (options) => {
    const {
      title,
      total,
      step,
      minDuration = 400,
      cancellable = true,
      indeterminate = false,
      initialLabel = "",
    } = options;

    const controller = new AbortController();
    const results: unknown[] = [];
    let visible = false;
    let labelText = initialLabel;
    const current: ProgressState = {
      title,
      value: 0,
      total,
      label: labelText,
      cancellable,
      indeterminate,
      onCancel: () => controller.abort(),
    };

    const showTimer = window.setTimeout(() => {
      visible = true;
      setState({ ...current });
    }, minDuration);

    const refresh = () => {
      if (visible) setState({ ...current });
    };

    try {
      for (let i = 0; i < total; i++) {
        if (controller.signal.aborted) break;
        const ctx: ProgressStepContext = {
          signal: controller.signal,
          setLabel: (l: string) => {
            labelText = l;
            current.label = l;
            refresh();
          },
        };
        try {
          const r = await step(i, ctx);
          results.push(r);
        } catch (err) {
          if (controller.signal.aborted) break;
          throw err;
        }
        current.value = i + 1;
        refresh();
      }
    } finally {
      window.clearTimeout(showTimer);
      setState(null);
    }

    return {
      results: results as never[],
      cancelled: controller.signal.aborted,
    };
  }, []);

  const value = useMemo(() => runWithProgress, [runWithProgress]);

  return (
    <ProgressContext.Provider value={value}>
      {props.children}
      {state && <ProgressDialog state={state} />}
    </ProgressContext.Provider>
  );
}

export function useProgress(): RunWithProgressFn {
  const ctx = useContext(ProgressContext);
  if (!ctx) {
    throw new Error("useProgress must be used within a ProgressProvider");
  }
  return ctx;
}
