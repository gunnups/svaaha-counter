import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svaha, svaha2, mantra, talk, SR, withRoom, mix, scale, run, counts } from './scenes.mjs';
import { marginFor } from '../js/engine.js';

const S = svaha.samples;
const S2 = svaha2.samples;

test('one svaahaa in a quiet room counts once', () => {
  assert.equal(counts(run(withRoom([1.5, S, 1.5]))), 1);
});

test('five svaahaas, a few seconds apart, count five', () => {
  const parts = [1.5];
  for (let i = 0; i < 5; i++) parts.push(S, 4);
  assert.equal(counts(run(withRoom(parts))), 5);
});

test('a full mantra followed by svaahaa counts once per offering', () => {
  const parts = [1.5];
  for (let i = 0; i < 3; i++) parts.push(mantra.samples, 0.15, S, 2.5);
  const decisions = run(withRoom(parts));
  assert.equal(counts(decisions), 3, JSON.stringify(decisions.map((d) => [d.type, d.reason, d.event.vowelMs])));
});

test('ordinary talking alone does not count', () => {
  assert.equal(counts(run(withRoom([1.5, talk.samples, 1, talk.samples, 1.5]))), 0);
});

test('several voices saying svaahaa together count once', () => {
  const offset = new Float32Array(Math.round(0.08 * SR));
  const late = new Float32Array([...offset, ...S2]);
  const together = mix(new Float32Array([...S, ...new Float32Array(late.length)]), late, 0.8);
  assert.equal(counts(run(withRoom([1.5, together, 2]))), 1);
});

test('a second svaahaa inside the minimum gap is not double counted', () => {
  assert.equal(counts(run(withRoom([1.5, S, 0.6, S, 2]), { gapSeconds: 3 })), 1);
});

test('svaahaa still counts with people talking ~20 dB quieter in the background', () => {
  const parts = [1.5];
  for (let i = 0; i < 4; i++) parts.push(S, 3.5);
  const room = withRoom(parts);
  const busy = mix(room, scale(talk.samples, 0.08), 1);
  assert.equal(counts(run(busy)), 4);
});

test('sensitivity maps to a sensible loudness margin', () => {
  assert.ok(marginFor(1) > marginFor(10));
  assert.equal(marginFor(5), 12);
  assert.equal(marginFor('junk'), 12);
});

test('mantra + svaahaa cycles count right with non-stop chatter ~23 dB quieter', () => {
  const parts = [2];
  for (let i = 0; i < 3; i++) parts.push(mantra.samples, 0.15, S, 3);
  const busy = mix(withRoom(parts), scale(talk.samples, 0.06), 1);
  assert.equal(counts(run(busy)), 3);
});

test('after learning mid-session, counts are placed at the real time of each svaahaa', async () => {
  const { createEngine, SETTINGS_DEFAULTS } = await import('../js/engine.js');
  const LEAD = 20; // listening for a while before learning starts
  const m = mantra.samples.length / SR;
  const s = svaha.samples.length / SR;
  const round = m + 0.15 + s + 3;
  const parts = [LEAD];
  for (let i = 0; i < 9; i++) parts.push(mantra.samples, 0.15, svaha.samples, 3);
  const audio = withRoom(parts);
  const svahaEnd = (k) => LEAD + k * round + m + 0.15 + s;
  const engine = createEngine(SR, SETTINGS_DEFAULTS, null);
  const ends = [];
  let marked = 0;
  for (let i = 0; i < audio.length; i += 2048) {
    const nowS = i / SR;
    if (nowS >= LEAD - 1 && !engine.learning && marked === 0) engine.startLearning();
    if (marked < 6 && nowS >= svahaEnd(marked) + 0.15) {
      engine.mark();
      marked++;
      if (marked === 6) {
        const result = engine.finishLearning();
        assert.ok(!result.error, result.error);
        engine.setLearned(result);
      }
    }
    for (const d of engine.push(audio.subarray(i, i + 2048))) if (d.type === 'count' && marked === 6) ends.push(d.event.endMs / 1000);
  }
  assert.equal(ends.length, 3, `counts at ${ends}`);
  ends.forEach((t, i) => assert.ok(Math.abs(t - svahaEnd(6 + i)) < 1, `count at ${t.toFixed(1)} s, svaahaa ended at ${svahaEnd(6 + i).toFixed(1)} s`));
});
