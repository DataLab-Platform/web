import { describe, expect, it } from "vitest";

import {
  classifyShim,
  compareVersions,
  type ShimDescriptor,
} from "../../../src/runtime/shims/registry";

const BASE_SHIM: ShimDescriptor = {
  id: "example-backport",
  summary: "Synthetic backport used to test audit classification.",
  kind: "backport",
  targetPackage: "guidata",
  files: ["src/runtime/example_shim.py"],
  removableFrom: "3.15.0",
  loadedBy: ["src/runtime/runtime.ts"],
};

describe("shim audit classification", () => {
  it("compares dotted numeric versions by segment", () => {
    expect(compareVersions("1.1.10", "1.1.2")).toBe(1);
    expect(compareVersions("3.15", "3.15.0")).toBe(0);
    expect(compareVersions("3.14.4", "3.15.0")).toBe(-1);
  });

  it("marks a shim ready when the installed version reaches its floor", () => {
    expect(classifyShim(BASE_SHIM, "3.15.0").status).toBe("ready-to-remove");
    expect(classifyShim(BASE_SHIM, "3.16.0").status).toBe("ready-to-remove");
  });

  it("keeps a shim pending below its removal floor", () => {
    expect(classifyShim(BASE_SHIM, "3.14.4").status).toBe("pending");
  });

  it("reports an unknown floor before attempting version comparison", () => {
    expect(
      classifyShim({ ...BASE_SHIM, removableFrom: null }, "3.15.0").status,
    ).toBe("unknown");
  });

  it("skips classification when the installed version is unavailable", () => {
    expect(classifyShim(BASE_SHIM, null).status).toBe("skipped");
  });
});
