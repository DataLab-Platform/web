import { t } from "../i18n/translate";
import type {
  PluginRecipeAssessment,
  PluginRecipeDiagnostic,
  PluginRecipeInputIssue,
  PluginRecipeSlot,
} from "../runtime/runtime";

/** Describe how many objects of which type a recipe input slot expects. */
export function formatSlotKind(slot: PluginRecipeSlot): string {
  const signal = slot.object_type === "signal";
  let text: string;
  if (slot.cardinality === "one") {
    text = signal ? t("One signal") : t("One image");
  } else if (slot.min_count > 1) {
    text = signal
      ? t("At least {count} signals", { count: slot.min_count })
      : t("At least {count} images", { count: slot.min_count });
  } else {
    text = signal ? t("One or more signals") : t("One or more images");
  }
  return slot.required ? text : t("{kind} (optional)", { kind: text });
}

/** Return the user-facing title of a recipe input slot. */
export function slotTitle(slots: PluginRecipeSlot[], slotId: string): string {
  return (
    slots.find((slot) => slot.id === slotId)?.title ||
    slotId.replaceAll("_", " ")
  );
}

/** Describe one generic problem found on a recipe input slot. */
export function formatInputIssue(
  issue: PluginRecipeInputIssue,
  slots: PluginRecipeSlot[],
): string {
  const values = {
    slot: slotTitle(slots, issue.slot_id),
    count: issue.details.count ?? 0,
    min_count: issue.details.min_count ?? 1,
    key: issue.details.key ?? "",
    titles: (issue.details.titles ?? []).join(", "),
  };
  switch (issue.code) {
    case "missing":
      return t("{slot}: no object assigned", values);
    case "ambiguous":
      return t("{slot}: choose the objects to use", values);
    case "too_few":
      return t(
        "{slot}: {count} object(s) assigned, at least {min_count} required",
        values,
      );
    case "too_many":
      return t("{slot}: accepts only one object ({count} assigned)", values);
    case "wrong_type":
      return t(
        "{slot}: {count} object(s) of the wrong type ({titles})",
        values,
      );
    case "missing_metadata":
      return t(
        "{slot}: metadata '{key}' missing on {count} object(s) ({titles})",
        values,
      );
    case "duplicate":
      return t("{slot}: {count} object(s) assigned twice ({titles})", values);
  }
}

/** Describe one diagnostic returned by a recipe input check. */
export function formatDiagnostic(diagnostic: PluginRecipeDiagnostic): string {
  const labels = {
    error: t("Error"),
    warning: t("Warning"),
    info: t("Information"),
  };
  return `${labels[diagnostic.level]}: ${diagnostic.message}`;
}

/** Return the summary and the reasons of a recipe readiness assessment. */
export function formatReadiness(
  assessment: PluginRecipeAssessment,
  slots: PluginRecipeSlot[],
): { summary: string; reasons: string[] } {
  if (assessment.status === "error") {
    return {
      summary: t("The current selection could not be assessed"),
      reasons: [assessment.error],
    };
  }
  const summaries = {
    ready: t("Ready to run on the current selection"),
    warnings: t("Ready to run, with warnings"),
    needs_assignment: t("Ready to run once the inputs are assigned"),
    not_ready: t("The current selection cannot be analyzed"),
    no_input: t("Select the input data in the workspace"),
  };
  const reasons = assessment.issues.map((issue) =>
    formatInputIssue(issue, slots),
  );
  if (assessment.issues.some((issue) => issue.code === "missing_metadata")) {
    reasons.push(t("To set it, use Edit > Metadata > Add metadata…"));
  }
  if (assessment.status !== "no_input") {
    reasons.push(...assessment.diagnostics.map(formatDiagnostic));
  }
  return { summary: summaries[assessment.status], reasons };
}
