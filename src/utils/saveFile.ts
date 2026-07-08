// Copyright (c) DataLab Platform Developers, BSD 3-Clause License
// See LICENSE file for details
/**
 * Single-file save helper.
 *
 * Prefers the File System Access API (``window.showSaveFilePicker``)
 * available on Chromium-based browsers, letting the user choose the
 * destination folder, filename and extension in a native "Save as…"
 * dialog — the closest browser equivalent to DataLab desktop's save
 * dialog. Falls back to the classic ``<a download>`` pattern (the
 * browser's Downloads folder) on Firefox / Safari, or when the picker is
 * unavailable or blocked.
 *
 * Pure module (no React) so it stays unit-testable without a DOM harness.
 * Callers own the user feedback: inspect the returned {@link SaveFileResult}
 * and surface a toast when ``outcome === "downloaded"`` (the file lands
 * silently in Downloads and the user would otherwise not know where).
 */

/** A File System Access API accept-type descriptor. */
export interface SaveFileTypeAccept {
  /** Human-readable label shown in the picker's type dropdown. */
  description: string;
  /** MIME type → list of extensions (each starting with a dot). */
  accept: Record<string, string[]>;
}

export type SaveOutcome = "saved" | "downloaded" | "cancelled";

export interface SaveFileResult {
  /**
   * - ``"saved"``: written on disk through the native picker.
   * - ``"downloaded"``: handed to the browser's Downloads folder.
   * - ``"cancelled"``: the user dismissed the native picker.
   */
  outcome: SaveOutcome;
  /** Final filename (``handle.name`` when picked, else the suggestion). */
  filename: string;
}

interface FileSystemWritableStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  readonly name: string;
  createWritable(): Promise<FileSystemWritableStreamLike>;
}

interface ShowSaveFilePickerOptions {
  suggestedName?: string;
  types?: SaveFileTypeAccept[];
}

/** ``true`` when the native single-file save picker is available. */
export function supportsSaveFilePicker(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as unknown as { showSaveFilePicker?: unknown })
      .showSaveFilePicker === "function"
  );
}

/**
 * Open the native "Save as…" picker. Returns the chosen file handle, or
 * ``null`` when the user cancels (or the picker is unavailable). Rethrows
 * any other error.
 */
export async function pickSaveFile(
  suggestedName: string,
  types?: SaveFileTypeAccept[],
): Promise<FileSystemFileHandleLike | null> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (
        opts?: ShowSaveFilePickerOptions,
      ) => Promise<FileSystemFileHandleLike>;
    }
  ).showSaveFilePicker;
  if (typeof picker !== "function") return null;
  try {
    // Must be invoked with ``window`` as receiver — a bare call throws
    // ``TypeError: Illegal invocation`` in Chromium (same constraint as
    // ``showDirectoryPicker`` in ``pickDirectory.ts``).
    return await picker.call(window, { suggestedName, types });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Write *bytes* to an already-picked file handle. */
export async function writeBytesToHandle(
  handle: FileSystemFileHandleLike,
  bytes: Uint8Array,
): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(new Blob([new Uint8Array(bytes)]));
  await writable.close();
}

/**
 * Trigger a browser download of *bytes* under *filename* via the
 * ``<a download>`` pattern (no server round-trip). No-ops safely when
 * ``URL.createObjectURL`` is missing (jsdom) but still calls a spy if one
 * is installed.
 */
export function downloadBytes(
  bytes: Uint8Array,
  filename: string,
  mime = "application/octet-stream",
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([new Uint8Array(bytes)], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
  }
}

/**
 * Save fixed content *bytes* to a file. Uses the native picker when
 * available (``outcome: "saved"``); otherwise downloads to the browser's
 * Downloads folder (``outcome: "downloaded"``). Returns
 * ``outcome: "cancelled"`` when the user dismisses the native picker.
 *
 * For variable-extension writers (where the chosen extension drives the
 * serialiser, e.g. signals/images) use {@link pickSaveFile} +
 * {@link writeBytesToHandle} directly so the bytes are produced *after*
 * the user picks a name.
 */
export async function saveBytesToFile(
  bytes: Uint8Array,
  suggestedName: string,
  types?: SaveFileTypeAccept[],
  mime = "application/octet-stream",
): Promise<SaveFileResult> {
  if (supportsSaveFilePicker()) {
    const handle = await pickSaveFile(suggestedName, types);
    if (!handle) return { outcome: "cancelled", filename: suggestedName };
    await writeBytesToHandle(handle, bytes);
    return { outcome: "saved", filename: handle.name };
  }
  downloadBytes(bytes, suggestedName, mime);
  return { outcome: "downloaded", filename: suggestedName };
}

/** Build a File System Access API accept-type from a list of extensions. */
export function acceptFromExtensions(
  description: string,
  extensions: string[],
  mime = "application/octet-stream",
): SaveFileTypeAccept {
  return {
    description,
    accept: {
      [mime]: extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)),
    },
  };
}
