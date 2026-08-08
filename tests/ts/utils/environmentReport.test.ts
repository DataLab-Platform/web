import { describe, expect, it, vi } from "vitest";

import type { RuntimeApi } from "../../../src/runtime/RuntimeApi";
import type { PythonEnvironmentInfo } from "../../../src/runtime/runtime";
import {
  collectEnvironmentReport,
  formatEnvironmentReportMarkdown,
  type BrowserEnvironmentInfo,
} from "../../../src/utils/environmentReport";

const BROWSER: BrowserEnvironmentInfo = {
  userAgent: "Test Browser/1.0",
  platform: "TestOS",
  language: "fr-FR",
  activeLocale: "fr",
  webAssemblySupported: true,
};

const PYTHON: PythonEnvironmentInfo = {
  pythonVersion: "3.12.1 (main, Jan 1 2026)",
  pythonImplementation: "CPython",
  pythonPlatform: "emscripten",
  platform: "Emscripten-3.1.46-wasm32-32bit",
  machine: "wasm32",
  pyodideVersion: "0.26.4",
  packages: [
    { name: "Sigima", version: "1.3.0" },
    { name: "numpy", version: "2.0.2" },
    { name: "a|package", version: "1.0" },
  ],
};

function fakeRuntime(
  getPythonEnvironmentInfo: () => Promise<PythonEnvironmentInfo> = () =>
    Promise.resolve(PYTHON),
): RuntimeApi {
  return {
    getPythonEnvironmentInfo: vi.fn(getPythonEnvironmentInfo),
    getStorageMode: vi.fn(() => "disk"),
  } as unknown as RuntimeApi;
}

describe("environment report", () => {
  it("collects and sorts stable runtime and browser information", async () => {
    const runtime = fakeRuntime();
    const report = await collectEnvironmentReport({
      runtime,
      runtimeStatus: "ready",
      appVersion: "0.8.0",
      capturedAt: new Date("2026-08-08T10:00:00.000Z"),
      buildMode: "production",
      runtimeMode: "worker",
      opfsSupported: true,
      browser: BROWSER,
    });

    expect(runtime.getPythonEnvironmentInfo).toHaveBeenCalledOnce();
    expect(report.application).toEqual({
      version: "0.8.0",
      buildMode: "production",
      runtimeMode: "worker",
      storageMode: "disk",
      opfsSupported: true,
    });
    expect(report.python.status).toBe("ready");
    if (report.python.status === "ready") {
      expect(report.python.info.packages.map(({ name }) => name)).toEqual([
        "a|package",
        "numpy",
        "Sigima",
      ]);
    }
  });

  it("formats GitHub-ready Markdown and escapes table cells", async () => {
    const report = await collectEnvironmentReport({
      runtime: fakeRuntime(),
      runtimeStatus: "ready",
      appVersion: "0.8.0",
      capturedAt: new Date("2026-08-08T10:00:00.000Z"),
      buildMode: "production",
      runtimeMode: "worker",
      storageMode: "ram",
      opfsSupported: true,
      browser: BROWSER,
    });

    const markdown = formatEnvironmentReportMarkdown(report);

    expect(markdown).toContain("## DataLab Web environment");
    expect(markdown).toContain("| Python | 3.12.1 (main, Jan 1 2026) |");
    expect(markdown).toContain("| Pyodide | 0.26.4 |");
    expect(markdown).toContain("### Python distributions (3)");
    expect(markdown).toContain("| a\\|package | 1.0 |");
    expect(markdown.indexOf("a\\|package")).toBeLessThan(
      markdown.indexOf("numpy"),
    );
    expect(markdown).not.toMatch(/workspace|location\.href|referrer/i);
  });

  it("returns an explicit partial report while the runtime is loading", async () => {
    const report = await collectEnvironmentReport({
      runtime: null,
      runtimeStatus: "loading",
      appVersion: "dev",
      capturedAt: new Date("2026-08-08T10:00:00.000Z"),
      buildMode: "development",
      runtimeMode: "main",
      storageMode: null,
      opfsSupported: false,
      browser: BROWSER,
    });

    expect(report.python).toEqual({
      status: "loading",
      reason: "runtime-loading",
      info: null,
    });
    expect(formatEnvironmentReportMarkdown(report)).toContain(
      "Python runtime is still loading.",
    );
  });

  it("does not expose runtime exception details when collection fails", async () => {
    const report = await collectEnvironmentReport({
      runtime: fakeRuntime(() =>
        Promise.reject(new Error("C:\\Users\\name\\secret\\runtime.py")),
      ),
      runtimeStatus: "ready",
      appVersion: "0.8.0",
      capturedAt: new Date("2026-08-08T10:00:00.000Z"),
      buildMode: "production",
      runtimeMode: "worker",
      storageMode: "ram",
      opfsSupported: true,
      browser: BROWSER,
    });

    const markdown = formatEnvironmentReportMarkdown(report);
    expect(report.python.reason).toBe("collection-failed");
    expect(markdown).toContain("Python environment collection failed.");
    expect(markdown).not.toContain("Users\\name");
  });
});
