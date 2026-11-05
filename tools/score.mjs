// Matches counts to the person's svaahaa marks. A mark is tapped just after saying svaahaa,
// so a count belongs to a mark when it ends up to MATCH_BEFORE s before (or MATCH_AFTER s after) it.
export const MATCH_BEFORE = 2.5;
export const MATCH_AFTER = 1.0;

/**
 * @param {number[]} countEnds  seconds
 * @param {number[]} marks      seconds
 * @returns {{hits: number, missed: number[], extra: number[]}}
 */
export function scoreAgainstMarks(countEnds, marks) {
  const unused = [...countEnds];
  const missed = [];
  let hits = 0;
  for (const m of [...marks].sort((a, b) => a - b)) {
    const i = unused.findIndex((c) => c >= m - MATCH_BEFORE && c <= m + MATCH_AFTER);
    if (i === -1) missed.push(m);
    else {
      hits++;
      unused.splice(i, 1);
    }
  }
  return { hits, missed, extra: unused };
}
