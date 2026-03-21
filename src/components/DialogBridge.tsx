/**
 * DialogBridge — services async dialog requests coming from Python
 * (via {@link SigimaRuntime.setDialogHandler}).
 *
 * Three request kinds are handled:
 *   - ``"edit_dataset"`` → opens a {@link DataSetDialog} and resolves
 *     with the edited values dict (or ``null`` on cancel — Python side
 *     turns that into ``False``).
 *   - ``"message"``      → simple info/warning/error popup.
 *   - ``"confirm"``      → yes/no/cancel dialog.
 *
 * All open requests are queued: only one dialog at a time, requests
 * are processed FIFO.
 */

import { useEffect, useState } from "react";
import { DataSetDialog } from "./DataSetDialog";
import { useSigima } from "../sigima/SigimaContext";
import type { SchemaWithValues } from "../sigima/runtime";

type DialogKind = "edit_dataset" | "message" | "confirm";

interface PendingRequest {
  kind: DialogKind;
  payload: Record<string, unknown>;
  resolve: (value: unknown) => void;
}

export function DialogBridge() {
  const { runtime } = useSigima();
  const [queue, setQueue] = useState<PendingRequest[]>([]);

  useEffect(() => {
    if (!runtime) return;
    runtime.setDialogHandler(async (kind, payload) => {
      return new Promise<unknown>((resolve) => {
        setQueue((q) => [
          ...q,
          {
            kind: kind as DialogKind,
            payload: (payload ?? {}) as Record<string, unknown>,
            resolve,
          },
        ]);
      });
    });
    return () => runtime.setDialogHandler(null);
  }, [runtime]);

  const current = queue[0];
  if (!current) return null;

  const finish = (value: unknown) => {
    current.resolve(value);
    setQueue((q) => q.slice(1));
  };

  if (current.kind === "edit_dataset") {
    const payload = current.payload as unknown as SchemaWithValues & {
      title?: string;
    };
    return (
      <DataSetDialog
        title={payload.title ?? "Edit parameters"}
        payload={payload}
        onSubmit={(values) => finish(values)}
        onCancel={() => finish(null)}
      />
    );
  }

  if (current.kind === "message") {
    return (
      <MessageDialog
        kind={String(current.payload.kind ?? "info")}
        message={String(current.payload.message ?? "")}
        title={String(current.payload.title ?? "")}
        onClose={() => finish(null)}
      />
    );
  }

  if (current.kind === "confirm") {
    return (
      <ConfirmDialog
        message={String(current.payload.message ?? "")}
        title={String(current.payload.title ?? "")}
        cancelable={Boolean(current.payload.cancelable)}
        onAnswer={(answer) => finish(answer)}
      />
    );
  }
  return null;
}

function MessageDialog(props: {
  kind: string;
  message: string;
  title: string;
  onClose: () => void;
}) {
  const { kind, message, title, onClose } = props;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  const heading =
    title || (kind === "error" ? "Error" : kind === "warning" ? "Warning" : "Information");
  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{heading}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
        <div className="actions">
          <button onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog(props: {
  message: string;
  title: string;
  cancelable: boolean;
  onAnswer: (value: boolean | null) => void;
}) {
  const { message, title, cancelable, onAnswer } = props;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(cancelable ? null : false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onAnswer, cancelable]);
  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="card">
        <h2>{title || "Confirm"}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{message}</p>
        <div className="actions">
          {cancelable && (
            <button onClick={() => onAnswer(null)}>Cancel</button>
          )}
          <button onClick={() => onAnswer(false)}>No</button>
          <button onClick={() => onAnswer(true)}>Yes</button>
        </div>
      </div>
    </div>
  );
}
