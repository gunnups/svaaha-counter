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
  assert.equal(bytes.getUint32(40, true), 4 * 2); // data size: 4 samples
  assert.equal(bytes.getUint32(24, true), 48000);
  assert.equal(bytes.getUint16(34, true), 16);
  assert.equal(bytes.getInt16(46, true), 16384);
  assert.equal(bytes.getInt16(50, true), 32767);
  assert.equal(rec.seconds(), 4 / 48000);
});

test('only the most recent 2 minutes are kept, oldest first', async () => {
  const rec = createRecorder(10); // 10 samples/s -> keeps 1200 samples
  for (let i = 0; i < 1300; i++) rec.add(new Float32Array([(i % 100) / 100]));
  assert.equal(rec.seconds(), 120);
  const view = new DataView(await rec.toWav().arrayBuffer());
  assert.equal(view.getInt16(44, true), Math.round(0.0 * 32767)); // sample #100 (value 0.00) is the oldest kept
  assert.equal(view.getInt16(46, true), Math.round(0.01 * 32767));
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

test('marks are saved in the WAV and read back, in seconds from the clip start', async () => {
  const { readWav } = await import('./helpers/wav.mjs');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const rec = createRecorder(100); // 100 samples/s
  rec.add(new Float32Array(150)); // 1.5 s
  rec.mark();                     // at 1.5 s
  rec.add(new Float32Array(50));  // 2.0 s total
  const path = join(mkdtempSync(join(tmpdir(), 'svaha-')), 'clip.wav');
  writeFileSync(path, Buffer.from(await rec.toWav().arrayBuffer()));
  const clip = readWav(path);
  assert.equal(clip.samples.length, 200);
  assert.deepEqual(clip.marks, [1.5]);
});

test('marks older than the kept 2 minutes are dropped', async () => {
  const rec = createRecorder(10);
  rec.mark(); // at 0 s
  for (let i = 0; i < 1300; i++) rec.add(new Float32Array([0])); // 130 s
  rec.mark();
  assert.deepEqual(rec.marks(), [120]);
});
