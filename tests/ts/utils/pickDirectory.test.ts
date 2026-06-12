import { afterEach, describe, expect, it, vi } from "vitest";

import {
  groupByFolder,
  pickDirectoryRecursive,
  type PickedFile,
} from "../../../src/utils/pickDirectory";

/** Build a File whose ``webkitRelativePath`` mimics what a browser sets
 *  when the user picks a folder via ``<input webkitdirectory>``. */
function fileWithRelPath(relPath: string): File {
  const name = relPath.split("/").pop() ?? relPath;
  const file = new File(["data"], name);
  Object.defineProperty(file, "webkitRelativePath", {
    value: relPath,
    configurable: true,
  });
  return file;
}

/** Drive ``pickDirectoryRecursive`` through its ``<input webkitdirectory>``
 *  fallback (jsdom exposes no ``showDirectoryPicker``). Intercepts the
 *  dynamically created input, assigns a fake ``FileList`` and fires the
 *  ``change`` event the picker would emit. */
async function runInputPicker(files: File[]) {
  const realCreate = document.createElement.bind(document);
  const spy = vi
    .spyOn(document, "createElement")
    .mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === "input") {
        const input = el as HTMLInputElement;
        // Defer until the picker wired its ``change`` listener and called
        // ``.click()``; then expose the files and dispatch the event.
        input.click = () => {
          Object.defineProperty(input, "files", {
            value: files as unknown as FileList,
            configurable: true,
          });
          input.dispatchEvent(new Event("change"));
        };
      }
      return el;
    });
  try {
    return await pickDirectoryRecursive();
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickDirectoryRecursive (input fallback)", () => {
  it("captures the picked root folder name", async () => {
    const result = await runInputPicker([
      fileWithRelPath("MyData/a.csv"),
      fileWithRelPath("MyData/b.csv"),
    ]);
    expect(result).not.toBeNull();
    expect(result!.rootName).toBe("MyData");
    expect(result!.files).toHaveLength(2);
    // Files sitting directly in the root have an empty relativeDir.
    expect(result!.files.every((f) => f.relativeDir === "")).toBe(true);
  });

  it("strips the root segment from sub-folder paths", async () => {
    const result = await runInputPicker([
      fileWithRelPath("MyData/sub/deep.npy"),
      fileWithRelPath("MyData/root.csv"),
    ]);
    expect(result!.rootName).toBe("MyData");
    const byName = new Map(result!.files.map((f) => [f.name, f.relativeDir]));
    expect(byName.get("deep.npy")).toBe("sub");
    expect(byName.get("root.csv")).toBe("");
  });

  it("resolves to null when no files are selected", async () => {
    const result = await runInputPicker([]);
    expect(result).toBeNull();
  });
});

describe("groupByFolder", () => {
  it("clusters files by folder, folders and files sorted", () => {
    const picked: PickedFile[] = [
      { relativeDir: "sub", name: "z.csv", file: new File([], "z.csv") },
      { relativeDir: "", name: "b.csv", file: new File([], "b.csv") },
      { relativeDir: "sub", name: "a.csv", file: new File([], "a.csv") },
      { relativeDir: "", name: "a.csv", file: new File([], "a.csv") },
    ];
    const groups = groupByFolder(picked);
    expect(groups.map((g) => g.relativeDir)).toEqual(["", "sub"]);
    expect(groups[0].files.map((f) => f.name)).toEqual(["a.csv", "b.csv"]);
    expect(groups[1].files.map((f) => f.name)).toEqual(["a.csv", "z.csv"]);
  });
});
