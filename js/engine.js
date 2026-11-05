// Glue between audio samples and counting decisions. Pure JS, testable in Node.
//   samples -> features -> learned whole-word matcher (or, until learned, the "s" + "aa" detector) -> decision

import { createFeatureExtractor } from './features.js';
import { createDetector } from './detector.js';
import { createPooler, createVectoriser, createSpotter, POOL, TEMPLATE_SECONDS } from './spotter.js';
import { learnFromSession } from './learn.js';

export const SETTINGS_DEFAULTS = Object.freeze({
  sensitivity: 5,       // 1 (needs loud voices) .. 10 (picks up soft voices)
  minVowelMs: 600,      // how long "svaaahaa" must be held
  gapSeconds: 3,        // minimum time between two counts
  strictness: 1,        // 0.7 (lenient) .. 1.3 (strict): steadiness of the "aa"
  useLearned: true,     // count with "Learn my svaahaa" once this device has learned
  target: 1008,
  showLog: true,        // on while the app is being tuned with real voices
});

/** Sensitivity 1..10 -> dB above background (higher sensitivity = smaller margin). */
export function marginFor(sensitivity) {
  const s = Math.min(10, Math.max(1, Number(sensitivity) || 5));
  return 20 - s * 1.6;
}

const BASE_MAX_FLUX = 4.1;
const CONFIRM_MS = 1200;      // wait this long after a candidate before counting it
const MAX_CONFIRM_MS = 3000; // never wait longer than this
const HISTORY_MS = 150000;   // sound kept for a learning session (2.5 min)
const TRIM_EVERY = 500;      // drop old sound in batches, not on every frame

function detectorOptions(settings) {
  const strictness = Math.min(1.3, Math.max(0.7, Number(settings.strictness) || 1));
  return {
    marginDb: marginFor(settings.sensitivity),
    minVowelMs: settings.minVowelMs,
    maxFlux: BASE_MAX_FLUX / strictness,
  };
}

/**
 * @param {number} sampleRate
 * @param {typeof SETTINGS_DEFAULTS} settings
 * @param {{templates: Float32Array[][], threshold: number} | null} learned  "Learn my svaahaa" result
 */
export function createEngine(sampleRate, settings, learned = null) {
  const features = createFeatureExtractor(sampleRate);
  const detector = createDetector(features.hopMs, detectorOptions(settings));
  const pool = createPooler();
  const pooledHopMs = features.hopMs * POOL;
  const vectorise = createVectoriser(pooledHopMs);
  const keepFrames = Math.round(HISTORY_MS / pooledHopMs);
  let current = { ...settings };
  let lastCountMs = -Infinity;
  let level = 0;
  let t = 0;
  let pending = null;          // detector candidate waiting for confirmation

  // whole-word spotting (once this device has learned)
  let spotter = null;
  let recent = [];             // last couple of minutes of vectors, for learning
  let recentStart = 0;         // index (count of vectors ever made) of recent[0]
  let made = 0;
  let marks = [];              // vector indices of marks since learning began
  let learningFrom = null;     // vector index where the current learning session began

  let lastLearned = learned;
  function useLearned(next) {
    lastLearned = next;
    spotter = next && next.templates.length
      ? createSpotter(next.templates, { threshold: next.threshold, minGapMs: current.gapSeconds * 1000 }, pooledHopMs)
      : null;
  }
  useLearned(learned);
  const spotting = () => spotter && current.useLearned;

  // svaahaa is the last "s + long aa" of each offering. A candidate is held for
  // CONFIRM_MS; if a newer one arrives meanwhile (e.g. "...prachodayaat" then
  // "svaahaa"), the newer one replaces it, so each offering counts once.
  function onEvent(event, results) {
    if (event.rejected) {
      results.push({ type: 'rejected', event, reason: event.rejected });
      return;
    }
    if (pending) results.push({ type: 'replaced', event: pending, reason: 'a later svaahaa-like sound followed' });
    pending = event;
  }

  function maybeCommit(results) {
    if (!pending) return;
    const waited = t - pending.endMs;
    const busy = detector.state === 'sib' || detector.state === 'vowel';
    if (waited < CONFIRM_MS || (busy && waited < MAX_CONFIRM_MS)) return;
    const event = pending;
    pending = null;
    if (event.endMs - lastCountMs < current.gapSeconds * 1000) {
      results.push({ type: 'rejected', event, reason: 'too soon after last count' });
      return;
    }
    lastCountMs = event.endMs;
    results.push({ type: 'count', event });
  }

  function onVector(vec, results) {
    recent.push(vec);
    made++;
    if (recent.length > keepFrames + TRIM_EVERY) {
      const drop = recent.length - keepFrames;
      recent = recent.slice(drop);
      recentStart += drop;
    }
    if (!spotting()) {
      spotter?.push(vec); // keep its timing in step even while not used
      return;
    }
    const hit = spotter.push(vec);
    if (hit) {
      const endMs = hit.atMs;
      results.push({ type: 'count', event: { startMs: endMs - TEMPLATE_SECONDS * 1000, endMs, vowelMs: TEMPLATE_SECONDS * 1000, frames: [], match: Math.round(hit.cost * 100) / 100 } });
    }
  }

  /** Feed microphone samples; returns a list of decisions (usually empty). */
  function push(samples) {
    const results = [];
    for (const frame of features.process(samples)) {
      t += features.hopMs;
      const above = frame.db - detector.floorDb;
      level = Number.isFinite(above) ? Math.max(0, Math.min(1, above / 30)) : 0;
      const event = detector.step(frame);
      const pooled = pool(frame);
      if (pooled) onVector(vectorise(pooled.bands), results);
      if (spotting()) continue; // the learned matcher decides; the old detector only runs alongside
      if (event) onEvent(event, results);
      maybeCommit(results);
    }
    return results;
  }

  return {
    push,
    setSettings(next) {
      const gapChanged = next.gapSeconds !== undefined && next.gapSeconds !== current.gapSeconds;
      current = { ...current, ...next };
      detector.setOptions(detectorOptions(current));
      if (gapChanged) useLearned(lastLearned);
    },
    setLearned: useLearned,
    /** The person marked "svaahaa just now". */
    mark() {
      marks = [...marks, made];
    },
    get marksSinceLearning() {
      return learningFrom === null ? 0 : marks.filter((m) => m >= learningFrom).length;
    },
    startLearning() {
      learningFrom = made;
      marks = [];
    },
    get learning() {
      return learningFrom !== null;
    },
    cancelLearning() {
      learningFrom = null;
    },
    /** Build templates from the session; `earlier` keeps what was learned before. */
    finishLearning(earlier = []) {
      const from = Math.max(learningFrom ?? made, recentStart);
      learningFrom = null;
      const vectors = recent.slice(from - recentStart);
      const sessionMarks = marks.filter((m) => m >= from).map((m) => m - from);
      return learnFromSession(vectors, sessionMarks, pooledHopMs, earlier);
    },
    get level() {
      return level;
    },
    get usingLearned() {
      return Boolean(spotting());
    },
  };
}
