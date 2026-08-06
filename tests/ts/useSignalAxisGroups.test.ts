import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SignalAxisGroup } from "../../src/components/signalPlotLayout";
import {
  loadSignalAxisGroups,
  persistSignalAxisGroups,
  SIGNAL_AXIS_GROUPS_STORAGE_KEY,
  signalAxisGroupSelectionIdentity,
  useSignalAxisGroups,
} from "../../src/hooks/useSignalAxisGroups";
import type { SignalData } from "../../src/runtime/runtime";

function makeSignal(
  id: string,
  uuid: string | null = `uuid-${id}`,
): SignalData {
  return {
    id,
    uuid,
    title: id,
    size: 2,
    xlabel: "Time",
    ylabel: "Amplitude",
    xunit: "s",
    yunit: "V",
    x: [0, 1],
    y: [0, 1],
  };
}

const GROUPS: SignalAxisGroup[] = [
  { id: "together", signalIds: ["a", "b"] },
  { id: "separate", signalIds: ["c"] },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe("signal axis group persistence", () => {
  it("uses an order-independent UUID selection identity", () => {
    const forward = signalAxisGroupSelectionIdentity([
      makeSignal("a"),
      makeSignal("b"),
    ]);
    const reverse = signalAxisGroupSelectionIdentity([
      makeSignal("b"),
      makeSignal("a"),
    ]);
    expect(forward).toEqual(reverse);
    expect(forward.persistent).toBe(true);
  });

  it("restores groups by UUID when runtime ids and selection order change", () => {
    const original = [makeSignal("a"), makeSignal("b"), makeSignal("c")];
    persistSignalAxisGroups(original, GROUPS);
    const restored = [
      makeSignal("new-c", "uuid-c"),
      makeSignal("new-b", "uuid-b"),
      makeSignal("new-a", "uuid-a"),
    ];
    expect(loadSignalAxisGroups(restored)).toEqual([
      { id: "together", signalIds: ["new-a", "new-b"] },
      { id: "separate", signalIds: ["new-c"] },
    ]);
  });

  it("keeps separate selections isolated", () => {
    persistSignalAxisGroups(
      [makeSignal("a"), makeSignal("b"), makeSignal("c")],
      GROUPS,
    );
    expect(loadSignalAxisGroups([makeSignal("a"), makeSignal("b")])).toEqual([
      { id: "axis:a", signalIds: ["a"] },
      { id: "axis:b", signalIds: ["b"] },
    ]);
  });

  it("does not persist a selection containing a signal without a UUID", () => {
    const signals = [makeSignal("a"), makeSignal("temporary", null)];
    persistSignalAxisGroups(signals, [
      { id: "both", signalIds: ["a", "temporary"] },
    ]);
    expect(
      window.localStorage.getItem(SIGNAL_AXIS_GROUPS_STORAGE_KEY),
    ).toBeNull();
    expect(signalAxisGroupSelectionIdentity(signals).persistent).toBe(false);
  });

  it("falls back to one axis per signal after corrupted storage", () => {
    window.localStorage.setItem(SIGNAL_AXIS_GROUPS_STORAGE_KEY, "not-json");
    expect(loadSignalAxisGroups([makeSignal("a"), makeSignal("b")])).toEqual([
      { id: "axis:a", signalIds: ["a"] },
      { id: "axis:b", signalIds: ["b"] },
    ]);
  });

  it("ignores malformed groups inside an otherwise valid store", () => {
    const signals = [makeSignal("a"), makeSignal("b")];
    const identity = signalAxisGroupSelectionIdentity(signals);
    window.localStorage.setItem(
      SIGNAL_AXIS_GROUPS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        views: [
          {
            key: identity.key,
            updatedAt: 1,
            groups: [{ id: "broken" }, null],
          },
        ],
      }),
    );
    expect(loadSignalAxisGroups(signals)).toEqual([
      { id: "axis:a", signalIds: ["a"] },
      { id: "axis:b", signalIds: ["b"] },
    ]);
  });

  it("retains only the most recent configurations", () => {
    for (let index = 0; index < 30; index += 1) {
      const signal = makeSignal(`signal-${index}`);
      persistSignalAxisGroups(
        [signal],
        [{ id: `group-${index}`, signalIds: [signal.id] }],
      );
    }
    const stored = JSON.parse(
      window.localStorage.getItem(SIGNAL_AXIS_GROUPS_STORAGE_KEY) ?? "{}",
    ) as { views?: unknown[] };
    expect(stored.views).toHaveLength(24);
  });
});

describe("useSignalAxisGroups", () => {
  it("applies and resets persistent groups atomically", () => {
    const signals = [makeSignal("a"), makeSignal("b"), makeSignal("c")];
    const { result } = renderHook(() => useSignalAxisGroups(signals));
    act(() => result.current.applyGroups(GROUPS));
    expect(result.current.groups).toEqual(GROUPS);
    act(() => result.current.resetGroups());
    expect(result.current.groups).toEqual([
      { id: "axis:a", signalIds: ["a"] },
      { id: "axis:b", signalIds: ["b"] },
      { id: "axis:c", signalIds: ["c"] },
    ]);
  });

  it("keeps UUID-less grouping for the current hook session", () => {
    const signals = [makeSignal("a"), makeSignal("temporary", null)];
    const { result } = renderHook(() => useSignalAxisGroups(signals));
    const groups = [{ id: "both", signalIds: ["a", "temporary"] }];
    act(() => result.current.applyGroups(groups));
    expect(result.current.groups).toEqual(groups);
    expect(
      window.localStorage.getItem(SIGNAL_AXIS_GROUPS_STORAGE_KEY),
    ).toBeNull();
  });
});
