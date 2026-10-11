import { describe, expect, it } from "vitest";

import {
  assertReleaseReady,
  checkReleaseDependencies,
  loadDependencyManifest,
  validateDependencyManifest,
} from "../../../scripts/check-sigima-release.mjs";

const PUBLISHED = "sigima==1.3.0";
const SHA = "4442ada873655f63fabd14369fd11170f75a28b4";
const assertSigimaReleaseReady = (manifest: unknown) =>
  assertReleaseReady(manifest, "sigima");
const validateSigimaDependencyManifest = (manifest: unknown) =>
  validateDependencyManifest(manifest, "sigima");

describe("Sigima release guard", () => {
  it("accepts an exact published pin when no snapshot is active", () => {
    expect(
      assertSigimaReleaseReady({
        publishedRequirement: PUBLISHED,
        developmentRef: null,
      }),
    ).toEqual({ publishedRequirement: PUBLISHED, developmentRef: null });
  });

  it("blocks an active development snapshot with an actionable diagnostic", () => {
    expect(() =>
      assertSigimaReleaseReady({
        publishedRequirement: PUBLISHED,
        developmentRef: SHA,
      }),
    ).toThrow(Error);
    expect(() =>
      assertSigimaReleaseReady({
        publishedRequirement: PUBLISHED,
        developmentRef: SHA,
      }),
    ).toThrow(new RegExp(`${SHA}.*developmentRef to null`, "s"));
  });

  it.each(["sigima>=1.3.0", "sigima~=1.3.0", "sigima==1.3"])(
    "rejects a non-exact published requirement: %s",
    (publishedRequirement) => {
      expect(() =>
        validateSigimaDependencyManifest({
          publishedRequirement,
          developmentRef: null,
        }),
      ).toThrow(/exact stable pin/);
    },
  );

  it.each(["develop", SHA.slice(0, 12), SHA.toUpperCase()])(
    "rejects a mutable or non-canonical development ref: %s",
    (developmentRef) => {
      expect(() =>
        validateSigimaDependencyManifest({
          publishedRequirement: PUBLISHED,
          developmentRef,
        }),
      ).toThrow(/full lowercase 40-character commit SHA/);
    },
  );

  it("rejects schema drift", () => {
    expect(() =>
      validateSigimaDependencyManifest({
        publishedRequirement: PUBLISHED,
        developmentRef: null,
        branch: "develop",
      }),
    ).toThrow(/unexpected keys: branch/);
  });
});

describe("guidata release guard", () => {
  it.each(["guidata>=3.15.0", "guidata==3.16.0"])(
    "accepts a published requirement: %s",
    (publishedRequirement) => {
      expect(
        assertReleaseReady(
          { publishedRequirement, developmentRef: null },
          "guidata",
        ),
      ).toEqual({ publishedRequirement, developmentRef: null });
    },
  );

  it("blocks an active development snapshot", () => {
    expect(() =>
      assertReleaseReady(
        { publishedRequirement: "guidata>=3.15.0", developmentRef: SHA },
        "guidata",
      ),
    ).toThrow(
      new RegExp(
        `guidata development snapshot.*${SHA}.*guidata-dependency`,
        "s",
      ),
    );
  });

  it.each(["guidata~=3.15.0", "guidata>=3.15", PUBLISHED])(
    "rejects an unsupported published requirement: %s",
    (publishedRequirement) => {
      expect(() =>
        validateDependencyManifest(
          { publishedRequirement, developmentRef: null },
          "guidata",
        ),
      ).toThrow(/exact pin or a lower bound/);
    },
  );
});

describe("DataLab-Capsule release guard", () => {
  const CAPSULE = "datalab-capsule==0.1.0";

  it("keeps development configurations valid", () => {
    for (const manifest of [
      { publishedRequirement: null, developmentRef: SHA },
      { publishedRequirement: null, developmentRef: null },
      { publishedRequirement: CAPSULE, developmentRef: SHA },
    ]) {
      expect(validateDependencyManifest(manifest, "capsule")).toEqual(manifest);
    }
  });

  it("accepts an exact published pin when no snapshot is active", () => {
    expect(
      assertReleaseReady(
        { publishedRequirement: CAPSULE, developmentRef: null },
        "capsule",
      ),
    ).toEqual({ publishedRequirement: CAPSULE, developmentRef: null });
  });

  it.each(["datalab-capsule>=0.1.0", "datalab-capsule==0.1", PUBLISHED])(
    "rejects a non-exact published requirement: %s",
    (publishedRequirement) => {
      expect(() =>
        validateDependencyManifest(
          { publishedRequirement, developmentRef: null },
          "capsule",
        ),
      ).toThrow(/exact stable pin/);
    },
  );

  describe("when Sigima and guidata are release-ready", () => {
    const ready = {
      sigima: { publishedRequirement: PUBLISHED, developmentRef: null },
      guidata: {
        publishedRequirement: "guidata>=3.16.0",
        developmentRef: null,
      },
    };

    it("passes with a published DataLab-Capsule pin", () => {
      expect(
        checkReleaseDependencies({
          ...ready,
          capsule: { publishedRequirement: CAPSULE, developmentRef: null },
        }).capsule,
      ).toEqual({ publishedRequirement: CAPSULE, developmentRef: null });
    });

    it("blocks a missing DataLab-Capsule manifest", () => {
      expect(() => checkReleaseDependencies(ready)).toThrow(
        /DataLab-Capsule dependency manifest is missing/,
      );
    });

    it.each([null, SHA])(
      "blocks an unpinned DataLab-Capsule (developmentRef %s)",
      (developmentRef) => {
        expect(() =>
          checkReleaseDependencies({
            ...ready,
            capsule: { publishedRequirement: null, developmentRef },
          }),
        ).toThrow(/Release blocked: .*DataLab-Capsule/);
      },
    );

    it("blocks a DataLab-Capsule development commit despite a pin", () => {
      expect(() =>
        checkReleaseDependencies({
          ...ready,
          capsule: { publishedRequirement: CAPSULE, developmentRef: SHA },
        }),
      ).toThrow(
        new RegExp(
          `DataLab-Capsule development snapshot.*${SHA}.*datalab-capsule-dependency\\.json`,
          "s",
        ),
      );
    });
  });
});

describe("repository dependency manifests", () => {
  it.each(["sigima", "guidata", "capsule"])(
    "has a valid %s manifest",
    (packageName) => {
      expect(() => loadDependencyManifest(packageName)).not.toThrow();
    },
  );
});
