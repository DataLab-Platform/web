// Copyright (c) DataLab Platform Developers, BSD 3-Clause License
// See LICENSE file for details
/**
 * Lightweight non-modal toast notifications.
 *
 * Unlike :func:`useMessage` (a blocking modal dialog from
 * ``ConfirmDialog``), toasts are transient, non-blocking status messages
 * that stack in a corner and auto-dismiss after a few seconds. A single
 * :class:`ToastProvider` is mounted near the application root (see
 * ``src/main.tsx``) and exposes :func:`useToast`, returning a ``push``
 * function.
 *
 * Primary use case: save/export feedback on the *download-fallback* path,
 * where the file lands silently in the browser's Downloads folder and the
 * user would otherwise have no indication of where it went.
 *
 * Example usage::
 *
 *     const pushToast = useToast();
 *     pushToast({ kind: "success", message: "Saved report.csv" });
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { t } from "../i18n/translate";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  message: string;
  /** Visual accent. Defaults to ``"info"``. */
  kind?: ToastKind;
  /** Auto-dismiss delay in milliseconds. Defaults to 5000. */
  duration?: number;
}

export type PushToastFn = (options: ToastOptions) => void;

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const ToastContext = createContext<PushToastFn | null>(null);

const DEFAULT_DURATION_MS = 5000;

export function ToastProvider(props: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<PushToastFn>(
    (options) => {
      const id = nextId.current++;
      const item: ToastItem = {
        id,
        message: options.message,
        kind: options.kind ?? "info",
      };
      setToasts((list) => [...list, item]);
      const duration = options.duration ?? DEFAULT_DURATION_MS;
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

interface ToastHostProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

/** Pure presentational toast stack. The live region stays mounted so
 *  screen readers reliably announce newly appended toasts. */
function ToastHost({ toasts, onDismiss }: ToastHostProps) {
  return (
    <div
      className="toast-host"
      role="region"
      aria-live="polite"
      aria-label={t("Notifications")}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          role="status"
        >
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label={t("Dismiss")}
            onClick={() => onDismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function useToast(): PushToastFn {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
