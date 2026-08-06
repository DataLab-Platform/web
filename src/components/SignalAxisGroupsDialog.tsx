import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { t } from "../i18n/translate";
import type { SignalData } from "../runtime/runtime";
import {
  normalizeSignalAxisGroups,
  type SignalAxisGroup,
  type SignalLayoutMode,
} from "./signalPlotLayout";

type AxisGroupLayoutMode = Exclude<SignalLayoutMode, "overlay">;

interface Props {
  signals: SignalData[];
  groups: readonly SignalAxisGroup[];
  layoutMode: SignalLayoutMode;
  onApply: (groups: SignalAxisGroup[], layoutMode: AxisGroupLayoutMode) => void;
  onCancel: () => void;
}

function cloneGroups(groups: readonly SignalAxisGroup[]): SignalAxisGroup[] {
  return groups.map((group) => ({
    id: group.id,
    signalIds: [...group.signalIds],
  }));
}

function metadataDiffers(signals: SignalData[], axis: "x" | "y"): boolean {
  const labels = new Set(
    signals.map(
      (signal) =>
        `${signal[`${axis}label`].trim().toLowerCase()}\u0000${signal[
          `${axis}unit`
        ].trim()}`,
    ),
  );
  return labels.size > 1;
}

export function SignalAxisGroupsDialog({
  signals,
  groups,
  layoutMode,
  onApply,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState(() =>
    cloneGroups(normalizeSignalAxisGroups(signals, groups)),
  );
  const [draftLayoutMode, setDraftLayoutMode] = useState<AxisGroupLayoutMode>(
    () => (layoutMode === "horizontal" ? "horizontal" : "vertical"),
  );
  const nextGroupNumber = useRef(draft.length + 1);
  const signalById = useMemo(
    () => new Map(signals.map((signal) => [signal.id, signal])),
    [signals],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const moveSignal = useCallback(
    (signalId: string, targetGroupId: string, beforeSignalId?: string) => {
      setDraft((current) => {
        const withoutSignal = current.map((group) => ({
          ...group,
          signalIds: group.signalIds.filter((id) => id !== signalId),
        }));
        const moved = withoutSignal.map((group) => {
          if (group.id !== targetGroupId) return group;
          const signalIds = [...group.signalIds];
          const targetIndex = beforeSignalId
            ? signalIds.indexOf(beforeSignalId)
            : -1;
          if (targetIndex >= 0) signalIds.splice(targetIndex, 0, signalId);
          else signalIds.push(signalId);
          return { ...group, signalIds };
        });
        return moved.filter(
          (group) => group.id === targetGroupId || group.signalIds.length > 0,
        );
      });
    },
    [],
  );

  const moveGroup = useCallback((groupIndex: number, direction: -1 | 1) => {
    setDraft((current) => {
      const targetIndex = groupIndex + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[groupIndex], next[targetIndex]] = [
        next[targetIndex],
        next[groupIndex],
      ];
      return next;
    });
  }, []);

  const addAxis = useCallback(() => {
    setDraft((current) => {
      if (current.some((group) => group.signalIds.length === 0)) return current;
      const id = `axis:new:${nextGroupNumber.current}`;
      nextGroupNumber.current += 1;
      return [...current, { id, signalIds: [] }];
    });
  }, []);

  const setAllOnOneAxis = useCallback(() => {
    setDraft([
      {
        id: draft[0]?.id ?? "axis:all",
        signalIds: signals.map((signal) => signal.id),
      },
    ]);
  }, [draft, signals]);

  const setOneAxisPerSignal = useCallback(() => {
    setDraft(
      signals.map((signal) => ({
        id: `axis:${signal.id}`,
        signalIds: [signal.id],
      })),
    );
  }, [signals]);

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signal-axis-groups-title"
      onClick={onCancel}
    >
      <div
        className="card signal-axis-groups-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="signal-axis-groups-title">{t("Organize signal axes")}</h2>
        <p className="signal-axis-groups-description">
          {t(
            "Signals on the same axis are overlaid. Applying these settings activates the selected axis layout.",
          )}
        </p>
        <div
          className="signal-axis-groups-layout"
          role="group"
          aria-label={t("Axis layout")}
        >
          <span>{t("Axis layout")}:</span>
          {(["vertical", "horizontal"] as const).map((mode) => {
            const label = mode === "vertical" ? t("Vertical") : t("Horizontal");
            return (
              <button
                key={mode}
                type="button"
                className={`signal-layout-modebtn${draftLayoutMode === mode ? " active" : ""}`}
                aria-pressed={draftLayoutMode === mode}
                onClick={() => setDraftLayoutMode(mode)}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="signal-axis-groups-toolbar">
          <button type="button" onClick={addAxis}>
            {t("New axis")}
          </button>
          <button type="button" onClick={setAllOnOneAxis}>
            {t("All on one axis")}
          </button>
          <button type="button" onClick={setOneAxisPerSignal}>
            {t("One axis per signal")}
          </button>
        </div>
        <div className="signal-axis-groups-list">
          {draft.map((group, groupIndex) => {
            const groupSignals = group.signalIds.flatMap((signalId) => {
              const signal = signalById.get(signalId);
              return signal ? [signal] : [];
            });
            const xDiffers = metadataDiffers(groupSignals, "x");
            const yDiffers = metadataDiffers(groupSignals, "y");
            return (
              <section
                key={group.id}
                className="signal-axis-group"
                aria-labelledby={`signal-axis-group-${groupIndex}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const signalId = event.dataTransfer.getData("text/plain");
                  if (signalById.has(signalId)) moveSignal(signalId, group.id);
                }}
              >
                <div className="signal-axis-group-header">
                  <h3 id={`signal-axis-group-${groupIndex}`}>
                    {t("Axis {number}", { number: groupIndex + 1 })}
                  </h3>
                  <div className="signal-axis-group-order">
                    <button
                      type="button"
                      onClick={() => moveGroup(groupIndex, -1)}
                      disabled={groupIndex === 0}
                      aria-label={t("Move axis {number} up", {
                        number: groupIndex + 1,
                      })}
                    >
                      {t("Up")}
                    </button>
                    <button
                      type="button"
                      onClick={() => moveGroup(groupIndex, 1)}
                      disabled={groupIndex === draft.length - 1}
                      aria-label={t("Move axis {number} down", {
                        number: groupIndex + 1,
                      })}
                    >
                      {t("Down")}
                    </button>
                  </div>
                </div>
                {groupSignals.length === 0 ? (
                  <div className="signal-axis-group-empty">
                    {t("Drop a signal here")}
                  </div>
                ) : (
                  <ul className="signal-axis-group-signals">
                    {groupSignals.map((signal) => (
                      <li
                        key={signal.id}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", signal.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const signalId =
                            event.dataTransfer.getData("text/plain");
                          if (signalById.has(signalId)) {
                            moveSignal(signalId, group.id, signal.id);
                          }
                        }}
                      >
                        <span className="signal-axis-group-drag" aria-hidden>
                          ::
                        </span>
                        <span className="signal-axis-group-title">
                          {signal.title}
                        </span>
                        <label>
                          <span>{t("Axis")}</span>
                          <select
                            aria-label={t("Axis for {title}", {
                              title: signal.title,
                            })}
                            value={group.id}
                            onChange={(event) =>
                              moveSignal(signal.id, event.target.value)
                            }
                          >
                            {draft.map((candidate, candidateIndex) => (
                              <option key={candidate.id} value={candidate.id}>
                                {t("Axis {number}", {
                                  number: candidateIndex + 1,
                                })}
                              </option>
                            ))}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {(xDiffers || yDiffers) && (
                  <div className="signal-axis-group-warning" role="status">
                    {xDiffers &&
                      t(
                        "Signals on this axis use different X labels or units.",
                      )}
                    {xDiffers && yDiffers ? " " : null}
                    {yDiffers &&
                      t(
                        "Signals on this axis use different Y labels or units.",
                      )}{" "}
                    {t("The first signal provides the axis titles.")}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <div className="actions">
          <button type="button" onClick={onCancel}>
            {t("Cancel")}
          </button>
          <button
            type="button"
            onClick={() =>
              onApply(
                normalizeSignalAxisGroups(signals, draft),
                draftLayoutMode,
              )
            }
          >
            {t("Apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
