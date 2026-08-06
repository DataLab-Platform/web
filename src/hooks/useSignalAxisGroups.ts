import { useCallback, useRef, useState } from "react";

import {
  normalizeSignalAxisGroups,
  type SignalAxisGroup,
} from "../components/signalPlotLayout";
import type { SignalData } from "../runtime/runtime";

export const SIGNAL_AXIS_GROUPS_STORAGE_KEY = "datalab-web.signal-axis-groups";

const STORAGE_VERSION = 1;
const MAX_STORED_VIEWS = 24;

interface StoredAxisGroup {
  id: string;
  signalUuids: string[];
}

interface StoredAxisGroupView {
  key: string;
  updatedAt: number;
  groups: StoredAxisGroup[];
}

interface StoredAxisGroups {
  version: typeof STORAGE_VERSION;
  views: StoredAxisGroupView[];
}

type AxisGroupStorage = Pick<Storage, "getItem" | "setItem">;

interface SelectionIdentity {
  key: string;
  persistent: boolean;
}

function defaultGroups(signals: SignalData[]): SignalAxisGroup[] {
  return signals.map((signal) => ({
    id: `axis:${signal.id}`,
    signalIds: [signal.id],
  }));
}

export function signalAxisGroupSelectionIdentity(
  signals: SignalData[],
): SelectionIdentity {
  const uuids = signals.map((signal) => signal.uuid);
  if (uuids.every((uuid): uuid is string => Boolean(uuid))) {
    return {
      key: `uuid:${JSON.stringify([...uuids].sort())}`,
      persistent: true,
    };
  }
  return {
    key: `session:${JSON.stringify(signals.map((signal) => signal.id).sort())}`,
    persistent: false,
  };
}

function emptyStore(): StoredAxisGroups {
  return { version: STORAGE_VERSION, views: [] };
}

function readStore(storage: AxisGroupStorage): StoredAxisGroups {
  try {
    const raw = storage.getItem(SIGNAL_AXIS_GROUPS_STORAGE_KEY);
    if (raw === null) return emptyStore();
    const parsed = JSON.parse(raw) as Partial<StoredAxisGroups>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.views)) {
      return emptyStore();
    }
    const views = parsed.views.flatMap((view) => {
      if (
        typeof view !== "object" ||
        view === null ||
        typeof view.key !== "string" ||
        typeof view.updatedAt !== "number" ||
        !Array.isArray(view.groups)
      ) {
        return [];
      }
      const groups = view.groups.flatMap((group) => {
        if (
          typeof group !== "object" ||
          group === null ||
          typeof group.id !== "string" ||
          !Array.isArray(group.signalUuids) ||
          !group.signalUuids.every((uuid) => typeof uuid === "string")
        ) {
          return [];
        }
        return [{ id: group.id, signalUuids: group.signalUuids }];
      });
      return [{ key: view.key, updatedAt: view.updatedAt, groups }];
    });
    return { version: STORAGE_VERSION, views };
  } catch {
    return emptyStore();
  }
}

function writeStore(storage: AxisGroupStorage, store: StoredAxisGroups): void {
  try {
    storage.setItem(SIGNAL_AXIS_GROUPS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function loadSignalAxisGroups(
  signals: SignalData[],
  storage: AxisGroupStorage = window.localStorage,
): SignalAxisGroup[] {
  const identity = signalAxisGroupSelectionIdentity(signals);
  if (!identity.persistent) return defaultGroups(signals);
  const view = readStore(storage).views.find(
    (candidate) => candidate.key === identity.key,
  );
  if (!view) return defaultGroups(signals);

  const signalIdByUuid = new Map(
    signals.flatMap((signal) =>
      signal.uuid ? [[signal.uuid, signal.id] as const] : [],
    ),
  );
  return normalizeSignalAxisGroups(
    signals,
    view.groups.map((group) => ({
      id: group.id,
      signalIds: group.signalUuids.flatMap((uuid) => {
        const signalId = signalIdByUuid.get(uuid);
        return signalId ? [signalId] : [];
      }),
    })),
  );
}

export function persistSignalAxisGroups(
  signals: SignalData[],
  groups: readonly SignalAxisGroup[],
  storage: AxisGroupStorage = window.localStorage,
): void {
  const identity = signalAxisGroupSelectionIdentity(signals);
  if (!identity.persistent) return;
  const uuidBySignalId = new Map(
    signals.flatMap((signal) =>
      signal.uuid ? [[signal.id, signal.uuid] as const] : [],
    ),
  );
  const storedGroups = normalizeSignalAxisGroups(signals, groups).map(
    (group) => ({
      id: group.id,
      signalUuids: group.signalIds.flatMap((signalId) => {
        const uuid = uuidBySignalId.get(signalId);
        return uuid ? [uuid] : [];
      }),
    }),
  );
  const store = readStore(storage);
  const views = [
    {
      key: identity.key,
      updatedAt: Date.now(),
      groups: storedGroups,
    },
    ...store.views.filter((view) => view.key !== identity.key),
  ]
    .sort((first, second) => second.updatedAt - first.updatedAt)
    .slice(0, MAX_STORED_VIEWS);
  writeStore(storage, { version: STORAGE_VERSION, views });
}

export function removePersistedSignalAxisGroups(
  signals: SignalData[],
  storage: AxisGroupStorage = window.localStorage,
): void {
  const identity = signalAxisGroupSelectionIdentity(signals);
  if (!identity.persistent) return;
  const store = readStore(storage);
  writeStore(storage, {
    version: STORAGE_VERSION,
    views: store.views.filter((view) => view.key !== identity.key),
  });
}

export interface UseSignalAxisGroupsResult {
  groups: SignalAxisGroup[];
  applyGroups: (groups: readonly SignalAxisGroup[]) => void;
  resetGroups: () => void;
}

export function useSignalAxisGroups(
  signals: SignalData[],
): UseSignalAxisGroupsResult {
  const identity = signalAxisGroupSelectionIdentity(signals);
  const sessionViews = useRef(new Map<string, SignalAxisGroup[]>());
  const [, setRevision] = useState(0);
  const groups = identity.persistent
    ? loadSignalAxisGroups(signals)
    : normalizeSignalAxisGroups(
        signals,
        sessionViews.current.get(identity.key),
      );

  const applyGroups = useCallback(
    (nextGroups: readonly SignalAxisGroup[]) => {
      const normalized = normalizeSignalAxisGroups(signals, nextGroups);
      if (identity.persistent) {
        persistSignalAxisGroups(signals, normalized);
      } else {
        sessionViews.current.set(identity.key, normalized);
      }
      setRevision((current) => current + 1);
    },
    [identity.key, identity.persistent, signals],
  );

  const resetGroups = useCallback(() => {
    if (identity.persistent) {
      removePersistedSignalAxisGroups(signals);
    } else {
      sessionViews.current.delete(identity.key);
    }
    setRevision((current) => current + 1);
  }, [identity.key, identity.persistent, signals]);

  return { groups, applyGroups, resetGroups };
}
