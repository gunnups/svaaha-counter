// Gayatri mantra chanted by a group, then svaahaa - with and without a pause before svaahaa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svaha, svaha2, mantra, talk, withRoom, mix, scale, run, counts, SR, scene } from './scenes.mjs';

const shift = (a, seconds) => scene(SR, [seconds, a]);
/** Three voices, slightly out of step and at different loudness. */
const group = (a, b = a) => mix(mix(a, shift(scale(b, 0.8), 0.07), 1), shift(scale(a, 0.7), 0.13), 1);

function offerings(n, pauseBeforeSvaha, chanters) {
  const m = chanters(mantra.samples);
  const s = chanters(svaha.samples, svaha2.samples);
  const parts = [2];
  for (let i = 0; i < n; i++) parts.push(m, pauseBeforeSvaha, s, 2.5);
  return withRoom(parts);
}

const solo = (a) => a;

for (const [who, chanters] of [['one person', solo], ['three people together', group]]) {
  test(`${who}: mantra then svaahaa with a short pause counts every offering`, () => {
    assert.equal(counts(run(offerings(5, 0.15, chanters))), 5);
  });
  test(`${who}: "...prachodayaat svaahaa" in one breath counts every offering`, () => {
    assert.equal(counts(run(offerings(5, 0, chanters))), 5);
  });
}

test('three people chanting the mantra (no svaahaa) do not count', () => {
  assert.equal(counts(run(withRoom([1, group(mantra.samples), 1, group(mantra.samples), 2]))), 0);
});

test('three people talking together do not count', () => {
  assert.equal(counts(run(withRoom([1, group(talk.samples), 2]))), 0);
});
