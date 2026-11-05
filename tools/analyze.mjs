// Replays a recorded WAV (from "Save last 2 min of sound") through the detector and prints
// every decision. If the clip has svaahaa marks (tapped while chanting), it also scores the
// app against them: hits, misses and extra counts.
// Usage: node tools/analyze.mjs path/to/clip.wav [minVowelMs=600] [sensitivity=5] [strictness=1]
import { readWav } from '../tests/helpers/wav.mjs';
import { createEngine, SETTINGS_DEFAULTS } from '../js/engine.js';
import { scoreAgainstMarks } from './score.mjs';

const TAIL_SECONDS = 2; // the app keeps listening after the clip was saved

const [path, minVowelMs, sensitivity, strictness] = process.argv.slice(2);
if (!path) {
  console.error('usage: node tools/analyze.mjs clip.wav [minVowelMs] [sensitivity] [strictness]');
  process.exit(1);
}
const { sampleRate, samples: recorded, marks } = readWav(path);
const samples = new Float32Array(recorded.length + TAIL_SECONDS * sampleRate);
samples.set(recorded);
const settings = {
  ...SETTINGS_DEFAULTS,
  ...(minVowelMs && { minVowelMs: Number(minVowelMs) }),
  ...(sensitivity && { sensitivity: Number(sensitivity) }),
  ...(strictness && { strictness: Number(strictness) }),
};
const engine = createEngine(sampleRate, settings, { positives: [], negatives: [] });
const countEnds = [];
for (let i = 0; i < samples.length; i += 2048) {
  for (const d of engine.push(samples.subarray(i, i + 2048))) {
    const e = d.event;
    if (d.type === 'count') countEnds.push(e.endMs / 1000);
    if (e.vowelMs < 300 && d.type !== 'count') continue; // skip tiny fragments
    const flux = e.flux !== undefined ? ` steady=${e.flux}` : '';
    console.log(`${(e.startMs / 1000).toFixed(2)}-${(e.endMs / 1000).toFixed(2)}s  ${d.type.padEnd(8)} aa=${e.vowelMs}ms${flux}  ${d.reason ?? ''}`);
  }
}
console.log(`\n${(recorded.length / sampleRate).toFixed(1)} s @ ${sampleRate} Hz -> ${countEnds.length} counted`);
if (marks.length) {
  const s = scoreAgainstMarks(countEnds, marks);
  console.log(`marks: ${marks.length}  hits: ${s.hits}  missed: ${s.missed.length}  extra counts: ${s.extra.length}`);
  if (s.missed.length) console.log(`  missed svaahaa marked at: ${s.missed.map((t) => t.toFixed(1) + 's').join(', ')}`);
  if (s.extra.length) console.log(`  extra counts at: ${s.extra.map((t) => t.toFixed(1) + 's').join(', ')}`);
}
