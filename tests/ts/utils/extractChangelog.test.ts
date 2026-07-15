/**
 * Unit tests for the changelog section extractor used to build GitHub
 * Release notes from ``CHANGELOG.md`` (scripts/extract-changelog.mjs).
 *
 * The extractor must isolate exactly one version's body, drop the
 * heading line, normalise ``### Added in X.Y.Z`` sub-headings, and
 * return ``null`` for unknown versions so the release pipeline fails
 * loudly rather than shipping empty notes.
 */

import { describe, expect, it } from "vitest";
import {
  extractSection,
  promoteSubHeadings,
} from "../../../scripts/extract-changelog.mjs";

const SAMPLE = `# Changelog

Intro paragraph.

## [Unreleased]

### Added

- Something not yet released.

## [0.3.0] - 2026-05-23

### Added in 0.3.0

- First feature.
- Second feature.

### Fixed in 0.3.0

- A bug fix.

## [0.2.0] - 2026-05-22

### Added in 0.2.0

- Older feature.

[Unreleased]: https://example.com/compare/v0.3.0...HEAD
[0.3.0]: https://example.com/compare/v0.2.0...v0.3.0
`;

describe("extractSection", () => {
  it("extracts the body of a middle version without the heading line", () => {
    const out = extractSection(SAMPLE, "0.3.0");
    expect(out).not.toBeNull();
    expect(out).toContain("- First feature.");
    expect(out).toContain("- A bug fix.");
    // Must not leak into adjacent sections.
    expect(out).not.toContain("Older feature");
    expect(out).not.toContain("not yet released");
    // Heading line itself is dropped.
    expect(out).not.toMatch(/## \[0\.3\.0\]/);
  });

  it("normalises '### Added in X.Y.Z' sub-headings", () => {
    const out = extractSection(SAMPLE, "0.3.0") ?? "";
    expect(out).toContain("### Added");
    expect(out).toContain("### Fixed");
    expect(out).not.toContain("### Added in 0.3.0");
    expect(out).not.toContain("### Fixed in 0.3.0");
  });

  it("extracts the last version (no following heading)", () => {
    const out = extractSection(SAMPLE, "0.2.0") ?? "";
    expect(out).toContain("- Older feature.");
    // The bottom link references must not bleed into the section.
    expect(out).not.toContain("[Unreleased]:");
  });

  it("returns null for an unknown version", () => {
    expect(extractSection(SAMPLE, "9.9.9")).toBeNull();
  });

  it("does not treat a version as a regex prefix", () => {
    // '0.3' must not match '0.3.0' (the dot is escaped, brackets required).
    expect(extractSection(SAMPLE, "0.3")).toBeNull();
  });
});

describe("promoteSubHeadings", () => {
  it("suffixes bare sub-headings with ' in X.Y.Z'", () => {
    const body = "### Changed\n\n- A tweak.\n\n### Fixed\n\n- A bug fix.";
    const out = promoteSubHeadings(body, "0.7.0");
    expect(out).toContain("### Changed in 0.7.0");
    expect(out).toContain("### Fixed in 0.7.0");
    // Bullet content must be left untouched.
    expect(out).toContain("- A tweak.");
    expect(out).toContain("- A bug fix.");
  });

  it("rewrites the legacy 'in Unreleased' suffix", () => {
    const out = promoteSubHeadings(
      "### Added in Unreleased\n\n- New.",
      "1.0.0",
    );
    expect(out).toContain("### Added in 1.0.0");
    expect(out).not.toContain("Unreleased");
  });

  it("is idempotent on already-suffixed sub-headings", () => {
    const out = promoteSubHeadings("### Fixed in 0.7.0\n\n- Fix.", "0.7.0");
    expect(out).toBe("### Fixed in 0.7.0\n\n- Fix.");
  });

  it("leaves the top-level version heading untouched", () => {
    const out = promoteSubHeadings("## [Unreleased]\n\n### Added", "0.7.0");
    expect(out).toContain("## [Unreleased]");
    expect(out).toContain("### Added in 0.7.0");
  });

  it("is the inverse of extractSection normalisation", () => {
    const body = "### Added\n\n- One.\n\n### Fixed\n\n- Two.";
    const promoted = promoteSubHeadings(body, "0.7.0");
    const md = `## [0.7.0] - 2026-07-15\n\n${promoted}\n`;
    expect(extractSection(md, "0.7.0")).toBe(body);
  });
});
