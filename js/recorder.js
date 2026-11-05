// Always keeps the last couple of minutes of microphone sound, so that after a
// miss the exact audio can be saved as a WAV file and replayed when tuning.

export const MAX_SECONDS = 120;

/**
 * @param {number} sampleRate
 * @returns {{add: (samples: Float32Array) => void, mark: () => void, marks: () => number[], seconds: () => number, toWav: () => Blob}}
 *   mark() notes "a svaahaa was said now" (for checking/tuning); marks are saved inside the WAV.
 */
export function createRecorder(sampleRate) {
  const size = Math.round(MAX_SECONDS * sampleRate);
  const ring = new Int16Array(size); // 16-bit keeps memory small on phones (~11 MB)
  let pos = 0;
  let filled = 0;
  let total = 0;        // samples ever added
  let markAt = [];      // sample numbers (of `total`) where a svaahaa was marked

  function add(samples) {
    for (const v of samples) {
      ring[pos] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
      pos = (pos + 1) % size;
    }
    filled = Math.min(size, filled + samples.length);
    total += samples.length;
  }

  function mark() {
    markAt = [...markAt, total].filter((m) => m >= total - size);
  }

  /** Marks within the kept sound, in seconds from its start. */
  function marks() {
    const start = total - filled;
    return markAt.filter((m) => m >= start).map((m) => Math.round(((m - start) / sampleRate) * 1000) / 1000);
  }

  function toWav() {
    const length = filled;
    const markBytes = new TextEncoder().encode(JSON.stringify({ svahaMarksSeconds: marks() }));
    const markSize = markBytes.length + (markBytes.length % 2); // chunks are padded to even size
    const buffer = new ArrayBuffer(44 + length * 2 + 8 + markSize);
    const view = new DataView(buffer);
    const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + length * 2 + 8 + markSize, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, length * 2, true);
    const start = (pos - length + size) % size; // oldest kept sample
    for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, ring[(start + i) % size], true);
    const markAtByte = 44 + length * 2; // extra chunk after the sound: other players ignore it
    text(markAtByte, 'mark');
    view.setUint32(markAtByte + 4, markBytes.length, true);
    new Uint8Array(buffer, markAtByte + 8, markBytes.length).set(markBytes);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  return { add, mark, marks, seconds: () => filled / sampleRate, toWav };
}
