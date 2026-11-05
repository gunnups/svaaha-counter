import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatureExtractor, NUM_BANDS } from '../js/features.js';
import { noise } from './helpers/wav.mjs';

const SR = 48000;
const tone = (hz, seconds) => Float32Array.from({ length: SR * seconds }, (_, i) => 0.3 * Math.sin((2 * Math.PI * hz * i) / SR));

function highPassNoise(seconds) {
  const n = noise(SR * seconds, 0.3, 3);
  return n.map((v, i) => (i ? v - n[i - 1] : v)); // first difference = crude high-pass
}

test('frames arrive roughly every 10 ms regardless of chunk size', () => {
  const fx = createFeatureExtractor(SR);
  assert.ok(fx.hopMs > 8 && fx.hopMs < 12);
  const a = tone(200, 1);
  const whole = createFeatureExtractor(SR).process(a).length;
  let chunked = 0;
  for (let i = 0; i < a.length; i += 128) chunked += fx.process(a.subarray(i, i + 128)).length;
  assert.equal(chunked, whole);
});

test('a low voiced tone reads as vowel-like (low hiss ratio)', () => {
  const frames = createFeatureExtractor(SR).process(tone(220, 0.5));
  const mid = frames[Math.floor(frames.length / 2)];
  assert.ok(mid.sibRatioDb < -20, `got ${mid.sibRatioDb}`);
  assert.equal(mid.bands.length, NUM_BANDS);
});

test('high-frequency hiss reads as "s"-like (high hiss ratio)', () => {
  const frames = createFeatureExtractor(SR).process(highPassNoise(0.5));
  const mid = frames[Math.floor(frames.length / 2)];
  assert.ok(mid.sibRatioDb > 0, `got ${mid.sibRatioDb}`);
});

test('works at 44.1 kHz and 16 kHz too', () => {
  for (const sr of [44100, 16000]) {
    const fx = createFeatureExtractor(sr);
    const frames = fx.process(new Float32Array(sr));
    assert.ok(Math.abs(frames.length - 1000 / fx.hopMs) < 3, `${sr}: ${frames.length}`);
  }
});
