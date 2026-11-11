import { describe, expect, it } from "vitest";
import {
  isShowcaseActive,
  isShowcaseRequested,
  setShowcaseActive,
} from "../../../src/showcase/launch";
import {
  DEFAULT_RELOAD_EVERY,
  parseShowcaseParams,
} from "../../../src/showcase/options";

describe("isShowcaseRequested", () => {
  it("detects the showcase parameter without parsing the others", () => {
    expect(isShowcaseRequested("")).toBe(false);
    expect(isShowcaseRequested("?lang=fr")).toBe(false);
    expect(isShowcaseRequested("?showcase=")).toBe(false);
    expect(isShowcaseRequested("?showcase=OFF")).toBe(false);
    expect(isShowcaseRequested("?showcase=1&loop=1")).toBe(true);
    expect(isShowcaseRequested("?showcase=w1,w3")).toBe(true);
  });

  it("agrees with the full parser", () => {
    for (const search of [
      "",
      "?showcase=0",
      "?showcase=no",
      "?showcase=all",
      "?showcase=w2&close=1",
    ]) {
      expect(isShowcaseRequested(search)).toBe(
        parseShowcaseParams(search) !== null,
      );
    }
  });
});

describe("parseShowcaseParams", () => {
  it("returns null unless the URL requests the showcase", () => {
    expect(parseShowcaseParams("")).toBeNull();
    expect(parseShowcaseParams("?lang=fr")).toBeNull();
    expect(parseShowcaseParams("?showcase=")).toBeNull();
    expect(parseShowcaseParams("?showcase=0")).toBeNull();
    expect(parseShowcaseParams("?showcase=off")).toBeNull();
  });

  it("plays every scenario once at normal pace by default", () => {
    expect(parseShowcaseParams("?showcase=1")).toEqual({
      ids: null,
      loop: false,
      speed: 1,
      check: false,
      reloadEvery: DEFAULT_RELOAD_EVERY,
      fromUrl: true,
      close: false,
    });
    expect(parseShowcaseParams("?showcase=all")?.ids).toBeNull();
  });

  it("reads the kiosk options", () => {
    expect(
      parseShowcaseParams("?showcase=1&loop=1&speed=0.7&reload=3&lang=fr"),
    ).toMatchObject({ loop: true, speed: 0.7, reloadEvery: 3, check: false });
    expect(parseShowcaseParams("?showcase=1&reload=0")?.reloadEvery).toBe(0);
  });

  it("selects scenarios by id, deduplicated and lower-cased", () => {
    expect(parseShowcaseParams("?showcase=W1, w2,,w1")?.ids).toEqual([
      "w1",
      "w2",
    ]);
  });

  it("selects the check mode with check=1 or speed=0, without loop", () => {
    expect(parseShowcaseParams("?showcase=1&check=1&loop=1")).toMatchObject({
      check: true,
      speed: 0,
      loop: false,
    });
    expect(parseShowcaseParams("?showcase=w1&speed=0")).toMatchObject({
      check: true,
      speed: 0,
      ids: ["w1"],
    });
  });

  it("closes the window after a single pass with close=1", () => {
    expect(parseShowcaseParams("?showcase=w1&close=1&loop=1")).toMatchObject({
      ids: ["w1"],
      close: true,
      loop: false,
    });
    // The check mode never closes its page.
    expect(parseShowcaseParams("?showcase=w1&close=1&check=1")?.close).toBe(
      false,
    );
  });

  it("ignores invalid speed and reload values", () => {
    expect(
      parseShowcaseParams("?showcase=1&speed=fast&reload=-2"),
    ).toMatchObject({
      speed: 1,
      check: false,
      reloadEvery: DEFAULT_RELOAD_EVERY,
    });
  });
});

describe("showcase active flag", () => {
  it("can be set and cleared", () => {
    setShowcaseActive(true);
    expect(isShowcaseActive()).toBe(true);
    setShowcaseActive(false);
    expect(isShowcaseActive()).toBe(false);
  });
});
