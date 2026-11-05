import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../js/recorder.js';
import { createDetector } from '../js/detector.js';
import { createFeatureExtractor } from '../js/features.js';
import { mantra, withRoom, SR, run } from './scenes.mjs';

test('a test recording is saved as a 16-bit mono WAV at the mic rate', async () => {
  const rec = createRecorder(48000);
  rec.add(new Float32Array([0, 0.5, -0.5, 1]));
  const bytes = new DataView(await rec.toWav().arrayBuffer());
  assert.equal(bytes.byteLength, 44 + 4 * 2);
  assert.equal(bytes.getUint32(24, true), 48000);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(bytes.getInt16(46, true), 16384);
  assert.equal(bytes.getInt16(50, true), 32767);
  assert.equal(rec.seconds(), 4 / 48000);
});

test('the recording stops growing at its limit', () => {
  const rec = createRecorder(10);
  let open = true;
  for (let i = 0; i < 200 && open; i++) open = rec.add(new Float32Array(10));
  assert.equal(open, false);
  assert.equal(rec.seconds(), 120);
});

test('a long held vowel with no "s" in front is reported, never counted', () => {
  const fx = createFeatureExtractor(SR);
  const det = createDetector(fx.hopMs);
  const tone = new Float32Array(SR * 1.2).map((_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR));
  const audio = withRoom([1, tone, 1]);
  const events = [];
  for (const f of fx.process(audio)) {
    const e = det.step(f);
    if (e) events.push(e);
  }
  assert.ok(events.some((e) => e.rejected === 'no "s" heard before the "aa"'));
  assert.equal(run(audio).filter((d) => d.type === 'count').length, 0);
});

test('chanting the mantra alone does not count', () => {
  assert.equal(run(withRoom([1, mantra.samples, 2])).filter((d) => d.type === 'count').length, 0);
});
