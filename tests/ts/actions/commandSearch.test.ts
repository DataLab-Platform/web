import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "../../../src/actions/commandSearch";

describe("fuzzyMatch", () => {
  it("matches an empty query against anything with score 0", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ matched: true, score: 0 });
  });

  it("matches a contiguous substring", () => {
    expect(
      fuzzyMatch("fft", "processing › fourier analysis › fft").matched,
    ).toBe(true);
  });

  it("matches a non-contiguous subsequence", () => {
    expect(fuzzyMatch("fan", "fourier analysis").matched).toBe(true);
  });

  it("rejects when a character is missing", () => {
    expect(fuzzyMatch("xyz", "fourier analysis").matched).toBe(false);
  });

  it("rejects when the query is longer than the text", () => {
    expect(fuzzyMatch("abcdef", "abc").matched).toBe(false);
  });

  it("rewards matches at word boundaries", () => {
    // "fa" hits the start of two words in "fourier analysis" vs mid-word
    // occurrences in "affair anomaly".
    const boundary = fuzzyMatch("fa", "fourier analysis");
    const midWord = fuzzyMatch("fa", "affair anomaly");
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });

  it("matches a plain substring anywhere, even mid-word", () => {
    // A single contiguous run is always accepted (substring search).
    expect(fuzzyMatch("rota", "rotate").matched).toBe(true);
    expect(fuzzyMatch("bration", "calibration").matched).toBe(true);
  });

  it("rejects scattered mid-word noise", () => {
    // The characters r, o, t, a appear in order in these paths but only as
    // scattered mid-word runs, so they must NOT match "rota".
    expect(
      fuzzyMatch("rota", "edit › annotations › import annotations").matched,
    ).toBe(false);
    expect(fuzzyMatch("rota", "analysis › horizontal projection").matched).toBe(
      false,
    );
    expect(fuzzyMatch("abc", "a1b2c3 def").matched).toBe(false);
  });

  it("keeps acronym-style matches where every run is at a word boundary", () => {
    // "fan" -> "Fourier ANalysis": f (boundary) + an (boundary) run.
    expect(fuzzyMatch("fan", "fourier analysis").matched).toBe(true);
  });
});
