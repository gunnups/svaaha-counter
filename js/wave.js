// Remembers the last ~30 s of sound as columns for the scrolling picture:
// how loud each moment was, and whether it was quiet, mantra (voice) or a counted svaahaa.
// Pure JS (no browser APIs) so it is tested in Node.

/**
 * @typedef {'empty' | 'quiet' | 'voice' | 'svaha'} ColumnKind
 * @typedef {{peak: number, kind: ColumnKind, marked: boolean}} Column
 */

/**
 * @param {{windowMs?: number, columnMs?: number}} [options]
 */
export function createWaveHistory({ windowMs = 30000, columnMs = 100 } = {}) {
  const count = Math.round(windowMs / columnMs);
  const size = count + 1;
  const index = new Float64Array(size).fill(-1); // which time-column each slot holds
  const peak = new Float32Array(size);
  const voice = new Uint8Array(size);
  let svahaRanges = []; // [startMs, endMs] of counted svaahaas
  let markTimes = [];   // moments the person marked "I said svaahaa"

  function slotFor(column) {
    const slot = column % size;
    if (index[slot] !== column) {
      index[slot] = column;
      peak[slot] = 0;
      voice[slot] = 0;
    }
    return slot;
  }

  /** Record a moment: loudest sample (0..1) and whether a voice was above the room level. */
  function add(atMs, loudest, isVoice) {
    const slot = slotFor(Math.floor(atMs / columnMs));
    peak[slot] = Math.max(peak[slot], loudest);
    if (isVoice) voice[slot] = 1;
  }

  /** Paint a counted svaahaa (its times come from the detector, on the same clock). */
  function markSvaha(startMs, endMs) {
    svahaRanges = [...svahaRanges, [startMs, endMs]].filter(([, end]) => end > endMs - windowMs * 2);
  }

  /** The person marked a svaahaa at this moment (for checking the counter). */
  function mark(atMs) {
    markTimes = [...markTimes, atMs].filter((m) => m > atMs - windowMs * 2);
  }

  const isSvaha = (fromMs, toMs) => svahaRanges.some(([s, e]) => s < toMs && e > fromMs);

  /** The window ending at `nowMs`, oldest column first. @returns {Column[]} */
  function columns(nowMs) {
    const last = Math.floor(nowMs / columnMs) - 1;
    return Array.from({ length: count }, (_, i) => {
      const column = last - count + 1 + i;
      const slot = column % size;
      const from = column * columnMs;
      const marked = markTimes.some((m) => m >= from && m < from + columnMs);
      if (column < 0 || index[slot] !== column) return { peak: 0, kind: 'empty', marked };
      let kind = voice[slot] ? 'voice' : 'quiet';
      if (isSvaha(from, from + columnMs)) kind = 'svaha';
      return { peak: peak[slot], kind, marked };
    });
  }

  return { add, markSvaha, mark, columns, columnMs, windowMs };
}
