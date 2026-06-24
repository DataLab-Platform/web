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

  it("scores a contiguous match higher than a scattered one", () => {
    const contiguous = fuzzyMatch("abc", "abc def");
    const scattered = fuzzyMatch("abc", "a1b2c3 def");
    expect(contiguous.matched).toBe(true);
    expect(scattered.matched).toBe(true);
    expect(contiguous.score).toBeGreaterThan(scattered.score);
  });

  it("rewards matches at word boundaries", () => {
    // "fa" hits the start of two words in "fourier analysis" vs mid-word
    // occurrences in "affair anomaly".
    const boundary = fuzzyMatch("fa", "fourier analysis");
    const midWord = fuzzyMatch("fa", "affair anomaly");
    expect(boundary.score).toBeGreaterThan(midWord.score);
  });
});
