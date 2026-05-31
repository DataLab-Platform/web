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
import { extractSection } from "../../../scripts/extract-changelog.mjs";

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
