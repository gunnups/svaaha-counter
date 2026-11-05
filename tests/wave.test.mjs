import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWaveHistory } from '../js/wave.js';

const opts = { windowMs: 1000, columnMs: 100 }; // 10 columns
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('the window always has the same number of columns, oldest first', () => {
  const w = createWaveHistory(opts);
  w.add(950, 0.5, true);
  const cols = w.columns(1000);
  assert.equal(cols.length, 10);
  near(cols[9].peak, 0.5);
  assert.equal(cols[0].kind, 'empty');
});

test('quiet, mantra (voice) and svaahaa are told apart', () => {
  const w = createWaveHistory(opts);
  w.add(50, 0.01, false); // quiet
  w.add(150, 0.3, true); // chanting
  w.add(250, 0.4, true); // the svaahaa...
  w.markSvaha(200, 300); // ...once it is counted
  const [quiet, mantra, svaha] = w.columns(300).slice(-3);
  assert.equal(quiet.kind, 'quiet');
  assert.equal(mantra.kind, 'voice');
  assert.equal(svaha.kind, 'svaha');
});

test('each column keeps its loudest moment', () => {
  const w = createWaveHistory(opts);
  w.add(10, 0.2, false);
  w.add(40, 0.6, true);
  w.add(70, 0.1, false);
  const col = w.columns(100)[9];
  near(col.peak, 0.6);
  assert.equal(col.kind, 'voice');
});

test('sound older than the window scrolls out', () => {
  const w = createWaveHistory(opts);
  w.add(50, 0.9, true);
  const cols = w.columns(3000);
  assert.ok(cols.every((c) => c.kind === 'empty'));
});

test('a reused slot does not show stale sound from a minute ago', () => {
  const w = createWaveHistory(opts);
  w.add(50, 0.9, true);
  w.add(2050, 0.2, false); // same ring slot, newer time
  const cols = w.columns(2100);
  near(cols[9].peak, 0.2);
  assert.equal(cols[9].kind, 'quiet');
});
