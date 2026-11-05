// Pace line under the counter: average time per svaahaa round and total time so far.
// A round is the chanting itself: from the first voice after the previous svaahaa to the end
// of this svaahaa, so pauses and breaks between rounds do not stretch the average.
// Pure JS (no browser APIs) so it is tested in Node.

const QUIET_BEFORE_ONSET_MS = 300; // voice after at least this much quiet starts a new stretch
const MIN_ROUND_MS = 1000;         // shorter "rounds" are not real (e.g. a double tap)
const MAX_ROUND_MS = 90000;        // longer ones mean something else happened (left the room)
const ONSETS_KEPT = 200;

/** Running average: add one round of `ms` to {avgMs, rounds}. Returns a new object. */
export function addRound(pace, ms) {
  const rounds = pace.rounds + 1;
  return { avgMs: (pace.avgMs * pace.rounds + ms) / rounds, rounds };
}

export const NO_PACE = Object.freeze({ avgMs: 0, rounds: 0 });

/**
 * Watches voice / quiet and measures each round when a svaahaa is counted.
 * @returns {{voice(atMs: number, isVoice: boolean): void, counted(endMs: number): number | null, restart(atMs: number): void}}
 */
export function createRoundTimer() {
  let onsets = [];        // times where voice began after a quiet spell
  let lastVoiceMs = -Infinity;
  let previousEndMs = -Infinity;

  return {
    voice(atMs, isVoice) {
      if (!isVoice) return;
      if (atMs - lastVoiceMs >= QUIET_BEFORE_ONSET_MS) onsets = [...onsets.slice(1 - ONSETS_KEPT), atMs];
      lastVoiceMs = atMs;
    },
    /** A svaahaa ending at endMs was counted: how long was its round (ms), if measurable? */
    counted(endMs) {
      const start = onsets.find((t) => t > previousEndMs && t < endMs);
      previousEndMs = endMs;
      if (start === undefined) return null;
      const ms = endMs - start;
      return ms >= MIN_ROUND_MS && ms <= MAX_ROUND_MS ? ms : null;
    },
    /** Start measuring afresh (Start, Reset, learning finished). */
    restart(atMs) {
      previousEndMs = atMs;
    },
  };
}

/** "5.9 s" per svaahaa, or "–" before the first measured round. */
export function formatAverage(pace) {
  return pace.rounds > 0 && pace.avgMs > 0 ? `${(pace.avgMs / 1000).toFixed(1)} s` : '–';
}

/** "12 min 04 s" (or "1 h 02 min" after an hour). */
export function formatTotal(totalMs) {
  const s = Math.max(0, Math.floor((Number(totalMs) || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h} h ${pad(m)} min` : `${m} min ${pad(s % 60)} s`;
}

/** The whole line, e.g. "Average 5.9 s per svāhā · Total 12 min 04 s". */
export function paceLine(pace, totalMs) {
  return `Average ${formatAverage(pace)} per svāhā · Total ${formatTotal(totalMs)}`;
}
