/** Lightweight fuzzy matcher for the command palette.
 *
 * Implements a subsequence match (every character of the query must
 * appear in the text, in order) with a small VSCode-like scoring scheme:
 * consecutive matches and matches at word boundaries are rewarded, while
 * gaps between matched characters are penalised. No external dependency.
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

    // Base reward for matching a character.
    score += 1;
    // Consecutive match bonus.
    if (found === prevMatchIndex + 1) score += 5;
    // Word-boundary bonus (start of text or right after a separator).
    if (found === 0 || BOUNDARY.has(text[found - 1])) score += 3;
    // Gap penalty (distance skipped since the previous match).
    if (prevMatchIndex >= 0) score -= Math.min(found - prevMatchIndex - 1, 3);

    prevMatchIndex = found;
    textIndex = found + 1;
  }

  return { matched: true, score };
}
