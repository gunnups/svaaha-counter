import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpotter, createVectoriser } from '../js/spotter.js';
import { NUM_BANDS } from '../js/features.js';

/** A made-up "word": a sweep of sound colour over n frames. */
const word = (n) =>
  Array.from({ length: n }, (_, i) => Float32Array.from({ length: NUM_BANDS }, (_, b) => Math.sin((b + 1) * (i / n) * 3)));
const noiseFrame = (seed) => Float32Array.from({ length: NUM_BANDS }, (_, b) => Math.sin(seed * 12.9898 + b * 78.233) * 1.5);

function run(spotter, frames) {
  const hits = [];
  frames.forEach((f) => {
    const h = spotter.push(f);
    if (h) hits.push(h.atMs);
  });
  return hits;
}

test('a word is found once, even said slower or faster than its template', () => {
  const template = word(40);
  const slow = word(60);
  const fast = word(28);
  const filler = (k) => Array.from({ length: 150 }, (_, i) => noiseFrame(k * 1000 + i));
  for (const said of [template, slow, fast]) {
    const spot = createSpotter([template], { threshold: 0.6, minGapMs: 500 }, 20);
    const hits = run(spot, [...filler(1), ...said, ...filler(2)]);
    assert.equal(hits.length, 1, `said in ${said.length} frames`);
    assert.ok(Math.abs(hits[0] - (150 + said.length) * 20) < 300, `found at ${hits[0]} ms`);
  }
});

test('other sounds are not counted', () => {
  const spot = createSpotter([word(40)], { threshold: 0.6 }, 20);
  assert.equal(run(spot, Array.from({ length: 600 }, (_, i) => noiseFrame(i))).length, 0);
});

test('sound colour is judged against the recent average (a constant mic colouring disappears)', () => {
  const vec = createVectoriser(20);
  const tilt = Float32Array.from({ length: NUM_BANDS }, (_, b) => -b * 2);
  let last;
  for (let i = 0; i < 500; i++) last = vec(tilt);
  assert.ok(last.every((x) => Math.abs(x) < 1e-3));
});
