import { describe, expect, it } from "vitest";

import {
  assertSigimaReleaseReady,
  validateSigimaDependencyManifest,
} from "../../../scripts/check-sigima-release.mjs";

const PUBLISHED = "sigima==1.3.0";
const SHA = "4442ada873655f63fabd14369fd11170f75a28b4";

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
