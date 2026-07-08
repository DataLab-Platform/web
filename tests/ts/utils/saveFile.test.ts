import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptFromExtensions,
  saveBytesToFile,
  supportsSaveFilePicker,
} from "../../../src/utils/saveFile";

interface WindowWithPicker {
  showSaveFilePicker?: unknown;
}

/** Install a fake ``window.showSaveFilePicker`` and return a cleanup fn. */
function installPicker(impl: unknown): () => void {
  const win = window as unknown as WindowWithPicker;
  win.showSaveFilePicker = impl;
  return () => {
    delete win.showSaveFilePicker;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as WindowWithPicker).showSaveFilePicker;
});

describe("acceptFromExtensions", () => {
  it("normalises extensions to dotted form under the given MIME", () => {
    const accept = acceptFromExtensions(
      "CSV files",
      ["csv", ".txt"],
      "text/csv",
    );
    expect(accept).toEqual({
      description: "CSV files",
      accept: { "text/csv": [".csv", ".txt"] },
    });
  });
});

describe("supportsSaveFilePicker", () => {
  it("is false when the API is absent (jsdom default)", () => {
    expect(supportsSaveFilePicker()).toBe(false);
  });

  it("is true once window.showSaveFilePicker exists", () => {
    const cleanup = installPicker(() => {});
    try {
      expect(supportsSaveFilePicker()).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("saveBytesToFile — download fallback", () => {
  it("downloads and reports outcome 'downloaded' when no picker", async () => {
    if (typeof URL.createObjectURL !== "function") {
      (URL as { createObjectURL: (b: Blob) => string }).createObjectURL = () =>
        "";
    }
    if (typeof URL.revokeObjectURL !== "function") {
      (URL as { revokeObjectURL: (s: string) => void }).revokeObjectURL =
        () => {};
    }
    const createSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:fake");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const result = await saveBytesToFile(new Uint8Array([1, 2, 3]), "data.bin");

    expect(result).toEqual({ outcome: "downloaded", filename: "data.bin" });
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

describe("saveBytesToFile — native picker", () => {
  it("writes through the handle and reports outcome 'saved'", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const handle = { name: "chosen.tif", createWritable };
    const picker = vi.fn().mockResolvedValue(handle);
    const cleanup = installPicker(picker);
    try {
      const result = await saveBytesToFile(
        new Uint8Array([9, 9]),
        "image.tif",
        [acceptFromExtensions("Image files", ["tif"])],
      );
      expect(result).toEqual({ outcome: "saved", filename: "chosen.tif" });
      expect(picker).toHaveBeenCalledTimes(1);
      expect(write).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("reports outcome 'cancelled' when the user aborts the picker", async () => {
    const picker = vi
      .fn()
      .mockRejectedValue(new DOMException("aborted", "AbortError"));
    const cleanup = installPicker(picker);
    try {
      const result = await saveBytesToFile(new Uint8Array([0]), "x.bin");
      expect(result).toEqual({ outcome: "cancelled", filename: "x.bin" });
    } finally {
      cleanup();
    }
  });

  it("propagates non-abort picker errors", async () => {
    const picker = vi
      .fn()
      .mockRejectedValue(new DOMException("denied", "SecurityError"));
    const cleanup = installPicker(picker);
    try {
      await expect(
        saveBytesToFile(new Uint8Array([0]), "x.bin"),
      ).rejects.toThrow("denied");
    } finally {
      cleanup();
    }
  });
});
