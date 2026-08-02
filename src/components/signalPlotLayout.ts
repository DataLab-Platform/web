import type {
  AnalysisResult,
  SignalData,
  SignalResultBundle,
} from "../runtime/runtime";

export type { SignalResultBundle } from "../runtime/runtime";

export const SIGNAL_LAYOUT_MODES = [
  "overlay",
  "vertical",
  "horizontal",
] as const;

export type SignalLayoutMode = (typeof SIGNAL_LAYOUT_MODES)[number];

// Plotly trims ordinary whitespace before showing its editable title placeholder.
const INVISIBLE_AXIS_TITLE = "\u200b";

export function bundleSignalResults(
  signalIds: string[],
  resultLists: AnalysisResult[][],
): SignalResultBundle[] {
  return resultLists.map((results, index) => ({
    signalId: signalIds[index],
    results,
  }));
}

export interface SignalAxisAssignment {
  signalId: string;
  xRef: string;
  yRef: string;
  xLayoutKey: string;
  yLayoutKey: string;
}

export interface SignalPlotLayout {
  effectiveMode: SignalLayoutMode;
  assignments: SignalAxisAssignment[];
  axes: Record<string, Record<string, unknown>>;
  minWidth?: number;
  minHeight?: number;
}

export function normalizeSignalLayoutMode(
  value: string | null | undefined,
): SignalLayoutMode {
  return SIGNAL_LAYOUT_MODES.includes(value as SignalLayoutMode)
    ? (value as SignalLayoutMode)
    : "overlay";
}

export function formatSignalAxis(label: string, unit: string): string {
  return unit ? `${label} (${unit})` : label;
}

function synchronizationKey(signal: SignalData): string | null {
  // Unit symbols are case-sensitive (for example, "s" and "S" are
  // scientifically different), while human-readable labels are not.
  const unit = signal.xunit.trim();
  if (unit) return `unit:${unit}`;
  const label = signal.xlabel.trim().toLowerCase();
  return label ? `label:${label}` : null;
}

export function haveCompatibleSignalXAxes(
  first: SignalData,
  second: SignalData,
): boolean {
  const firstKey = synchronizationKey(first);
  return firstKey !== null && firstKey === synchronizationKey(second);
}

function axisRef(prefix: "x" | "y", index: number): string {
  return index === 0 ? prefix : `${prefix}${index + 1}`;
}

function axisLayoutKey(prefix: "xaxis" | "yaxis", index: number): string {
  return index === 0 ? prefix : `${prefix}${index + 1}`;
}

function domains(count: number): Array<[number, number]> {
  if (count <= 1) return [[0, 1]];
  const gap = Math.min(0.04, 0.2 / (count - 1));
  const size = (1 - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => {
    const start = index * (size + gap);
    return [start, start + size];
  });
}

export function buildSignalPlotLayout(
  signals: SignalData[],
  requestedMode: SignalLayoutMode,
): SignalPlotLayout {
  const effectiveMode =
    signals.length <= 1 ? "overlay" : normalizeSignalLayoutMode(requestedMode);
  const assignments = signals.map((signal, index) => ({
    signalId: signal.id,
    xRef: effectiveMode === "overlay" ? "x" : axisRef("x", index),
    yRef: effectiveMode === "overlay" ? "y" : axisRef("y", index),
    xLayoutKey:
      effectiveMode === "overlay" ? "xaxis" : axisLayoutKey("xaxis", index),
    yLayoutKey:
      effectiveMode === "overlay" ? "yaxis" : axisLayoutKey("yaxis", index),
  }));

  if (effectiveMode === "overlay") {
    const primary = signals[0];
    return {
      effectiveMode,
      assignments,
      axes: primary
        ? {
            xaxis: {
              title: {
                text: formatSignalAxis(primary.xlabel || "X", primary.xunit),
              },
              automargin: true,
            },
            yaxis: {
              title: {
                text: formatSignalAxis(primary.ylabel || "Y", primary.yunit),
              },
              automargin: true,
            },
          }
        : {},
    };
  }

  const splitDomains = domains(signals.length);
  const syncKeys = signals.map(synchronizationKey);
  const lastIndexBySyncKey = new Map<string, number>();
  syncKeys.forEach((key, index) => {
    if (key !== null) lastIndexBySyncKey.set(key, index);
  });
  const firstAxisBySyncKey = new Map<string, string>();
  const axes: Record<string, Record<string, unknown>> = {};

  signals.forEach((signal, index) => {
    const assignment = assignments[index];
    const syncKey = syncKeys[index];
    const firstMatchingAxis =
      syncKey === null ? undefined : firstAxisBySyncKey.get(syncKey);
    if (syncKey !== null && firstMatchingAxis === undefined) {
      firstAxisBySyncKey.set(syncKey, assignment.xRef);
    }
    const showXLabels =
      effectiveMode === "horizontal" ||
      syncKey === null ||
      lastIndexBySyncKey.get(syncKey) === index;
    const xDomain =
      effectiveMode === "horizontal" ? splitDomains[index] : [0, 1];
    const yDomain =
      effectiveMode === "vertical"
        ? splitDomains[signals.length - index - 1]
        : [0, 1];

    axes[assignment.xLayoutKey] = {
      domain: xDomain,
      anchor: assignment.yRef,
      ...(firstMatchingAxis ? { matches: firstMatchingAxis } : {}),
      showticklabels: showXLabels,
      title: {
        text: showXLabels
          ? formatSignalAxis(signal.xlabel || "X", signal.xunit)
          : INVISIBLE_AXIS_TITLE,
      },
      automargin: true,
    };
    axes[assignment.yLayoutKey] = {
      domain: yDomain,
      anchor: assignment.xRef,
      title: {
        text: formatSignalAxis(signal.ylabel || "Y", signal.yunit),
      },
      automargin: true,
    };
  });

  return {
    effectiveMode,
    assignments,
    axes,
    minWidth:
      effectiveMode === "horizontal"
        ? Math.max(720, signals.length * 360)
        : undefined,
    minHeight:
      effectiveMode === "vertical"
        ? Math.max(440, signals.length * 220)
        : undefined,
  };
}
