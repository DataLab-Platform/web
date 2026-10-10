import { t } from "../i18n/translate";
import type { PanelKind, PluginToolSummary } from "../runtime/runtime";

/** Return the message telling which objects to select to open a tool. */
function toolRequirement(tool: PluginToolSummary): string {
  const kind = tool.object_type;
  switch (tool.selection) {
    case "exactly_one":
      if (kind === "signal") return t("Select one signal");
      if (kind === "image") return t("Select one image");
      return t("Select one object");
    case "at_least_one":
      if (kind === "signal") return t("Select at least one signal");
      if (kind === "image") return t("Select at least one image");
      return t("Select at least one object");
    default:
      if (kind === "signal") return t("Select at least two signals");
      if (kind === "image") return t("Select at least two images");
      return t("Select at least two objects");
  }
}

/**
 * Return why a plugin tool cannot be opened on the selection, or ``null``.
 *
 * Only the objects of the tool's type count: a selection in the other
 * panel does not open an image tool, for instance.
 */
export function toolSelectionIssue(
  tool: PluginToolSummary,
  activePanel: PanelKind,
  selectedCount: number,
): string | null {
  const count =
    tool.object_type !== null && tool.object_type !== activePanel
      ? 0
      : selectedCount;
  const accepted = {
    none: true,
    exactly_one: count === 1,
    at_least_one: count >= 1,
    at_least_two: count >= 2,
  }[tool.selection];
  return accepted ? null : toolRequirement(tool);
}
