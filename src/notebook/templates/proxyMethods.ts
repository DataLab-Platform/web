/**
 * "Proxy methods" notebook template — transposition of the
 * ``call_method_macro.py`` macro template.
 *
 * Focuses on the introspection / generic-callback surface of the
 * ``proxy``: enumerating workspace objects, switching panels and
 * discovering registered features through ``proxy.list_features()``.
 */
import {
  emptyCodeCell,
  emptyMarkdownCell,
  emptyNotebook,
  type NotebookModel,
} from "../types";

const INTRO_MD = [
  "# Proxy methods",
  "",
  "This notebook tours the **introspection** side of the `proxy`",
  "object — the same one used in macros. It does not create any new",
  "data; it only inspects the live workspace.",
  "",
  "All `proxy` methods are coroutines, so every cell uses `await`.",
].join("\n");

const LIST_MD = [
  "## Enumerate workspace objects",
  "",
  "`proxy.list_signals()` / `proxy.list_images()` return the current",
  "contents of each panel as a list of metadata dicts.",
].join("\n");

const LIST_CODE = [
  "sigs = await proxy.list_signals()",
  "imgs = await proxy.list_images()",
  'print(f"Signals: {len(sigs)} | Images: {len(imgs)}")',
  "",
  "# Show the first few titles, if any",
  "for meta in sigs[:5]:",
  "    print(f\"  signal: {meta.get('title')}\")",
  "for meta in imgs[:5]:",
  "    print(f\"  image:  {meta.get('title')}\")",
].join("\n");

const PANEL_MD = [
  "## Inspect and switch panels",
  "",
  "`get_current_panel` / `set_current_panel` mirror the side-tab",
  'switcher in the GUI (`"signal"` or `"image"`).',
].join("\n");

const PANEL_CODE = [
  'await proxy.set_current_panel("signal")',
  'print(f"Current panel: {await proxy.get_current_panel()}")',
  'print(f"Current object UUID: {await proxy.get_current_object_uuid()}")',
].join("\n");

const FEATURES_MD = [
  "## Discover registered features",
  "",
  "`proxy.list_features()` returns the JSON-friendly catalogue used by",
  "`proxy.calc(feature_id, ...)`. Signal features use a bare id",
  '(e.g. `"normalize"`); image features are namespaced under',
  '`"image:..."` (e.g. `"image:fft"`); plugin features under',
  '`"plugin:..."`.',
  "",
  "The cell below prints the first ten feature ids of each kind so you",
  "can copy/paste one straight into `proxy.calc(...)`.",
].join("\n");

const FEATURES_CODE = [
  "catalog = await proxy.list_features()",
  'print(f"Total features: {len(catalog)}")',
  "",
  "# Signal features are bare ids; image features are prefixed with",
  '# "image:"; plugin features with "plugin:".',
  'image_ids = [f["id"] for f in catalog if f["id"].startswith("image:")]',
  'plugin_ids = [f["id"] for f in catalog if f["id"].startswith("plugin:")]',
  "signal_ids = [",
  '    f["id"]',
  "    for f in catalog",
  '    if not f["id"].startswith(("image:", "plugin:"))',
  "]",
  "",
  'print("\\nFirst signal features:")',
  "for fid in signal_ids[:10]:",
  '    print(f"  {fid}")',
  'print("\\nFirst image features:")',
  "for fid in image_ids[:10]:",
  '    print(f"  {fid}")',
].join("\n");

/**
 * Build a fresh "Proxy methods" notebook (new cell ids on every call
 * so it can be opened multiple times safely).
 */
export function buildProxyMethodsNotebook(): NotebookModel {
  const nb = emptyNotebook("Proxy methods");
  nb.cells = [
    emptyMarkdownCell(INTRO_MD),
    emptyMarkdownCell(LIST_MD),
    emptyCodeCell(LIST_CODE),
    emptyMarkdownCell(PANEL_MD),
    emptyCodeCell(PANEL_CODE),
    emptyMarkdownCell(FEATURES_MD),
    emptyCodeCell(FEATURES_CODE),
  ];
  return nb;
}
