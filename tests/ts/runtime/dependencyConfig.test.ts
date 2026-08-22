import { describe, expect, it } from "vitest";

import sigimaDependency from "../../../sigima-dependency.json";
import {
  SIGIMA_PUBLISHED_REQUIREMENT,
  resolveSigimaInstallSpec,
} from "../../../src/runtime/dependencyConfig";

describe("Sigima dependency configuration", () => {
  it("uses the exact published requirement from the manifest by default", () => {
    expect(SIGIMA_PUBLISHED_REQUIREMENT).toBe(
      sigimaDependency.publishedRequirement,
    );
    expect(resolveSigimaInstallSpec()).toBe(
      sigimaDependency.publishedRequirement,
    );
  });

  it("gives a local or CI wheel override priority", () => {
    const wheel = "/@fs/C:/build/sigima-1.3.0-py3-none-any.whl";

    expect(resolveSigimaInstallSpec(wheel)).toBe(wheel);
  });

  it("ignores every override in a release-qualified build", () => {
    const wheel = "/@fs/C:/build/sigima-1.3.0-py3-none-any.whl";

    expect(resolveSigimaInstallSpec(wheel, true)).toBe(
      sigimaDependency.publishedRequirement,
    );
  });
});
