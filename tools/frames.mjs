// Prints per-frame features of a recorded clip (for tuning): time, loudness, hiss ratio, hiss-band level.
// Usage: node tools/frames.mjs clip.wav fromSeconds toSeconds
import { readWav } from '../tests/helpers/wav.mjs';
import { createFeatureExtractor } from '../js/features.js';

const [path, from = '0', to = '5'] = process.argv.slice(2);
const { sampleRate, samples } = readWav(path);
const fx = createFeatureExtractor(sampleRate);
const frames = fx.process(samples);
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)];
const loudFloor = pct(frames.map((f) => f.db), 0.2);
const ratioFloor = pct(frames.map((f) => f.sibRatioDb), 0.5);
console.log(`whole clip: loudness floor ${loudFloor.toFixed(1)} dB, median hiss ratio ${ratioFloor.toFixed(1)} dB`);
frames.forEach((f, i) => {
  const t = (i * fx.hopMs) / 1000;
  if (t < Number(from) || t > Number(to)) return;
  const bar = '#'.repeat(Math.max(0, Math.round((f.sibRatioDb + 40) / 2)));
  console.log(`${t.toFixed(2)}  above ${(f.db - loudFloor).toFixed(0).padStart(3)}  ratio ${f.sibRatioDb.toFixed(0).padStart(4)} ${bar}`);
});
