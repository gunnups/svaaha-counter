// Glue between audio samples and counting decisions. Pure JS, testable in Node.
//   samples -> features -> detector -> (optional taught match) -> decision

import { createFeatureExtractor } from './features.js';
import { createDetector } from './detector.js';
import { toSequence, matchTaught } from './templates.js';

export const SETTINGS_DEFAULTS = Object.freeze({
  sensitivity: 5,       // 1 (needs loud voices) .. 10 (picks up soft voices)
  minVowelMs: 600,      // how long "svaaahaa" must be held
  gapSeconds: 3,        // minimum time between two counts
  strictness: 1,        // 0.7 (lenient) .. 1.3 (strict): steadiness + taught match
  useTaught: true,
  target: 1008,
  showLog: true,        // on while the app is being tuned with real voices
});

/** Sensitivity 1..10 -> dB above background (higher sensitivity = smaller margin). */
export function marginFor(sensitivity) {
  const s = Math.min(10, Math.max(1, Number(sensitivity) || 5));
  return 20 - s * 1.6;
}

const BASE_MAX_FLUX = 4.6;
const CONFIRM_MS = 900;      // wait this long after a candidate before counting it
const MAX_CONFIRM_MS = 3000; // never wait longer than this

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
 * @param {{positives: number[][][], negatives: number[][][]}} taught
 */
export function createEngine(sampleRate, settings, taught) {
  const features = createFeatureExtractor(sampleRate);
  const detector = createDetector(features.hopMs, detectorOptions(settings));
  let current = { ...settings };
  let teaching = { positives: taught.positives, negatives: taught.negatives };
  let mode = 'count';          // 'count' | 'teach-svaha' | 'teach-background'
  let lastCountMs = -Infinity;
  let level = 0;

  let t = 0;
  let pending = null;          // best candidate waiting for confirmation

  function teachDecision(event) {
    if (event.frames.length === 0 || (mode === 'teach-svaha' && event.rejected)) {
      return { type: 'ignored', event, reason: event.rejected };
    }
    const type = mode === 'teach-svaha' ? 'taught-svaha' : 'taught-background';
    return { type, event, seq: toSequence(event.frames) };
  }

  /** Is this heard sound a svaahaa candidate? Returns a rejection reason or null. */
  function rejectionFor(event) {
    if (event.rejected) return event.rejected;
    if (!current.useTaught) return null;
    const match = matchTaught(toSequence(event.frames), teaching, current.strictness);
    return match.ok ? null : match.reason;
  }

  // svaahaa is the last "s + long aa" of each offering. A candidate is held for
  // CONFIRM_MS; if a newer one arrives meanwhile (e.g. "...prachodayaat" then
  // "svaahaa"), the newer one replaces it, so each offering counts once.
  function onEvent(event, results) {
    if (mode !== 'count') {
      results.push(teachDecision(event));
      return;
    }
    const reason = rejectionFor(event);
    if (reason) {
      results.push({ type: 'rejected', event, reason });
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

  /** Feed microphone samples; returns a list of decisions (usually empty). */
  function push(samples) {
    const results = [];
    for (const frame of features.process(samples)) {
      t += features.hopMs;
      const above = frame.db - detector.floorDb;
      level = Number.isFinite(above) ? Math.max(0, Math.min(1, above / 30)) : 0;
      const event = detector.step(frame);
      if (event) onEvent(event, results);
      maybeCommit(results);
    }
    return results;
  }

  return {
    push,
    setSettings(next) {
      current = { ...current, ...next };
      detector.setOptions(detectorOptions(current));
    },
    setTaught(next) {
      teaching = { positives: next.positives, negatives: next.negatives };
    },
    setMode(next) {
      mode = next;
      pending = null;
      // Teaching svaahaa: accept shorter, softer examples so they are captured.
      detector.setOptions(
        next === 'count' ? detectorOptions(current) : { ...detectorOptions(current), minVowelMs: 250, maxFlux: Infinity },
      );
    },
    get level() {
      return level;
    },
    get mode() {
      return mode;
    },
  };
}
