import { getActiveLocale } from "../i18n/locale";
import type { RuntimeApi } from "../runtime/RuntimeApi";
import type { PythonEnvironmentInfo, StorageMode } from "../runtime/runtime";
import { getRuntimeMode, type RuntimeMode } from "../runtime/runtimeMode";
import { isDiskStorageSupported } from "../runtime/storageCapabilities";

export type EnvironmentRuntimeStatus = "loading" | "ready" | "error";

export type PythonEnvironmentState =
  | {
      status: "ready";
      reason: null;
      info: PythonEnvironmentInfo;
    }
  | {
      status: "loading" | "error";
      reason: "runtime-loading" | "runtime-unavailable" | "collection-failed";
      info: null;
    };

export interface BrowserEnvironmentInfo {
  userAgent: string;
  platform: string;
  language: string;
  activeLocale: string;
  webAssemblySupported: boolean;
}

export interface EnvironmentReport {
  capturedAt: string;
  application: {
    version: string;
    buildMode: string;
    runtimeMode: RuntimeMode;
    storageMode: StorageMode | null;
    opfsSupported: boolean;
  };
  browser: BrowserEnvironmentInfo;
  python: PythonEnvironmentState;
}

export interface CollectEnvironmentReportOptions {
  runtime: RuntimeApi | null;
  runtimeStatus: EnvironmentRuntimeStatus;
  appVersion?: string;
  capturedAt?: Date;
  buildMode?: string;
  runtimeMode?: RuntimeMode;
  storageMode?: StorageMode | null;
  opfsSupported?: boolean;
  browser?: BrowserEnvironmentInfo;
}

/** Read the stable browser details useful in a bug report. */
export function readBrowserEnvironment(): BrowserEnvironmentInfo {
  const hasNavigator = typeof navigator !== "undefined";
  return {
    userAgent:
      hasNavigator && navigator.userAgent ? navigator.userAgent : "Unavailable",
    platform:
      hasNavigator && navigator.platform ? navigator.platform : "Unavailable",
    language:
      hasNavigator && navigator.language ? navigator.language : "Unavailable",
    activeLocale: getActiveLocale(),
    webAssemblySupported: typeof WebAssembly !== "undefined",
  };
}

function readStorageMode(runtime: RuntimeApi | null): StorageMode | null {
  if (!runtime) return null;
  try {
    return runtime.getStorageMode();
  } catch {
    return null;
  }
}

function sortPythonPackages(
  info: PythonEnvironmentInfo,
): PythonEnvironmentInfo {
  return {
    ...info,
    packages: [...info.packages].sort((left, right) =>
      left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
    ),
  };
}

/** Collect a point-in-time environment report without workspace data. */
export async function collectEnvironmentReport(
  options: CollectEnvironmentReportOptions,
): Promise<EnvironmentReport> {
  let python: PythonEnvironmentState;
  if (options.runtimeStatus === "loading") {
    python = {
      status: "loading",
      reason: "runtime-loading",
      info: null,
    };
  } else if (options.runtimeStatus === "error" || !options.runtime) {
    python = {
      status: "error",
      reason: "runtime-unavailable",
      info: null,
    };
  } else {
    try {
      python = {
        status: "ready",
        reason: null,
        info: sortPythonPackages(
          await options.runtime.getPythonEnvironmentInfo(),
        ),
      };
    } catch {
      python = {
        status: "error",
        reason: "collection-failed",
        info: null,
      };
    }
  }

  return {
    capturedAt: (options.capturedAt ?? new Date()).toISOString(),
    application: {
      version: options.appVersion || "dev",
      buildMode: options.buildMode ?? import.meta.env.MODE ?? "unknown",
      runtimeMode: options.runtimeMode ?? getRuntimeMode(),
      storageMode:
        options.storageMode !== undefined
          ? options.storageMode
          : readStorageMode(options.runtime),
      opfsSupported:
        options.opfsSupported !== undefined
          ? options.opfsSupported
          : isDiskStorageSupported(),
    },
    browser: options.browser ?? readBrowserEnvironment(),
    python,
  };
}

function markdownCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function available(value: string | null | undefined): string {
  return value ? markdownCell(value) : "Unavailable";
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function table(rows: ReadonlyArray<readonly [string, string]>): string[] {
  return [
    "| Item | Value |",
    "| --- | --- |",
    ...rows.map(
      ([label, value]) => `| ${markdownCell(label)} | ${markdownCell(value)} |`,
    ),
  ];
}

/** Format a stable, English Markdown block ready for a GitHub issue. */
export function formatEnvironmentReportMarkdown(
  report: EnvironmentReport,
): string {
  const lines = [
    "## DataLab Web environment",
    "",
    ...table([
      ["Captured at", report.capturedAt],
      ["DataLab Web", report.application.version],
      ["Build mode", report.application.buildMode],
      ["Runtime mode", report.application.runtimeMode],
      ["Storage mode", report.application.storageMode ?? "Unavailable"],
      ["OPFS available", yesNo(report.application.opfsSupported)],
    ]),
    "",
    "### Python runtime",
    "",
  ];

  if (report.python.status === "ready") {
    const info = report.python.info;
    lines.push(
      ...table([
        ["Python", available(info.pythonVersion)],
        ["Implementation", available(info.pythonImplementation)],
        ["Python platform", available(info.pythonPlatform)],
        ["Platform", available(info.platform)],
        ["Machine", available(info.machine)],
        ["Pyodide", available(info.pyodideVersion)],
      ]),
      "",
      `### Python distributions (${info.packages.length})`,
      "",
      "| Package | Version |",
      "| --- | --- |",
      ...info.packages.map(
        (entry) =>
          `| ${markdownCell(entry.name)} | ${markdownCell(entry.version)} |`,
      ),
    );
  } else {
    const status =
      report.python.reason === "runtime-loading"
        ? "Python runtime is still loading."
        : report.python.reason === "collection-failed"
          ? "Python environment collection failed."
          : "Python runtime is unavailable.";
    lines.push(status);
  }

  lines.push(
    "",
    "### Browser",
    "",
    ...table([
      ["User agent", available(report.browser.userAgent)],
      ["Platform", available(report.browser.platform)],
      ["Browser language", available(report.browser.language)],
      ["DataLab Web locale", available(report.browser.activeLocale)],
      ["WebAssembly available", yesNo(report.browser.webAssemblySupported)],
    ]),
    "",
  );
  return lines.join("\n");
}
