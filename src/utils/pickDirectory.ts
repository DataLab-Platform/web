// Copyright (c) DataLab Platform Developers, BSD 3-Clause License
// See LICENSE file for details
/**
 * Recursive directory picker.
 *
 * Prefers the File System Access API (``window.showDirectoryPicker``)
 * available on Chromium-based browsers, and falls back to a synthetic
 * ``<input type="file" webkitdirectory multiple>`` on other engines.
 *
 * Returns a flat list of ``{ relativePath, file }`` entries where
 * ``relativePath`` always uses forward slashes and never starts with a
 * slash. The root folder name is **not** included in the path — only
 * the path *inside* the picked folder, matching the convention of
 * ``webkitRelativePath`` minus its first segment.
 *
 * Resolves to ``null`` when the user cancels the picker.
 */

export interface PickedFile {
  /** Path relative to the picked root, using ``/`` separators. Empty
   *  string for files sitting directly in the root folder. */
  relativeDir: string;
  /** File name (basename). */
  name: string;
  /** Underlying ``File`` blob. */
  file: File;
}

export interface PickedDirectory {
  /** Basename of the folder the user picked. Used to name the group that
   *  holds files sitting directly in the root, mirroring DataLab Qt's
   *  ``load_from_directory`` (which falls back to ``osp.basename(path)``
   *  when the relative path is ``"."``). */
  rootName: string;
  /** Flat list of files found by walking the picked folder recursively. */
  files: PickedFile[];
}

interface DirectoryHandleLike {
  values(): AsyncIterable<FileSystemHandle>;
}

async function walkDirectoryHandle(
  handle: DirectoryHandleLike,
  prefix: string,
  out: PickedFile[],
): Promise<void> {
  for await (const entry of handle.values()) {
    if (entry.kind === "file") {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.push({ relativeDir: prefix, name: entry.name, file });
    } else if (entry.kind === "directory") {
      const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      await walkDirectoryHandle(
        entry as unknown as DirectoryHandleLike,
        subPrefix,
        out,
      );
    }
  }
}

async function pickViaFileSystemAccess(): Promise<PickedDirectory | null> {
  const win = window as unknown as {
    showDirectoryPicker?: (opts?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  };
  if (typeof win.showDirectoryPicker !== "function") return null;
  let dirHandle: FileSystemDirectoryHandle;
  try {
    // Must be invoked as a method on ``window`` — extracting the
    // reference and calling it bare throws ``TypeError: Illegal
    // invocation`` in Chromium (the binding checks the receiver).
    dirHandle = await win.showDirectoryPicker({ mode: "read" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return null;
    }
    throw err;
  }
  const out: PickedFile[] = [];
  await walkDirectoryHandle(
    dirHandle as unknown as DirectoryHandleLike,
    "",
    out,
  );
  console.info(
    `[pickDirectory] FSA walked '${dirHandle.name}': ${out.length} file(s)`,
  );
  return { rootName: dirHandle.name, files: out };
}

async function pickViaInputElement(): Promise<PickedDirectory | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    // ``webkitdirectory`` is non-standard but supported by every major
    // browser. The TS DOM lib does not type it directly.
    (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory =
      true;
    input.multiple = true;
    input.style.display = "none";

    // ``cancel`` fires on Chromium / Firefox >= 124 when the user closes
    // the picker without selecting anything. Older browsers stay silent;
    // those callers will just never resolve, which matches how the rest
    // of the app uses dynamic ``<input type=file>`` pickers.
    input.addEventListener("cancel", () => {
      cleanup();
      resolve(null);
    });
    input.addEventListener("change", () => {
      try {
        const files = input.files;
        if (!files || files.length === 0) {
          cleanup();
          resolve(null);
          return;
        }
        const out: PickedFile[] = [];
        let rootName = "";
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          // ``webkitRelativePath`` includes the picked folder name as
          // its first segment — strip it so paths are relative to the
          // root the user actually chose, but keep it as the root name.
          const rel = file.webkitRelativePath || file.name;
          const parts = rel.split("/");
          const first = parts.shift(); // root folder name
          if (first && !rootName) rootName = first;
          const name = parts.pop() ?? file.name;
          const relativeDir = parts.join("/");
          out.push({ relativeDir, name, file });
        }
        cleanup();
        resolve({ rootName, files: out });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    document.body.appendChild(input);
    input.click();
  });
}

/** Open a directory picker and recursively walk the selected folder. */
export async function pickDirectoryRecursive(): Promise<PickedDirectory | null> {
  const win = window as unknown as { showDirectoryPicker?: unknown };
  if (typeof win.showDirectoryPicker === "function") {
    // FSA available: use it exclusively. Falling back to the
    // ``<input webkitdirectory>`` path on cancel would re-prompt the
    // user with a second, confusingly-labeled "Upload" dialog.
    return pickViaFileSystemAccess();
  }
  return pickViaInputElement();
}

/** Group picked files by their parent folder. Returns folders in
 *  lexicographic order with files inside each folder sorted by name —
 *  mirrors the ``sorted()`` calls in DataLab Qt's
 *  ``load_from_directory``. */
export function groupByFolder(
  picked: PickedFile[],
): Array<{ relativeDir: string; files: PickedFile[] }> {
  const byDir = new Map<string, PickedFile[]>();
  for (const p of picked) {
    const arr = byDir.get(p.relativeDir);
    if (arr) arr.push(p);
    else byDir.set(p.relativeDir, [p]);
  }
  const dirs = [...byDir.keys()].sort();
  return dirs.map((d) => ({
    relativeDir: d,
    files: byDir
      .get(d)!
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
