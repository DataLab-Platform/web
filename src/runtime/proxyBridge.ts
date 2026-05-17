/**
 * Shared whitelist of ``proxy.*`` bridge methods reachable from worker
 * Pyodide instances (macro and notebook).
 *
 * The macro worker and notebook worker share the same Python ``proxy``
 * object (defined in :mod:`macro_proxy`). Both runtimes therefore route
 * the same set of bridge calls — keeping them in sync is mandatory.
 * This module is the single source of truth.
 */

import type { DataLabRuntime } from "./runtime";

export interface BridgeExternalCallbacks {
  getSelection?: () => string[];
  getCurrentPanel?: () => string;
  setCurrentPanel?: (panel: string) => void;
  selectObjects?: (ids: string[], panel: string | null) => void;
  onModelChanged?: (panel: string | null) => void;
  callMethod?: (
    name: string,
    args: unknown[],
    kwargs: Record<string, unknown>,
  ) => Promise<unknown>;
}

export type BridgeMethod = (payload: unknown) => Promise<unknown>;

export function buildProxyBridge(
  s: DataLabRuntime,
  ext: BridgeExternalCallbacks,
): Record<string, BridgeMethod> {
  return {
    add_signal: async (p: unknown) => {
      const a = p as {
        title: string;
        xdata: number[] | Float32Array | Float64Array;
        ydata: number[] | Float32Array | Float64Array;
        xunit?: string;
        yunit?: string;
        xlabel?: string;
        ylabel?: string;
        group_id?: string | null;
        dtype?: string;
      };
      const oid = await s.addSignalFromArrays({
        title: a.title,
        xdata: a.xdata,
        ydata: a.ydata,
        xunit: a.xunit ?? "",
        yunit: a.yunit ?? "",
        xlabel: a.xlabel ?? "",
        ylabel: a.ylabel ?? "",
        group_id: a.group_id ?? null,
        dtype: a.dtype,
      });
      ext.onModelChanged?.("signal");
      ext.selectObjects?.([oid], "signal");
      return oid;
    },
    add_image: async (p: unknown) => {
      const a = p as {
        title: string;
        data: number[][] | Float32Array | Float64Array | Uint8Array;
        xunit?: string;
        yunit?: string;
        zunit?: string;
        xlabel?: string;
        ylabel?: string;
        zlabel?: string;
        group_id?: string | null;
        width?: number;
        height?: number;
        dtype?: string;
      };
      const oid = await s.addImageFromArray({
        title: a.title,
        data: a.data,
        xunit: a.xunit ?? "",
        yunit: a.yunit ?? "",
        zunit: a.zunit ?? "",
        xlabel: a.xlabel ?? "",
        ylabel: a.ylabel ?? "",
        zlabel: a.zlabel ?? "",
        group_id: a.group_id ?? null,
        width: a.width,
        height: a.height,
        dtype: a.dtype,
      });
      ext.onModelChanged?.("image");
      ext.selectObjects?.([oid], "image");
      return oid;
    },
    list_signals: async () => s.listSignals(),
    list_images: async () =>
      (await s.runPython(`
[{"id": oid, "title": e.obj.title}
 for oid, e in _MODEL._objects.items() if e.kind == "image"]
`)) as unknown,
    get_object: async (p: unknown) => {
      const oid = (p as { oid: string }).oid;
      return (await s.runPython(`
_e = _MODEL._objects[${JSON.stringify(oid)}]
{
  "id": _e.oid,
  "kind": _e.kind,
  "title": _e.obj.title,
}
`)) as unknown;
    },
    get_object_uuids: async (p: unknown) => {
      const panel = (p as { panel: string }).panel;
      return (await s.runPython(`
[oid for oid, e in _MODEL._objects.items() if e.kind == ${JSON.stringify(panel)}]
`)) as unknown;
    },
    delete_object: async (p: unknown) => {
      const oid = (p as { oid: string }).oid;
      await s.runPython(`_MODEL.delete_object(${JSON.stringify(oid)})`);
      ext.onModelChanged?.(null);
      return null;
    },
    add_object: async (p: unknown) => {
      const a = p as {
        pickled_b64: string;
        kind: string;
        group_id?: string | null;
        set_current?: boolean;
      };
      const oid = (await s.runPython(
        `add_object_pickled(${JSON.stringify(a.pickled_b64)}, ` +
          `${JSON.stringify(a.kind)}, ` +
          `${a.group_id ? JSON.stringify(a.group_id) : "None"})`,
      )) as string;
      ext.onModelChanged?.(a.kind);
      if (a.set_current !== false) {
        ext.selectObjects?.([oid], a.kind);
      }
      return oid;
    },
    set_object: async (p: unknown) => {
      const a = p as { pickled_b64: string };
      const oid = (await s.runPython(
        `set_object_pickled(${JSON.stringify(a.pickled_b64)})`,
      )) as string;
      ext.onModelChanged?.(null);
      return oid;
    },
    add_group: async (p: unknown) => {
      const a = p as {
        title: string;
        panel?: string | null;
        select?: boolean;
      };
      const panel = a.panel ?? ext.getCurrentPanel?.() ?? "signal";
      const gid = (await s.runPython(
        `create_group(${JSON.stringify(panel)}, ${JSON.stringify(a.title)})`,
      )) as string;
      ext.onModelChanged?.(panel);
      if (a.select) {
        ext.selectObjects?.([], panel);
      }
      return gid;
    },
    select_groups: async (p: unknown) => {
      const a = p as {
        selection?: (string | number)[] | null;
        panel?: string | null;
      };
      const panel = a.panel ?? ext.getCurrentPanel?.() ?? "signal";
      const sel =
        a.selection == null
          ? "None"
          : `[${a.selection
              .map((t) =>
                typeof t === "number" ? String(t) : JSON.stringify(t),
              )
              .join(", ")}]`;
      const oids = (await s.runPython(
        `resolve_group_oids(${JSON.stringify(panel)}, ${sel})`,
      )) as string[];
      ext.selectObjects?.(oids, panel);
      return oids;
    },
    get_group_titles_with_object_info: async (p: unknown) => {
      const a = (p ?? {}) as { panel?: string | null };
      const panel = a.panel ?? ext.getCurrentPanel?.() ?? "signal";
      return (await s.runPython(
        `get_group_titles_with_object_info(${JSON.stringify(panel)})`,
      )) as unknown;
    },
    reset_all: async () => {
      await s.runPython("reset_all()");
      ext.onModelChanged?.(null);
      return null;
    },
    /** Read back the X/Y arrays of a signal (notebook ``show_signal``).
     *  Honours ``encoding="bytes"`` requests from the remote SDK so
     *  large signals travel as a typed-array memcpy rather than
     *  through a million-element JSON list. */
    get_signal_xy: async (p: unknown) => {
      const a = p as { oid: string; encoding?: string };
      if (a.encoding === "bytes") {
        return s.getSignalDataBinary(a.oid);
      }
      return s.getSignalData(a.oid);
    },
    /** Read back the 2D array of an image (notebook ``show_image``). */
    get_image_data: async (p: unknown) => {
      const oid = (p as { oid: string }).oid;
      return s.getImageData(oid);
    },
    apply_feature: async (p: unknown) => {
      const a = p as {
        feature_id: string;
        params: Record<string, unknown> | null;
        sources: string[] | null;
        operand: string | null;
      };
      const sources = a.sources ?? ext.getSelection?.() ?? [];
      const ids = await s.applyFeature(
        a.feature_id,
        sources,
        a.operand,
        a.params,
      );
      // Mirror DataLab desktop: auto-select the (last) result object,
      // switching panel if the feature is cross-kind.  Each desktop
      // ``add_object`` call defaults to ``set_current=True``, so for
      // ``1_to_n`` patterns the last result is the one selected.
      if (ids.length > 0) {
        const lastId = ids[ids.length - 1];
        const kind = (await s.runPython(
          `_MODEL.kind_of(${JSON.stringify(lastId)})`,
        )) as string;
        ext.onModelChanged?.(kind);
        ext.selectObjects?.([lastId], kind);
      } else {
        ext.onModelChanged?.(null);
      }
      return ids;
    },
    list_features: async () => s.listFeatures(),
    get_current_panel: async () => ext.getCurrentPanel?.() ?? "signal",
    set_current_panel: async (p: unknown) => {
      const panel = (p as { panel: string }).panel;
      ext.setCurrentPanel?.(panel);
      return null;
    },
    select_objects: async (p: unknown) => {
      const a = p as { oids: string[]; panel: string | null };
      ext.selectObjects?.(a.oids, a.panel);
      return null;
    },
    /** Return the id list currently selected on the active panel.
     *  Empty when nothing is selected (or no host is wired). */
    get_selection: async () => ext.getSelection?.() ?? [],
    call_method: async (p: unknown) => {
      const a = p as {
        name: string;
        args: unknown[];
        kwargs: Record<string, unknown>;
      };
      const handler = ext.callMethod;
      if (!handler) {
        throw new Error("call_method bridge not wired");
      }
      return handler(a.name, a.args, a.kwargs);
    },
  };
}
