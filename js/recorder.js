// Records raw microphone samples for a while and turns them into a WAV file,
// so a rehearsal can be saved and replayed exactly when tuning detection.

export const MAX_SECONDS = 120;

/**
 * @param {number} sampleRate
 * @returns {{add: (samples: Float32Array) => boolean, seconds: () => number, toWav: () => Blob}}
 *   add() returns false once the recording is full.
 */
export function createRecorder(sampleRate) {
  const limit = Math.round(MAX_SECONDS * sampleRate);
  const chunks = [];
  let length = 0;

  function add(samples) {
    if (length >= limit) return false;
    const take = samples.subarray(0, Math.min(samples.length, limit - length));
    chunks.push(Float32Array.from(take));
    length += take.length;
    return length < limit;
  }

  function toWav() {
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
    let o = 44;
    for (const chunk of chunks) {
      for (const v of chunk) {
        view.setInt16(o, Math.round(Math.max(-1, Math.min(1, v)) * 32767), true);
        o += 2;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  return { add, seconds: () => length / sampleRate, toWav };
}
