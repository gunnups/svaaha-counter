// Teach mode: compare a heard sound with recorded examples.
// Each sound is reduced to a fixed-length sequence of "sound colour" vectors
// (loudness removed), and compared with dynamic time warping, which tolerates
// people saying svaahaa faster or slower.

import { NUM_BANDS } from './features.js';

export const SEQ_LEN = 32;
const DEFAULT_THRESHOLD = 9;
const WARP_BAND = 6;

/** Frames -> SEQ_LEN arrays of NUM_BANDS numbers, each frame mean-centred. */
export function toSequence(frames) {
  if (!frames || frames.length === 0) return null;
  const out = [];
  for (let i = 0; i < SEQ_LEN; i++) {
    const src = frames[Math.min(frames.length - 1, Math.floor((i * frames.length) / SEQ_LEN))].bands;
    let mean = 0;
    for (let b = 0; b < NUM_BANDS; b++) mean += src[b];
    mean /= NUM_BANDS;
    out.push(Array.from(src, (v) => Math.round((v - mean) * 10) / 10));
  }
  return out;
}

function frameDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

/** Average per-step distance of the best warped alignment. */
export function dtwDistance(a, b) {
  const n = a.length;
  const m = b.length;
  const INF = Number.POSITIVE_INFINITY;
  let prev = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    const cur = new Float64Array(m + 1).fill(INF);
    const lo = Math.max(1, i - WARP_BAND);
    const hi = Math.min(m, i + WARP_BAND);
    for (let j = lo; j <= hi; j++) {
      const best = Math.min(prev[j], cur[j - 1], prev[j - 1]);
      cur[j] = frameDistance(a[i - 1], b[j - 1]) + best;
    }
    prev = cur;
  }
  return prev[m] / (n + m);
}

/** Acceptance threshold learned from how similar the taught examples are to each other. */
export function learnThreshold(positives) {
  if (positives.length < 2) return DEFAULT_THRESHOLD;
  const d = [];
  for (let i = 0; i < positives.length; i++) {
    for (let j = i + 1; j < positives.length; j++) d.push(dtwDistance(positives[i], positives[j]));
  }
  d.sort((x, y) => x - y);
  const median = d[Math.floor(d.length / 2)];
  return Math.max(median * 1.8, 3);
}

/**
 * Decide whether a heard sequence matches the taught svaahaa examples.
 * @param {number[][]} seq
 * @param {{positives: number[][][], negatives: number[][][]}} taught
 * @param {number} strictness 0.5 (lenient) .. 1.5 (strict)
 */
export function matchTaught(seq, taught, strictness = 1) {
  const { positives, negatives } = taught;
  if (!seq || positives.length === 0) return { ok: true, reason: 'not taught' };
  const nearest = (list) => list.reduce((min, t) => Math.min(min, dtwDistance(seq, t)), Infinity);
  const dPos = nearest(positives);
  const threshold = learnThreshold(positives) / strictness;
  const dNeg = negatives.length ? nearest(negatives) : Infinity;
  const score = Math.round(dPos * 10) / 10;
  if (dPos > threshold) return { ok: false, reason: `not like taught svaahaa (${score})`, score };
  if (dNeg < dPos) return { ok: false, reason: `sounds like background (${score})`, score };
  return { ok: true, reason: `matched (${score})`, score };
}
