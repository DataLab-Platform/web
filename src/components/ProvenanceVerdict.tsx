/**
 * ProvenanceVerdict — verdict of the verification of a recorded activity.
 *
 * Shared by the capsule dialog and the object provenance panel: the verdict
 * and eligibility of a ``report-1`` document, with the reason of a refusal and
 * the details of the outputs that were not found equal.
 */

import type { ProvenanceReport } from "../runtime/runtime";
import { t } from "../i18n/translate";

/** Reason of a refusal and details of the outputs that were not found equal. */
export function reportDetails(report: ProvenanceReport): string[] {
  const details = report.reason ? [report.reason] : [];
  for (const output of report.outputs ?? []) {
    if (output.detail) {
      details.push(`${output.role}: ${output.detail}`);
    }
  }
  return details;
}

/** Translated text of a verification verdict. */
export function verdictText(verdict: string): string {
  switch (verdict) {
    case "exact":
      return t("Exact");
    case "within_tolerance":
      return t("Within tolerance");
    case "different":
      return t("Different");
    case "not_verified":
      return t("Not verified");
    default:
      return verdict;
  }
}

/** Translated text of the eligibility code of a verification report. */
export function eligibilityText(eligibility: string): string {
  switch (eligibility) {
    case "ready":
      return t("ready");
    case "missing_input":
      return t("input missing");
    case "input_changed":
      return t("input changed");
    case "unsupported_operation":
      return t("operation not supported");
    case "unsupported_contract":
      return t("operation version not supported");
    case "unsupported_context":
      return t("context not supported");
    case "invalid_parameters":
      return t("invalid parameters");
    default:
      return eligibility;
  }
}

/** Verdict and eligibility of a report, e.g. ``Exact (ready)``. */
export function reportSummary(report: ProvenanceReport): string {
  return `${verdictText(report.verdict)} (${eligibilityText(report.eligibility)})`;
}

export function ProvenanceVerdict({ report }: { report: ProvenanceReport }) {
  const details = reportDetails(report);
  const environment = report.environment as { match?: string } | undefined;
  return (
    <div className="provenance-verdict" data-testid="provenance-verdict">
      <div>
        {t("Verification: {verdict}", { verdict: verdictText(report.verdict) })}{" "}
        <span className="provenance-muted">
          ({eligibilityText(report.eligibility)})
        </span>
      </div>
      {details.length > 0 && (
        <ul className="provenance-details">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      )}
      {environment?.match === "different" && (
        <div className="provenance-muted">
          {t("The software environment differs from the recorded one.")}
        </div>
      )}
    </div>
  );
}
