// Minimal WAV (PCM 16-bit mono) reader and scene builder for tests.
import { readFileSync, writeFileSync } from 'node:fs';

export function readWav(path) {
  const buf = readFileSync(path);
  let pos = 12;
  let sampleRate = 0;
  while (pos < buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') sampleRate = buf.readUInt32LE(pos + 12);
    if (id === 'data') {
      const n = size / 2;
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(pos + 8 + i * 2) / 32768;
      return { sampleRate, samples };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

/** Seeded pseudo-random noise so tests are repeatable. */
export function noise(n, amp, seed = 1) {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = ((s / 4294967296) * 2 - 1) * amp;
  }
  return out;
}

/** Seeded pink-ish noise (more rumble than hiss, like a real room). */
export function pinkNoise(n, amp, seed = 3) {
  const white = noise(n, 1, seed);
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = white[i];
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    out[i] = (b0 + b1 + b2 + w * 0.1848) * amp * 0.25;
  }
  return out;
}

/** Concatenate clips with silences; parts are Float32Array or seconds of silence (number). */
export function scene(sampleRate, parts) {
  const arrays = parts.map((p) => (typeof p === 'number' ? new Float32Array(Math.round(p * sampleRate)) : p));
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

/** Add b into a (b repeats to cover a), scaled by gain. Returns a new array. */
export function mix(a, b, gain) {
  const out = Float32Array.from(a);
  for (let i = 0; i < out.length; i++) out[i] += b[i % b.length] * gain;
  return out;
}

export const scale = (a, g) => a.map((v) => v * g);

/** Write mono PCM16 WAV. */
export function writeWav(path, samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  writeFileSync(path, buf);
}
