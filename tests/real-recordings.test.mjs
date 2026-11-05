// Real rehearsal recordings (kept on this Mac only, not in git). Skipped when the file is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readWav } from './helpers/wav.mjs';
import { createEngine, SETTINGS_DEFAULTS } from '../js/engine.js';

const dir = fileURLToPath(new URL('../recordings/', import.meta.url));

function countsIn(file) {
  const { sampleRate, samples } = readWav(dir + file);
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
