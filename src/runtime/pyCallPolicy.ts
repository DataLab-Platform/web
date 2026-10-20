/**
 * Policies applied by {@link DataLabRuntime} to its Python calls.
 *
 * Kept apart from the runtime (pure data and functions, no Pyodide) so the
 * audit tests can check them against the call sites of ``runtime.ts`` and
 * the Python functions of ``bootstrap.py``: a new call that reads, adds or
 * deletes objects without being covered here makes those tests fail.
 */

/**
 * Workspace mutation tracker.
 *
 * Lists every ``bootstrap.py`` callable that mutates the durable workspace
 * state — i.e. anything whose effect is persisted by
 * ``save_workspace_to_bytes`` and would be lost on reload unless saved as an
 * HDF5 workspace. ``callPy`` invokes all registered mutation listeners after
 * each successful call to one of these functions, so the React layer can flip
 * a single "workspace dirty" flag without sprinkling ``markDirty()`` at every
 * UI call site.
 *
 * Keep this list narrow on purpose: read-only helpers (``list_*``,
 * ``get_*``, schema queries, IO format probes) must NOT appear here.
 * ``open_workspace_from_bytes`` and ``save_workspace_to_bytes`` are
 * intentionally absent — they're the *clean* transitions, handled separately
 * in ``App.tsx``.
 */
export const MUTATING_PY_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  // Object model — signals & images
  "create_signal",
  "create_signal_typed",
  "create_image",
  "create_image_typed",
  "add_signal_from_arrays",
  "add_image_from_array",
  "set_signal_style",
  "update_signal_creation_params",
  "update_image_creation_params",
  "set_object_property_values",
  "set_object_metadata_value",
  "delete_object_metadata_key",
  "paste_object_metadata",
  "add_object_metadata",
  "delete_object_metadata",
  "import_object_metadata_bytes",
  "set_object_meta",
  "set_signal_roi",
  "delete_signal_roi_at",
  "set_image_roi",
  "delete_image_roi_at",
  "create_image_roi_grid",
  "extract_signal_rois",
  "extract_image_rois",
  "delete_object",
  "delete_all_objects",
  "delete_signal",
  "rename_object",
  "move_object",
  "move_objects",
  "create_group",
  "rename_group",
  "delete_group",
  "set_plotly_annotations",
  "set_lut_range",
  "set_colormap",
  "clear_signal_results",
  "clear_image_results",
  "erase_image_area",
  "distribute_images_on_grid",
  "reset_image_positions",
  "apply_feature",
  "apply_processing",
  "reapply_last_processing",
  "run_signal_analysis",
  "run_image_analysis",
  "run_plugin_recipe",
  "launch_plugin_tool",
  "acquire_plugin_instrument",
  "open_signal_from_bytes",
  "open_image_from_bytes",
  "open_from_directory_chunk",
  "import_signal_csv",
  "commit_text_import",
  "add_object_pickled",
  "set_object_pickled",
  "reset_all",
  // Macros
  "create_macro",
  "rename_macro",
  "delete_macro",
  "set_macro_code",
  "duplicate_macro",
  "reorder_macros",
  "replace_macros",
  // Notebooks
  "create_notebook",
  "rename_notebook",
  "delete_notebook",
  "set_notebook_content",
  "duplicate_notebook",
  "reorder_notebooks",
  "replace_notebooks",
]);

/** Calls whose scientific refusals come back as data (``bridge_<name>`` in
 *  bootstrap.py), not as a Python traceback to format. */
export const REFUSABLE: ReadonlySet<string> = new Set<string>([
  "apply_feature",
  "check_feature_inputs",
  "preview_feature",
  "apply_processing",
  "reapply_last_processing",
]);

// ---------------------------------------------------------------------------
// On-disk storage mode (OPFS spill / page-in)
// ---------------------------------------------------------------------------

/** kwarg keys carrying the id of one object whose data the call reads. */
export const PAGE_IN_ID_KEYS: readonly string[] = [
  "oid",
  "id",
  "operand_id",
  "source_id",
  "current_oid",
  "source_oid",
];

/** kwarg keys carrying a list of ids of objects whose data the call reads
 *  (a single id is also accepted). */
export const PAGE_IN_ID_LIST_KEYS: readonly string[] = [
  "oids",
  "ids",
  "source_ids",
  "selected_oids",
  "selected_ids",
  "candidate_ids",
];

/** kwarg keys carrying a mapping whose values are lists of ids of objects
 *  whose data the call reads (e.g. recipe input slot → objects). */
export const PAGE_IN_ID_MAPPING_KEYS: readonly string[] = ["bindings"];

/**
 * Identifier-like kwarg keys that never designate an object whose data the
 * call reads, so the disk guard deliberately ignores them. Checked by the
 * audit of ``runtime.ts`` call sites: an unknown ``*_id(s)`` / ``*oid(s)``
 * key must be added either to a ``PAGE_IN_*`` list or here.
 */
export const NON_OBJECT_ID_KEYS: readonly string[] = [
  // Groups: group-wise processing always lists the selected objects in
  // ``source_ids`` too, and moving objects between groups reads no data.
  "group_id",
  "group_ids",
  "target_group_id",
  // Provenance: consulting reads the ledger only; ``replay_activity`` pages
  // in the objects of its activity through ``PAGE_IN_RESOLVERS``.
  "activity_id",
  "object_id",
  "state_id",
  "command_id",
  // Catalogues, plugins and their components.
  "feature_id",
  "func_id",
  "processing_id",
  "fit_id",
  "plugin_id",
  "recipe_id",
  "tool_id",
  "example_id",
  "action_id",
  // HDF5 browser files and nodes (not workspace objects).
  "file_id",
  "node_id",
  "node_ids",
  // Macros and notebooks.
  "macro_id",
  "macro_ids",
  "notebook_id",
  "notebook_ids",
];

/** Calls that delete their referenced objects — never page those in. */
export const DELETES_OBJECTS: ReadonlySet<string> = new Set<string>([
  "delete_object",
  "delete_all_objects",
  "delete_group",
]);

/** Calls that iterate the *whole* model and need every array resident
 *  (e.g. workspace serialisation, or plugin menu actions, whose code may read
 *  any object: the browser bridge has no live selection model). */
export const NEEDS_ALL_RESIDENT: ReadonlySet<string> = new Set<string>([
  "save_workspace_to_bytes",
  "export_workspace_capsule",
  "export_referenced_capsule",
  "trigger_plugin_action",
]);

/** Calls that never read object data although they name objects: their
 *  description reports arrays on disk as unavailable instead. */
export const NEVER_PAGES_IN: ReadonlySet<string> = new Set<string>([
  "describe_object_provenance",
  "describe_provenance_activity",
]);

/**
 * Calls whose objects to page in are not the ones named by their kwargs: a
 * Python helper returns them, called with the listed kwargs of the call.
 */
export const PAGE_IN_RESOLVERS: ReadonlyMap<
  string,
  { helper: string; kwargs: readonly string[] }
> = new Map([
  // Inputs and recorded outputs of the activity verified.
  [
    "replay_activity",
    { helper: "activity_object_ids", kwargs: ["activity_id"] },
  ],
  // The source read to initialize the parameters — never the result itself.
  [
    "get_last_processing",
    { helper: "last_processing_input_ids", kwargs: ["oid"] },
  ],
]);

/** Calls that replace the whole model with freshly-loaded objects (unless
 *  called with ``replace=false``), so the on-disk store is reset. */
export const REPLACES_MODEL: ReadonlySet<string> = new Set<string>([
  "open_workspace_from_bytes",
  "open_workspace_capsule",
  "reset_all",
]);

/** Calls that change an existing object's heavy array **in place**, so a
 *  paged-in operand is always re-serialised. Other in-place changes are
 *  detected from the data revisions kept by ``bootstrap.py``. */
export const MUTATES_HEAVY: ReadonlySet<string> = new Set<string>([
  "set_image_data",
  "set_signal_xydata",
  "reapply_last_processing",
  "update_image_creation_params",
  "update_signal_creation_params",
]);

/** Calls adding, deleting or replacing objects that are not workspace
 *  mutations in the sense of {@link MUTATING_PY_FUNCTIONS}. */
export const DISK_SWEEP_EXTRA_CALLS: ReadonlySet<string> = new Set<string>([
  "duplicate_object",
  "commit_interactive_fit",
  "plot_results",
  "h5_browser_import",
  "open_plugin_example",
  // Plugin code, invisible to the audit of the Python sources.
  "trigger_plugin_action",
]);

function unionOf(...sets: ReadonlySet<string>[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const set of sets) for (const name of set) out.add(name);
  return out;
}

/**
 * Calls after which the disk guard reconciles the on-disk store with the
 * model: on-disk copies of objects that left the model are deleted, and
 * objects left in memory (created, loaded or replaced) are spilled. Checked
 * against the Python functions that add, delete or replace objects by
 * ``tests/python/test_py_call_policy_audit.py``.
 */
export const DISK_SWEEP_CALLS: ReadonlySet<string> = unionOf(
  MUTATING_PY_FUNCTIONS,
  REPLACES_MODEL,
  DELETES_OBJECTS,
  DISK_SWEEP_EXTRA_CALLS,
);

/** What the disk guard pages in before a call. */
export type PageInPlan =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "ids"; oids: string[] }
  | { kind: "resolve"; helper: string; kwargs: Record<string, unknown> };

/** Collect the distinct object ids named by *kwargs* through the
 *  ``PAGE_IN_*`` keys. */
export function referencedOids(kwargs: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const addAll = (value: unknown): void => {
    if (typeof value === "string") out.add(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") out.add(item);
    }
  };
  for (const key of PAGE_IN_ID_KEYS) {
    const value = kwargs[key];
    if (typeof value === "string") out.add(value);
  }
  for (const key of PAGE_IN_ID_LIST_KEYS) addAll(kwargs[key]);
  for (const key of PAGE_IN_ID_MAPPING_KEYS) {
    const value = kwargs[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const item of Object.values(value)) addAll(item);
    }
  }
  return Array.from(out);
}

/** Return what the disk guard must page in before calling *name*. */
export function pageInPlan(
  name: string,
  kwargs: Record<string, unknown>,
): PageInPlan {
  if (DELETES_OBJECTS.has(name) || NEVER_PAGES_IN.has(name)) {
    return { kind: "none" };
  }
  if (NEEDS_ALL_RESIDENT.has(name)) return { kind: "all" };
  const resolver = PAGE_IN_RESOLVERS.get(name);
  if (resolver) {
    return {
      kind: "resolve",
      helper: resolver.helper,
      kwargs: Object.fromEntries(resolver.kwargs.map((k) => [k, kwargs[k]])),
    };
  }
  return { kind: "ids", oids: referencedOids(kwargs) };
}
