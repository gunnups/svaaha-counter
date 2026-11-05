// "Learn my svaahaa": turns a marked learning session into svaahaa templates and a threshold.
// The person chants normally and marks just after each svaahaa; the 1.2 s before each mark
// becomes an example, and everything else in the session shows what is *not* svaahaa.
// Pure JS (no browser APIs) so it is tested in Node.

import { createSpotter, TEMPLATE_SECONDS } from './spotter.js';

export const MIN_MARKS = 5;
const MARK_LAG_MS = 50;        // the mark comes just after the svaahaa (and its tap/click)
const SEARCH_BEFORE_MS = 2000; // where to look for each held-out svaahaa, around its mark
const SEARCH_AFTER_MS = 300;
const NOT_NEAR_MARK_MS = 2500; // sound this far from any mark counts as "not svaahaa"
const WARMUP_MS = 3000;        // run-in so the matcher has context before a search window
const OVERLAP_SAFETY = 0.98;   // if svaahaa and mantra overlap, stay just below the closest mantra

function costTrace(vectors, templates, from = 0, to = vectors.length) {
  const spot = createSpotter(templates, { threshold: -1 }, 1);
  const out = [];
  for (let i = from; i < to; i++) {
    spot.push(vectors[i]);
    out.push(spot.cost);
  }
  return out;
}

/**
 * @param {Float32Array[]} vectors   the session's sound, one vector per pooled frame
 * @param {number[]} marks           frame indices (into `vectors`) where svaahaa was marked
 * @param {number} hopMs             time between frames
 * @param {Float32Array[][]} [earlier]  templates learned before (e.g. solo, when adding a group)
 * @returns {{error: string} | {templates: Float32Array[][], threshold: number, quality: {worstSvaha: number, closestOther: number, separated: boolean}}}
 */
export function learnFromSession(vectors, marks, hopMs, earlier = []) {
  const frames = (ms) => Math.round(ms / hopMs);
  const length = frames(TEMPLATE_SECONDS * 1000);
  const lag = frames(MARK_LAG_MS);
  const usable = marks.filter((m) => m - lag - length >= 0);
  if (usable.length < MIN_MARKS) {
    return { error: `Need at least ${MIN_MARKS} marked svāhā (got ${usable.length}).` };
  }
  const fresh = usable.map((m) => vectors.slice(m - lag - length, m - lag));
  const all = [...earlier, ...fresh];

  // Each new svaahaa, found by all the *other* templates (honest leave-one-out score).
  const positives = usable.map((m, k) => {
    const others = all.filter((t) => t !== fresh[k]);
    const from = Math.max(0, m - frames(SEARCH_BEFORE_MS + WARMUP_MS));
    const trace = costTrace(vectors, others, from, Math.min(vectors.length, m + frames(SEARCH_AFTER_MS)));
    return Math.min(...trace.slice(Math.min(frames(WARMUP_MS), m - from)));
  });
  // Everything well away from the marks is mantra / talk: the closest it comes to a svaahaa.
  const trace = costTrace(vectors, all);
  const others = trace.filter((_, i) => usable.every((m) => Math.abs(i - m) > frames(NOT_NEAR_MARK_MS)));
  const worstSvaha = Math.max(...positives);
  const closestOther = others.length ? Math.min(...others) : Infinity;
  const separated = worstSvaha < closestOther;
  const threshold = separated
    ? Number.isFinite(closestOther)
      ? (worstSvaha + closestOther) / 2
      : worstSvaha * 1.05
    : closestOther * OVERLAP_SAFETY;
  return { templates: all, threshold, quality: { worstSvaha, closestOther, separated } };
}
