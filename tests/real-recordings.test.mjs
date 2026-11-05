// Real rehearsal recordings (kept on this Mac only, not in git). Skipped when the file is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readWav } from './helpers/wav.mjs';
import { createEngine, SETTINGS_DEFAULTS } from '../js/engine.js';

const dir = fileURLToPath(new URL('../recordings/', import.meta.url));

function countsIn(file, tailSeconds = 0) {
  const { sampleRate, samples: recorded } = readWav(dir + file);
  // optional quiet tail: the app keeps listening after the clip was saved
  const samples = new Float32Array(recorded.length + Math.round(tailSeconds * sampleRate));
  samples.set(recorded);
  const engine = createEngine(sampleRate, SETTINGS_DEFAULTS, { positives: [], negatives: [] });
  const ends = [];
  for (let i = 0; i < samples.length; i += 2048) {
    for (const d of engine.push(samples.subarray(i, i + 2048))) if (d.type === 'count') ends.push(d.event.endMs / 1000);
  }
  return ends;
}

const quietHouse = 'svaha-test-2026-11-05-0855.wav';
test('real rehearsal, MacBook mic, house noise: 10 mantra + svaahaa rounds count 10, one per round', { skip: !existsSync(dir + quietHouse) }, () => {
  const ends = countsIn(quietHouse);
  assert.equal(ends.length, 10);
  // rounds are ~5.8 s apart: no two counts inside one round
  for (let i = 1; i < ends.length; i++) assert.ok(ends[i] - ends[i - 1] > 4.5, `counts at ${ends[i - 1]} and ${ends[i]} too close`);
});

const continuous = 'svaha-test-2026-11-05-092516.wav';
test('real rehearsal, continuous chanting (no pause before svaahaa): 3 rounds count 3, each at the round end', { skip: !existsSync(dir + continuous) }, () => {
  const ends = countsIn(continuous, 2);
  assert.equal(ends.length, 3);
  // svaahaa ends each round at ~7.5 s, ~13.5 s, ~19.6 s
  [7.5, 13.5, 19.6].forEach((t, i) => assert.ok(Math.abs(ends[i] - t) < 0.6, `count ${i + 1} at ${ends[i]} s, expected ~${t} s`));
});
