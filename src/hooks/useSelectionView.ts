import { useEffect, useReducer, useRef } from "react";

import type {
  AnalysisResult,
  ImageData,
  ImageRoiSegment,
  PanelKind,
  PlotlyAnnotations,
  RuntimeApi,
  SignalData,
  SignalResultBundle,
  SignalRoiSegment,
} from "../runtime/runtime";

export const MULTI_SELECTION_DEBOUNCE_MS = 75;

interface SelectionViewState {
  data: SignalData | null;
  extraSignals: SignalData[];
  imageData: ImageData | null;
  extraImages: ImageData[];
  annotations: PlotlyAnnotations;
  roi: SignalRoiSegment[];
  imageRoi: ImageRoiSegment[];
  imageLutRange: [number, number] | null;
  results: AnalysisResult[];
  extraResults: SignalResultBundle[];
}

type SelectionViewAction = { type: "replace"; value: SelectionViewState };

function emptySelectionView(): SelectionViewState {
  return {
    data: null,
    extraSignals: [],
    imageData: null,
    extraImages: [],
    annotations: { shapes: [], annotations: [] },
    roi: [],
    imageRoi: [],
    imageLutRange: null,
    results: [],
    extraResults: [],
  };
}

function selectionViewReducer(
  _state: SelectionViewState,
  action: SelectionViewAction,
): SelectionViewState {
  return action.value;
}

interface UseSelectionViewOptions {
  runtime: RuntimeApi | null;
  currentId: string | null;
  selectedIds: string[];
  treeKind: PanelKind;
  refreshNonce: number;
  maxImages: number;
}

export function useSelectionView({
  runtime,
  currentId,
  selectedIds,
  treeKind,
  refreshNonce,
  maxImages,
}: UseSelectionViewOptions): SelectionViewState {
  const [state, dispatch] = useReducer(
    selectionViewReducer,
    undefined,
    emptySelectionView,
  );
  const lastSelectionKey = useRef("");
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const selectedIdsKey = JSON.stringify(selectedIds);

  useEffect(() => {
    const stableSelectedIds = selectedIdsRef.current;
    const selectionKey = `${treeKind}:${currentId ?? ""}:${selectedIdsKey}`;
    if (selectionKey !== lastSelectionKey.current) {
      lastSelectionKey.current = selectionKey;
      dispatch({ type: "replace", value: emptySelectionView() });
    }
    if (!runtime || !currentId) return;

    let cancelled = false;
    let timer: number | undefined;
    const selectedForSnapshot =
      treeKind === "image"
        ? [
            currentId,
            ...stableSelectedIds
              .filter((id) => id !== currentId)
              .slice(0, Math.max(0, maxImages - 1)),
          ]
        : stableSelectedIds;

    const load = async () => {
      try {
        if (treeKind === "image") {
          const snapshot = await runtime.getImageViewSnapshot(
            currentId,
            selectedForSnapshot,
          );
          if (cancelled || snapshot === null) return;
          dispatch({
            type: "replace",
            value: {
              ...emptySelectionView(),
              imageData: snapshot.images[0] ?? null,
              extraImages: snapshot.images.slice(1),
              imageRoi: snapshot.roi,
              imageLutRange: snapshot.lut_range,
              results: snapshot.results,
            },
          });
          return;
        }
        const snapshot = await runtime.getSignalViewSnapshot(
          currentId,
          selectedForSnapshot,
        );
        if (cancelled || snapshot === null) return;
        dispatch({
          type: "replace",
          value: {
            ...emptySelectionView(),
            data: snapshot.current,
            extraSignals: snapshot.extras,
            annotations: snapshot.annotations,
            roi: snapshot.roi,
            results: snapshot.results,
            extraResults: snapshot.extra_results,
          },
        });
      } catch {
        if (!cancelled) {
          dispatch({ type: "replace", value: emptySelectionView() });
        }
      }
    };

    if (selectedForSnapshot.length > 1) {
      timer = window.setTimeout(load, MULTI_SELECTION_DEBOUNCE_MS);
    } else {
      void load();
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runtime, currentId, selectedIdsKey, treeKind, refreshNonce, maxImages]);

  return state;
}
