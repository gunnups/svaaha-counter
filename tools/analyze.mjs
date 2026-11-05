// Replays a recorded WAV (e.g. from "Record a test clip") through the detector
// and prints every decision, to tune the settings for real voices.
// Usage: node tools/analyze.mjs path/to/clip.wav [minVowelMs=600] [sensitivity=5] [strictness=1]
import { readWav } from '../tests/helpers/wav.mjs';
import { createEngine, SETTINGS_DEFAULTS } from '../js/engine.js';

const [path, minVowelMs, sensitivity, strictness] = process.argv.slice(2);
if (!path) {
  console.error('usage: node tools/analyze.mjs clip.wav [minVowelMs] [sensitivity] [strictness]');
  process.exit(1);
}
const { sampleRate, samples } = readWav(path);
const settings = {
  ...SETTINGS_DEFAULTS,
  ...(minVowelMs && { minVowelMs: Number(minVowelMs) }),
  ...(sensitivity && { sensitivity: Number(sensitivity) }),
  ...(strictness && { strictness: Number(strictness) }),
};
const engine = createEngine(sampleRate, settings, { positives: [], negatives: [] });
let n = 0;
for (let i = 0; i < samples.length; i += 2048) {
  for (const d of engine.push(samples.subarray(i, i + 2048))) {
    const e = d.event;
    if (d.type === 'count') n++;
    const flux = e.flux !== undefined ? ` steady=${e.flux}` : '';
    console.log(`${(e.startMs / 1000).toFixed(2)}-${(e.endMs / 1000).toFixed(2)}s  ${d.type.padEnd(8)} aa=${e.vowelMs}ms${flux}  ${d.reason ?? ''}`);
  }
}
console.log(`\n${(samples.length / sampleRate).toFixed(1)} s @ ${sampleRate} Hz -> ${n} counted`);
