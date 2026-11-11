/**
 * Unit tests for the DataLab-Web i18n core: locale normalisation /
 * detection, the ``t()`` translation helper (lookup, fallback,
 * placeholder interpolation) and the Pyodide ``LANG`` mapping.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setActiveLocale, pyodideLang } from "../../../src/i18n/locale";
import { t } from "../../../src/i18n/translate";

afterEach(() => {
  // Reset to the source language so tests stay independent. ``reload:false``
  // only mutates the in-memory active locale (no navigation).
  setActiveLocale("en", { reload: false });
  vi.restoreAllMocks();
});

describe("t() translation helper", () => {
  it("returns the French translation for a known key", () => {
    setActiveLocale("fr", { reload: false });
    expect(t("Processing")).toBe("Traitement");
    expect(t("Open signal…")).toBe("Ouvrir le signal…");
  });

  it("falls back to the English key for English (identity locale)", () => {
    setActiveLocale("en", { reload: false });
    expect(t("Processing")).toBe("Processing");
  });

  it("falls back to the key when no translation exists", () => {
    setActiveLocale("fr", { reload: false });
    expect(t("A string that is not in any catalog")).toBe(
      "A string that is not in any catalog",
    );
  });

  it("interpolates {name} placeholders from vars", () => {
    setActiveLocale("en", { reload: false });
    expect(t("Delete {count} objects?", { count: 3 })).toBe(
      "Delete 3 objects?",
    );
  });

  it("leaves unmatched placeholders untouched", () => {
    setActiveLocale("en", { reload: false });
    expect(t("Hello {name}", {})).toBe("Hello {name}");
  });
});

describe("lazily loaded catalogs", () => {
  it("merges the showcase catalog when its chunk loads", async () => {
    setActiveLocale("fr", { reload: false });
    // Kept out of the initial bundle: not translated before the showcase
    // chunk is loaded.
    expect(t("Try DataLab Web now")).toBe("Try DataLab Web now");
    await import("../../../src/showcase/i18n");
    expect(t("Try DataLab Web now")).toBe("Essayez DataLab Web dès maintenant");
    // The main catalog is still there.
    expect(t("Processing")).toBe("Traitement");
  });
});

describe("pyodideLang()", () => {
  it("maps English to the POSIX C locale", () => {
    expect(pyodideLang("en")).toBe("C");
  });

  it("maps other locales to their bare code", () => {
    expect(pyodideLang("fr")).toBe("fr");
  });

  it("uses the active locale when no argument is given", () => {
    setActiveLocale("fr", { reload: false });
    expect(pyodideLang()).toBe("fr");
    setActiveLocale("en", { reload: false });
    expect(pyodideLang()).toBe("C");
  });
});
