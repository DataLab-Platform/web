import type { PanelKind, RuntimeApi } from "./runtime";

export interface RemoteFile {
  name: string;
  bytes: ArrayBuffer | Uint8Array;
}

export interface RemoteFileResult {
  name: string;
  ids: string[];
  panel?: PanelKind;
  workspace?: boolean;
  error?: string;
  warning?: string;
}

export interface RemoteOpenResult {
  files: RemoteFileResult[];
  selectionError?: string;
}

interface RemoteFileCallbacks {
  getCurrentPanel?: () => string;
  selectObjects?: (ids: string[], panel: string | null) => void | Promise<void>;
  openWorkspace?: (file: RemoteFile) => Promise<string[]>;
  onModelChanged: (panel: PanelKind) => void;
  runDataImport?: <T>(operation: () => Promise<T>) => Promise<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateFiles(payload: unknown): {
  files: RemoteFile[];
  kind: PanelKind | undefined;
} {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.files) ||
    !payload.files.length
  ) {
    throw new Error("Provide at least one file.");
  }
  if (
    payload.kind !== undefined &&
    payload.kind !== "signal" &&
    payload.kind !== "image"
  ) {
    throw new Error("File kind must be 'signal' or 'image'.");
  }
  const files: RemoteFile[] = payload.files.map((file: unknown) => {
    if (
      !isRecord(file) ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name === "." ||
      file.name === ".." ||
      /[\\/\0]/.test(file.name) ||
      !(file.bytes instanceof ArrayBuffer || file.bytes instanceof Uint8Array)
    ) {
      throw new Error("Each file must have a basename and binary bytes.");
    }
    return { name: file.name, bytes: file.bytes };
  });
  return { files, kind: payload.kind };
}

function isWorkspaceFile(name: string): boolean {
  return /\.(h5|hdf5|hdf|he5|dlcapsule)$/i.test(name);
}

/** Open at most one workspace before importing the accompanying data files. */
export async function openRemoteFiles(
  runtime: RuntimeApi,
  payload: unknown,
  callbacks: RemoteFileCallbacks,
): Promise<RemoteOpenResult> {
  const { files, kind } = validateFiles(payload);
  const preferredPanel = kind ?? callbacks.getCurrentPanel?.();
  const workspaceIndices = files
    .map((file, index) => (isWorkspaceFile(file.name) ? index : -1))
    .filter((index) => index >= 0);
  if (workspaceIndices.length > 1) {
    throw new Error("Open only one workspace at a time.");
  }
  const results: RemoteFileResult[] = new Array(files.length);
  const workspaceIndex = workspaceIndices[0];
  if (workspaceIndex !== undefined) {
    const file = files[workspaceIndex];
    try {
      if (!callbacks.openWorkspace) {
        throw new Error("The DataLab workspace UI is not ready.");
      }
      const bytes =
        file.bytes instanceof Uint8Array
          ? new Uint8Array(file.bytes)
          : file.bytes.slice(0);
      const ids = await callbacks.openWorkspace({ name: file.name, bytes });
      results[workspaceIndex] = { name: file.name, ids, workspace: true };
    } catch (error) {
      results[workspaceIndex] = {
        name: file.name,
        ids: [],
        workspace: true,
        error: error instanceof Error ? error.message : String(error),
      };
      for (let i = 0; i < files.length; i++) {
        if (i !== workspaceIndex) {
          results[i] = {
            name: files[i].name,
            ids: [],
            error: "Not imported because the workspace was not opened.",
          };
        }
      }
      return { files: results };
    }
  }

  const importData = async (): Promise<RemoteOpenResult> => {
    if (files.length === workspaceIndices.length) return { files: results };
    const [signalFormats, imageFormats] = await Promise.all([
      runtime.listSignalIoFormats(),
      runtime.listImageIoFormats(),
    ]);
    const signals = new Set(
      signalFormats.all_read_extensions.map((x) => x.toLowerCase()),
    );
    const images = new Set(
      imageFormats.all_read_extensions.map((x) => x.toLowerCase()),
    );
    let last: { id: string; panel: PanelKind } | undefined;

    for (const [index, file] of files.entries()) {
      if (index === workspaceIndex) continue;
      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isSignal = signals.has(extension);
      const isImage = images.has(extension);
      const panel =
        isSignal !== isImage ? (isSignal ? "signal" : "image") : preferredPanel;
      if (panel !== "signal" && panel !== "image") {
        results[index] = {
          name: file.name,
          ids: [],
          error: "Specify a signal or image kind when no data panel is active.",
        };
        continue;
      }
      let ids: string[];
      try {
        const bytes =
          file.bytes instanceof Uint8Array
            ? new Uint8Array(file.bytes)
            : new Uint8Array(file.bytes.slice(0));
        ids =
          panel === "signal"
            ? await runtime.openSignalFromBytes(file.name, bytes)
            : await runtime.openImageFromBytes(file.name, bytes);
      } catch (error) {
        results[index] = {
          name: file.name,
          ids: [],
          panel,
          error: error instanceof Error ? error.message : String(error),
        };
        continue;
      }
      const result: RemoteFileResult = { name: file.name, ids, panel };
      if (!ids.length) result.error = "The file produced no objects.";
      results[index] = result;
      if (ids.length) {
        last = { id: ids[ids.length - 1], panel };
        try {
          callbacks.onModelChanged(panel);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          result.warning = `Imported, but could not notify the host: ${message}`;
        }
      }
    }
    if (last && callbacks.selectObjects) {
      try {
        await callbacks.selectObjects([last.id], last.panel);
      } catch (error) {
        return {
          files: results,
          selectionError:
            error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { files: results };
  };
  try {
    return await (callbacks.runDataImport
      ? callbacks.runDataImport(importData)
      : importData());
  } catch (error) {
    if (!results.some(Boolean)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    for (let i = 0; i < files.length; i++) {
      if (!results[i]) {
        results[i] = { name: files[i].name, ids: [], error: message };
      }
    }
    return { files: results };
  }
}
