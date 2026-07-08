/** Lightweight fuzzy matcher for the command palette.
 *
 * Implements a subsequence match (every character of the query must
 * appear in the text, in order) with a small VSCode-like scoring scheme:
 * consecutive matches and matches at word boundaries are rewarded, while
 * gaps between matched characters are penalised. No external dependency.
 *
 * A plain subsequence match is too permissive on its own: a short query
 * like "rota" would match unrelated commands such as "impoRt annOTAtions"
 * (the characters r, o, t, a appear scattered, in order). To cull that
 * noise, a match is only accepted when its matched characters form a
 * single contiguous run (a plain substring, e.g. "rota" in "Rotate") or
 * when every run of matched characters starts at a word boundary
 * (acronym / word-initials style, e.g. "fan" in "Fourier ANalysis").
 */

export interface FuzzyMatch {
  /** ``true`` when every query character was found in order. */
  matched: boolean;
  /** Relative score; higher is a better match. Meaningless when
   *  {@link matched} is ``false``. */
  score: number;
}

const NO_MATCH: FuzzyMatch = { matched: false, score: 0 };

/** Characters that introduce a new "word" in a menu path. A match
 *  immediately after one of these gets a word-boundary bonus. */
const BOUNDARY = new Set([" ", "›", "/", "-", "_", ".", "(", "[", ":"]);

/**
 * Score how well ``query`` fuzzy-matches ``text``.
 *
 * @param query Lowercased search query (already trimmed by the caller).
 * @param text Lowercased haystack to match against.
 * @returns A {@link FuzzyMatch} with the match flag and a score.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch {
  if (query.length === 0) return { matched: true, score: 0 };
  if (query.length > text.length) return NO_MATCH;

  let score = 0;
  let textIndex = 0;
  let prevMatchIndex = -2;
  // A "run" is a maximal block of contiguous matched characters. We track
  // how many runs the match spans and how many of them start at a word
  // boundary, to reject scattered mid-word noise afterwards.
  let runs = 0;
  let boundaryRuns = 0;

  for (let qi = 0; qi < query.length; qi++) {
    const qc = query[qi];
    let found = -1;
    for (let ti = textIndex; ti < text.length; ti++) {
      if (text[ti] === qc) {
        found = ti;
        break;
      }
    }
    if (found === -1) return NO_MATCH;

    const contiguous = found === prevMatchIndex + 1;
    const atBoundary = found === 0 || BOUNDARY.has(text[found - 1]);

    // Base reward for matching a character.
    score += 1;
    // Consecutive match bonus.
    if (contiguous) score += 5;
    // Word-boundary bonus (start of text or right after a separator).
    if (atBoundary) score += 3;
    // Gap penalty (distance skipped since the previous match).
    if (prevMatchIndex >= 0) score -= Math.min(found - prevMatchIndex - 1, 3);

    // A non-contiguous match opens a new run.
    if (!contiguous) {
      runs += 1;
      if (atBoundary) boundaryRuns += 1;
    }

    prevMatchIndex = found;
    textIndex = found + 1;
  }

  // Cull scattered noise: keep the match only when the query occurs as a
  // plain substring (a single contiguous run — the greedy scan above can miss
  // it, e.g. "fft" in "… Fourier … fft") or when every run of matched
  // characters starts at a word boundary (acronym / word-initials style).
  if (boundaryRuns !== runs && !text.includes(query)) return NO_MATCH;

  return { matched: true, score };
}
