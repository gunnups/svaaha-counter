import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAgainstMarks } from '../tools/score.mjs';

test('counts are matched to the svaahaa marks tapped just after them', () => {
  const s = scoreAgainstMarks([4.5, 11.0, 20.0], [5.2, 11.8, 16.0]);
  assert.equal(s.hits, 2);
  assert.deepEqual(s.missed, [16.0]);
  assert.deepEqual(s.extra, [20.0]);
});

test('one count cannot satisfy two marks', () => {
  const s = scoreAgainstMarks([5.0], [5.2, 5.9]);
  assert.equal(s.hits, 1);
  assert.deepEqual(s.missed, [5.9]);
});
