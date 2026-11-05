import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svaha, svaha2, mantra, talk, withRoom, run, counts } from './scenes.mjs';
import { dtwDistance, toSequence, matchTaught, learnThreshold } from '../js/templates.js';

function teach(samples, mode) {
  return run(samples, {}, { positives: [], negatives: [] }, mode)
    .filter((d) => d.type.startsWith('taught'))
    .map((d) => d.seq);
}

test('teach mode captures each spoken svaahaa as an example', () => {
  const positives = teach(withRoom([1.5, svaha.samples, 2, svaha2.samples, 2, svaha.samples, 2]), 'teach-svaha');
  assert.equal(positives.length, 3);
});

test('after teaching, svaahaa still counts and mantra + talk do not', () => {
  const positives = teach(withRoom([1.5, svaha.samples, 2, svaha2.samples, 2, svaha.samples, 2]), 'teach-svaha');
  const negatives = teach(withRoom([1.5, mantra.samples, 1, talk.samples, 1.5]), 'teach-background');
  const taught = { positives, negatives };
  const parts = [1.5];
  for (let i = 0; i < 3; i++) parts.push(mantra.samples, 0.15, svaha.samples, 2.5);
  parts.push(talk.samples, 2);
  const decisions = run(withRoom(parts), {}, taught);
  assert.equal(counts(decisions), 3, JSON.stringify(decisions.map((d) => [d.type, d.reason])));
});

test('distance is zero to itself and symmetric-ish', () => {
  const frames = Array.from({ length: 50 }, (_, i) => ({ bands: Float32Array.from({ length: 16 }, (_, b) => Math.sin(i / 5 + b)) }));
  const seq = toSequence(frames);
  assert.equal(dtwDistance(seq, seq), 0);
  assert.equal(matchTaught(null, { positives: [seq], negatives: [] }).ok, true);
  assert.equal(learnThreshold([seq]), 9);
});
