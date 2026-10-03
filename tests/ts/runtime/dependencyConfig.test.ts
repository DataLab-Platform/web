import { describe, expect, it } from "vitest";

import sigimaDependency from "../../../sigima-dependency.json";
import {
  SIGIMA_PUBLISHED_REQUIREMENT,
  resolveCapsuleInstallSpec,
  resolveSigimaInstallSpec,
} from "../../../src/runtime/dependencyConfig";

describe("DataLab-Capsule dependency configuration", () => {
  const wheel = "/@fs/C:/build/datalab_capsule-0.1.0-py3-none-any.whl";

  it("installs nothing while unpublished and without override", () => {
    expect(resolveCapsuleInstallSpec(undefined, false, null)).toBe("");
    expect(resolveCapsuleInstallSpec(wheel, true, null)).toBe("");
  });

  it("gives a development override priority outside releases", () => {
    expect(resolveCapsuleInstallSpec(wheel, false, null)).toBe(wheel);
    expect(
      resolveCapsuleInstallSpec(wheel, false, "datalab-capsule==0.1.0"),
    ).toBe(wheel);
  });

  it("uses only the published pin in a release build", () => {
    expect(
      resolveCapsuleInstallSpec(wheel, true, "datalab-capsule==0.1.0"),
    ).toBe("datalab-capsule==0.1.0");
  });
});

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
