import { test } from 'node:test';
import assert from 'node:assert/strict';
import { learnFromSession, MIN_MARKS } from '../js/learn.js';
import { createSpotter } from '../js/spotter.js';
import { NUM_BANDS } from '../js/features.js';

const HOP = 21.33;
const frames = (s) => Math.round((s * 1000) / HOP);
/** A made-up svaahaa: a sweep of sound colour, `n` frames long, with a little variation. */
const svaha = (n, wobble) =>
  Array.from({ length: n }, (_, i) =>
    Float32Array.from({ length: NUM_BANDS }, (_, b) => 2 * Math.sin((b + 1) * (i / n) * 3) + 0.2 * Math.sin(wobble + b)),
  );
const mantra = (n, seed) =>
  Array.from({ length: n }, (_, i) => Float32Array.from({ length: NUM_BANDS }, (_, b) => 1.5 * Math.sin((seed + i) * 0.37 * (b + 2))));

/** Rounds of mantra then svaahaa; returns the vectors and where each svaahaa ended (the mark). */
function session(rounds, offset = 0) {
  const vectors = [];
  const marks = [];
  for (let r = 0; r < rounds; r++) {
    vectors.push(...mantra(frames(4), (r + offset) * 997));
    vectors.push(...svaha(frames(1.0 + 0.1 * (r % 3)), r + offset));
    marks.push(vectors.length + 2); // tapped just after
    vectors.push(...mantra(frames(1), (r + offset) * 31 + 5));
  }
  return { vectors, marks };
}

function count(templates, threshold, vectors) {
  const spot = createSpotter(templates, { threshold }, HOP);
  return [...vectors, ...mantra(frames(2), 4242)].filter((v) => spot.push(v)).length;
}

test(`needs at least ${MIN_MARKS} marked svaahaa`, () => {
  const { vectors, marks } = session(3);
  assert.match(learnFromSession(vectors, marks, HOP).error, /at least/);
});

test('learns from a marked session and then counts a new session correctly', () => {
  const learning = session(8);
  const learned = learnFromSession(learning.vectors, learning.marks, HOP);
  assert.equal(learned.templates.length, 8);
  assert.ok(learned.quality.separated, JSON.stringify(learned.quality));
  const later = session(6, 50);
  assert.equal(count(learned.templates, learned.threshold, later.vectors), 6);
  assert.equal(count(learned.templates, learned.threshold, mantra(frames(30), 77)), 0);
});

test('adding a second session keeps the earlier examples too', () => {
  const first = session(6);
  const solo = learnFromSession(first.vectors, first.marks, HOP);
  const second = session(5, 20);
  const both = learnFromSession(second.vectors, second.marks, HOP, solo.templates);
  assert.equal(both.templates.length, 11);
});
