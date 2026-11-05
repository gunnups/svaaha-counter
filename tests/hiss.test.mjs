// Real-room cases for the "s": a soft "s" before a loud "aa", and music playing underneath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { svaha, svaha2, mantra, talk, withRealRoom as withRoom, mix, scale, run, counts, SR } from './scenes.mjs';

const S_END_SECONDS = 0.13; // the "s" of the svaha.wav clip ends here

/** The same svaahaa with its "s" made `db` quieter (people often say the "s" softly). */
function softS(clip, db) {
  const out = Float32Array.from(clip);
  const gain = 10 ** (-db / 20);
  const end = Math.round(S_END_SECONDS * SR);
  for (let i = 0; i < end; i++) out[i] *= gain;
  return out;
}

/** Sustained harmonium/tanpura-like chord (harmonics up to ~4 kHz) with slow swell. */
function music(seconds, amp) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const notes = [146.8, 220, 293.7];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let v = 0;
    for (const f of notes) for (let h = 1; h * f < 4000; h++) v += Math.sin(2 * Math.PI * f * h * t) / h;
    out[i] = v * amp * (0.8 + 0.2 * Math.sin(2 * Math.PI * 0.3 * t));
  }
  return out;
}

const repeat = (clip, n) => [1.5, ...Array.from({ length: n }, () => [clip, 3]).flat()];

test('a softer "s" (6 dB quieter) still counts', () => {
  assert.equal(counts(run(withRoom(repeat(softS(svaha.samples, 6), 4)))), 4);
});

test('svaahaa counts over steady background music', () => {
  const voice = withRoom(repeat(svaha.samples, 4));
  assert.equal(counts(run(mix(voice, music(voice.length / SR, 0.01), 0))), 4);
});

test('soft "s" over background music still counts', () => {
  const voice = withRoom(repeat(softS(svaha.samples, 6), 4));
  assert.equal(counts(run(mix(voice, music(voice.length / SR, 0.01), 0))), 4);
});

test('music alone does not count', () => {
  assert.equal(counts(run(withRoom([1, music(15, 0.03), 1]))), 0);
});

test('mantra and talk over music do not count', () => {
  const voice = withRoom([1, mantra.samples, 1, talk.samples, 1]);
  assert.equal(counts(run(mix(voice, music(voice.length / SR, 0.01), 0))), 0);
});

test('mantra then svaahaa over music counts once per offering', () => {
  const voice = withRoom([1.5, mantra.samples, 0.15, svaha.samples, 3, mantra.samples, 0.15, svaha2.samples, 3]);
  assert.equal(counts(run(mix(voice, music(voice.length / SR, 0.01), 0))), 2);
});
