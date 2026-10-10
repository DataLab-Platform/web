import { describe, expect, it } from "vitest";

import guidataDependency from "../../../guidata-dependency.json";
import sigimaDependency from "../../../sigima-dependency.json";
import {
  GUIDATA_PUBLISHED_REQUIREMENT,
  SIGIMA_PUBLISHED_REQUIREMENT,
  resolveCapsuleInstallSpec,
  resolveInstallSpec,
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
