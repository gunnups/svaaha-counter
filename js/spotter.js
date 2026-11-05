// Whole-word "svaahaa" spotting: compares the running sound with recorded examples of
// the person's own svaahaa (templates), instead of looking for an "s" and an "aa".
// Uses streaming subsequence DTW, so a svaahaa can be said fast or drawn out, and can
// run straight on from the mantra. Pure JS (no browser APIs) so it is tested in Node.

import { NUM_BANDS } from './features.js';

export const POOL = 2;               // average this many feature frames into one (~21 ms)
export const TEMPLATE_SECONDS = 1.2; // a svaahaa template: the sound just before its mark
const NORMALISE_SECONDS = 1.5;       // sound colour is judged against the last ~1.5 s

/**
 * Turns pooled frames into vectors: each frame's sound colour relative to the recent
 * average. This cancels the mic, distance and room colouring (cepstral mean normalisation),
 * which is what let templates from one session work on other sessions.
 * @param {number} pooledHopMs
 */
export function createVectoriser(pooledHopMs) {
  const keep = Math.exp(-pooledHopMs / 1000 / NORMALISE_SECONDS);
  let mean = null;
  return function vector(bands) {
    mean = mean ? mean.map((m, b) => keep * m + (1 - keep) * bands[b]) : Float32Array.from(bands);
    return Float32Array.from(bands, (x, b) => x - mean[b]);
  };
}

function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
}

/** Averages POOL feature frames into one. Returns null until a pooled frame is ready. */
export function createPooler() {
  let n = 0;
  let db = 0;
  let bands = new Float32Array(NUM_BANDS);
  return function pool(frame) {
    for (let b = 0; b < NUM_BANDS; b++) bands[b] += frame.bands[b];
    db += frame.db;
    n++;
    if (n < POOL) return null;
    const out = { db: db / n, bands: bands.map((x) => x / n) };
    n = 0;
    db = 0;
    bands = new Float32Array(NUM_BANDS);
    return out;
  };
}

/**
 * Streaming subsequence DTW of one template against the incoming vectors.
 * After each push, the cost is how well the best stretch of sound *ending now*
 * matches the whole template (lower = more alike), averaged along the match path.
 */
function createMatcher(template) {
  const m = template.length;
  let prev = new Float64Array(m).fill(Infinity);
  let prevLen = new Float64Array(m).fill(0);
  return function push(x) {
    const cur = new Float64Array(m);
    const len = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      const d = distance(x, template[j]);
      if (j === 0) {
        // open beginning: the word may start at any moment
        cur[0] = d;
        len[0] = 1;
        continue;
      }
      let best = prev[j - 1]; // both advance
      let bestLen = prevLen[j - 1];
      if (prev[j] < best) [best, bestLen] = [prev[j], prevLen[j]]; // sound slower than template
      if (cur[j - 1] < best) [best, bestLen] = [cur[j - 1], len[j - 1]]; // sound faster
      cur[j] = best + d;
      len[j] = bestLen + 1;
    }
    prev = cur;
    prevLen = len;
    return cur[m - 1] / len[m - 1];
  };
}

/**
 * @param {Float32Array[][]} templates  svaahaa examples (sequences of vectors)
 * @param {{threshold: number, minGapMs?: number, settleMs?: number}} options
 * @param {number} pooledHopMs  time between pooled frames
 */
export function createSpotter(templates, { threshold, minGapMs = 2500, settleMs = 250 }, pooledHopMs) {
  const matchers = templates.map(createMatcher);
  let t = 0;
  let best = null; // lowest cost of the current dip below threshold: { cost, atMs }
  let lastHitMs = -Infinity;
  let lastCost = Infinity;

  /** Feed one vector; returns a hit {atMs, cost} when a svaahaa has just been recognised. */
  function push(x) {
    t += pooledHopMs;
    let cost = Infinity;
    for (const match of matchers) cost = Math.min(cost, match(x));
    lastCost = cost;
    if (cost < threshold && t - lastHitMs > minGapMs) {
      if (!best || cost < best.cost) best = { cost, atMs: t };
      return null;
    }
    // report the dip's lowest point once the match has clearly passed
    if (best && t - best.atMs >= settleMs) {
      const hit = best;
      best = null;
      lastHitMs = hit.atMs;
      return hit;
    }
    return null;
  }

  return {
    push,
    get cost() {
      return lastCost;
    },
  };
}
