// Copyright (c) DataLab Platform Developers, BSD 3-Clause License
// See LICENSE file for details
import { describe, expect, it } from "vitest";

import { workspaceFilename } from "../../../src/components/CapsuleDialog";

describe("workspaceFilename", () => {
  it.each([
    ["https://example.org/data/run-12.h5", "run-12.h5"],
    ["https://example.org/data/run 12", "run_12.h5"],
    [
      "urn:uuid:7f1c2a9e-1b2c-4d5e-8f90-123456789abc",
      "7f1c2a9e-1b2c-4d5e-8f90-123456789abc.h5",
    ],
    ["", "workspace.h5"],
  ])("names %s as %s", (iri, expected) => {
    expect(workspaceFilename(iri)).toBe(expected);
  });
});
