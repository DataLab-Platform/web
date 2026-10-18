/**
 * Verdicts and eligibility codes of verification reports are shown as
 * translated text, never as raw codes.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  eligibilityText,
  reportSummary,
  verdictText,
} from "../../../src/components/ProvenanceVerdict";
import { setActiveLocale } from "../../../src/i18n/locale";
import type { ProvenanceReport } from "../../../src/runtime/runtime";

const ELIGIBILITY_CODES = [
  "ready",
  "missing_input",
  "input_changed",
  "unsupported_operation",
  "unsupported_contract",
  "unsupported_context",
  "invalid_parameters",
];

afterEach(() => {
  setActiveLocale("en", { reload: false });
});

describe("verification report texts", () => {
  it("gives a text to every eligibility code of report-1", () => {
    for (const code of ELIGIBILITY_CODES) {
      expect(eligibilityText(code)).not.toContain("_");
    }
    expect(eligibilityText("future_code")).toBe("future_code");
  });

  it("summarises a report with its translated verdict and eligibility", () => {
    const report = {
      verdict: "not_verified",
      eligibility: "input_changed",
    } as ProvenanceReport;
    expect(reportSummary(report)).toBe("Not verified (input changed)");
    setActiveLocale("fr", { reload: false });
    expect(verdictText("exact")).toBe("Exact");
    expect(reportSummary(report)).toBe("Non vérifié (entrée modifiée)");
  });
});
