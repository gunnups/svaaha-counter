// Always keeps the last couple of minutes of microphone sound, so that after a
// miss the exact audio can be saved as a WAV file and replayed when tuning.

export const MAX_SECONDS = 120;

/**
 * @param {number} sampleRate
 * @returns {{add: (samples: Float32Array) => void, seconds: () => number, toWav: () => Blob}}
 */
export function createRecorder(sampleRate) {
  const size = Math.round(MAX_SECONDS * sampleRate);
  const ring = new Int16Array(size); // 16-bit keeps memory small on phones (~11 MB)
  let pos = 0;
  let filled = 0;

  function add(samples) {
    for (const v of samples) {
      ring[pos] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
      pos = (pos + 1) % size;
    }
    filled = Math.min(size, filled + samples.length);
  }

  function toWav() {
    const length = filled;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
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
    return new Blob([buffer], { type: 'audio/wav' });
  }

  return { add, seconds: () => filled / sampleRate, toWav };
}
