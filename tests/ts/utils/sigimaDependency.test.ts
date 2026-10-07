import { describe, expect, it } from "vitest";

import {
  assertReleaseReady,
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

describe("repository dependency manifests", () => {
  it.each(["sigima", "guidata"])("has a valid %s manifest", (packageName) => {
    expect(() => loadDependencyManifest(packageName)).not.toThrow();
  });
});
