import { describe, expect, it } from "vitest";

import guidataDependency from "../../../guidata-dependency.json";
import sigimaDependency from "../../../sigima-dependency.json";
import {
  GUIDATA_PUBLISHED_REQUIREMENT,
  SIGIMA_PUBLISHED_REQUIREMENT,
  resolveInstallSpec,
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

describe("guidata dependency configuration", () => {
  it("uses the published requirement from its manifest", () => {
    expect(GUIDATA_PUBLISHED_REQUIREMENT).toBe(
      guidataDependency.publishedRequirement,
    );
  });

  it("applies the same override and release rules", () => {
    const wheel = "/@fs/C:/build/guidata-3.16.0-py3-none-any.whl";

    expect(resolveInstallSpec(GUIDATA_PUBLISHED_REQUIREMENT, wheel)).toBe(
      wheel,
    );
    expect(resolveInstallSpec(GUIDATA_PUBLISHED_REQUIREMENT, wheel, true)).toBe(
      GUIDATA_PUBLISHED_REQUIREMENT,
    );
  });
});
