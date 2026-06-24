/**
 * Themed in-app dialogs (confirm / message / prompt) replacing the
 * native ``window.confirm`` / ``window.alert`` / ``window.prompt``
 * popups that don't match the rest of the UI.
 *
 * A single :class:`DialogProvider` is mounted near the application
 * root (see ``src/main.tsx``) and exposes three imperative hooks:
 *
 * - :func:`useConfirm`  — yes/no confirmation, returns ``Promise<boolean>``
 * - :func:`useMessage`  — info/warning/error alert, returns ``Promise<void>``
 * - :func:`usePrompt`   — single-line text input, returns ``Promise<string | null>``
 *
 * Multiple requests are queued FIFO so only one dialog is visible at a
 * time. Note: the historical filename ``ConfirmDialog.tsx`` is kept to
 * minimise churn — the file now hosts all three dialog kinds.
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
// Confirm
// ---------------------------------------------------------------------

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Visually mark the confirm button as destructive (red). */
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmDialogProps {
  options: ConfirmOptions;
  onAnswer: (ok: boolean) => void;
}

/** Pure presentational confirmation dialog. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { options, onAnswer } = props;
  const {
    message,
    title,
    confirmLabel = t("OK"),
    cancelLabel = t("Cancel"),
    destructive = false,
  } = options;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(false);
      else if (e.key === "Enter") onAnswer(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAnswer]);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card">
        <h2>{title || t("Confirm")}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
        <div className="actions">
          <button onClick={() => onAnswer(false)}>{cancelLabel}</button>
          <button
            onClick={() => onAnswer(true)}
            className={destructive ? "danger" : undefined}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Message (info / warning / error alert)
// ---------------------------------------------------------------------

export type MessageKind = "info" | "warning" | "error";

export interface MessageOptions {
  message: string;
  /** Defaults to ``"info"``. */
  kind?: MessageKind;
  title?: string;
  closeLabel?: string;
}

interface PendingMessage extends MessageOptions {
  resolve: () => void;
}

interface MessageDialogProps {
  options: MessageOptions;
  onClose: () => void;
}

const HEADING_BY_KIND: Record<MessageKind, string> = {
  info: "Information",
  warning: "Warning",
  error: "Error",
};

/** Pure presentational alert dialog. */
export function MessageDialog(props: MessageDialogProps) {
  const { options, onClose } = props;
  const { message, kind = "info", title, closeLabel = t("OK") } = options;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{title || t(HEADING_BY_KIND[kind])}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
        <div className="actions">
          <button onClick={onClose} autoFocus>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Processing error (rich, copy-pasteable traceback + tip)
// ---------------------------------------------------------------------

export interface ProcessingErrorOptions {
  /** Context line, e.g. ``"Computing: Gamma correction"``. */
  context: string;
  /** Full Python traceback, shown verbatim and copy-pasteable. */
  traceback: string;
  /** Optional override of the default computation tip. */
  tip?: string;
  /** Optional dialog heading; defaults to ``"Error"``. */
  title?: string;
}

interface PendingProcessingError extends ProcessingErrorOptions {
  resolve: () => void;
}

interface ProcessingErrorDialogProps {
  options: ProcessingErrorOptions;
  onClose: () => void;
}

/** Pure presentational error dialog mirroring DataLab desktop's
 *  ``WarningErrorMessageBox``: a context line, the full traceback in a
 *  selectable / copyable block, and a tip explaining that computation
 *  errors are usually caused by the data or parameters. */
export function ProcessingErrorDialog(props: ProcessingErrorDialogProps) {
  const { options, onClose } = props;
  const { context, traceback, tip, title } = options;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(traceback);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard failures (permission denied, etc.)
    }
  };
  const tipText =
    tip ??
    t(
      "DataLab relies on various libraries to perform the computation. During the computation, errors may occur because of the data (e.g. division by zero, unexpected data type, etc.) or because of the libraries (e.g. memory error, etc.). If you encounter an error, before reporting it, please ensure that the computation is correct, by checking the data and the parameters.",
    );
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="card processing-error-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title || t("Error")}</h2>
        <div className="processing-error-context">
          <p>{t("An error has occurred during the following context:")}</p>
          <p>
            <strong>{context}</strong>
          </p>
        </div>
        <div className="processing-error-traceback">
          <div className="processing-error-traceback-head">
            <span>
              {t("The following traceback may help to understand the problem:")}
            </span>
            <button type="button" onClick={handleCopy}>
              {copied ? t("Copied") : t("Copy")}
            </button>
          </div>
          <pre>{traceback}</pre>
        </div>
        <div className="processing-error-tip">
          <p>{tipText}</p>
        </div>
        <div className="actions">
          <button onClick={onClose} autoFocus>
            {t("OK")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Prompt (single-line text input)
// ---------------------------------------------------------------------

export interface PromptOptions {
  message: string;
  title?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
}

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void;
}

interface PromptDialogProps {
  options: PromptOptions;
  onAnswer: (value: string | null) => void;
}

/** Pure presentational text-input dialog. */
export function PromptDialog(props: PromptDialogProps) {
  const { options, onAnswer } = props;
  const {
    message,
    title,
    defaultValue = "",
    confirmLabel = t("OK"),
    cancelLabel = t("Cancel"),
    placeholder,
  } = options;
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Select the default text so users can quickly overwrite it.
    inputRef.current?.select();
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAnswer]);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card">
        <h2>{title || t("Input")}</h2>
        <p style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>{message}</p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAnswer(value);
            }
          }}
          style={{ width: "100%", boxSizing: "border-box" }}
          autoFocus
        />
        <div className="actions">
          <button onClick={() => onAnswer(null)}>{cancelLabel}</button>
          <button onClick={() => onAnswer(value)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Provider + hooks
// ---------------------------------------------------------------------

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
type MessageFn = (options: MessageOptions) => Promise<void>;
type PromptFn = (options: PromptOptions) => Promise<string | null>;
type ProcessingErrorFn = (options: ProcessingErrorOptions) => Promise<void>;

interface DialogContextValue {
  confirm: ConfirmFn;
  message: MessageFn;
  prompt: PromptFn;
  processingError: ProcessingErrorFn;
}

const DialogContext = createContext<DialogContextValue | null>(null);

type AnyPending =
  | ({ _kind: "confirm" } & PendingConfirm)
  | ({ _kind: "message" } & PendingMessage)
  | ({ _kind: "processingError" } & PendingProcessingError)
  | ({ _kind: "prompt" } & PendingPrompt);

/**
 * Provider mounted near the application root. Hosts a single FIFO
 * queue shared by all three dialog kinds, so only one dialog is ever
 * visible at a time.
 */
export function DialogProvider(props: { children: ReactNode }) {
  const [queue, setQueue] = useState<AnyPending[]>([]);
  const current = queue[0];
  const popQueue = useCallback(() => {
    setQueue((q) => q.slice(1));
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setQueue((q) => [...q, { _kind: "confirm", ...options, resolve }]);
    });
  }, []);
  const message = useCallback<MessageFn>((options) => {
    return new Promise<void>((resolve) => {
      setQueue((q) => [...q, { _kind: "message", ...options, resolve }]);
    });
  }, []);
  const processingError = useCallback<ProcessingErrorFn>((options) => {
    return new Promise<void>((resolve) => {
      setQueue((q) => [
        ...q,
        { _kind: "processingError", ...options, resolve },
      ]);
    });
  }, []);
  const prompt = useCallback<PromptFn>((options) => {
    return new Promise<string | null>((resolve) => {
      setQueue((q) => [...q, { _kind: "prompt", ...options, resolve }]);
    });
  }, []);

  const value = useMemo<DialogContextValue>(
    () => ({ confirm, message, prompt, processingError }),
    [confirm, message, prompt, processingError],
  );

  return (
    <DialogContext.Provider value={value}>
      {props.children}
      {current?._kind === "confirm" && (
        <ConfirmDialog
          options={current}
          onAnswer={(ok) => {
            current.resolve(ok);
            popQueue();
          }}
        />
      )}
      {current?._kind === "message" && (
        <MessageDialog
          options={current}
          onClose={() => {
            current.resolve();
            popQueue();
          }}
        />
      )}
      {current?._kind === "processingError" && (
        <ProcessingErrorDialog
          options={current}
          onClose={() => {
            current.resolve();
            popQueue();
          }}
        />
      )}
      {current?._kind === "prompt" && (
        <PromptDialog
          options={current}
          onAnswer={(v) => {
            current.resolve(v);
            popQueue();
          }}
        />
      )}
    </DialogContext.Provider>
  );
}

function useDialogs(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    throw new Error("useDialogs must be used within a DialogProvider");
  }
  return ctx;
}

export function useConfirm(): ConfirmFn {
  return useDialogs().confirm;
}

export function useMessage(): MessageFn {
  return useDialogs().message;
}

export function useProcessingError(): ProcessingErrorFn {
  return useDialogs().processingError;
}

export function usePrompt(): PromptFn {
  return useDialogs().prompt;
}
