// End-to-end: real Chrome, real page, a recorded scene played in as the microphone.
// Run: npm run e2e   (serves the app itself on a free port)
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { svaha, mantra, talk, SR, withRoom, mix, scale } from '../scenes.mjs';
import { openApp, out } from './harness.mjs';

// 3 offerings: mantra -> svaahaa, with people chatting quietly underneath.
const parts = [2];
for (let i = 0; i < 3; i++) parts.push(mantra.samples, 0.15, svaha.samples, 3);
const sceneAudio = mix(withRoom(parts), scale(talk.samples, 0.06), 1);
const sceneSeconds = sceneAudio.length / SR;
const app = await openApp(sceneAudio, SR, 'scene.wav');
const { page } = app;

let failed = false;
try {

  // Turn on Test so we can see decisions; it offers to learn first - not now.
  await page.click('#test-toggle');
  await page.click('#learn-ask-no');
  if ((await page.getAttribute('#test-toggle', 'aria-checked')) !== 'true') throw new Error('Test switch did not turn on');

  page.on('console', (m) => console.log('console:', m.text()));
  await page.click('#listen');
  await page
    .waitForFunction(() => document.getElementById('status').dataset.state === 'listening', null, { timeout: 10000 })
    .catch(async (err) => {
      console.error('status:', await page.textContent('#status-text'));
      throw err;
    });
  // Press Space (focus is still on Start/Stop) a few times as "I said svaahaa" marks.
  await page.waitForTimeout(12000);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
  }
  const stillListening = await page.evaluate(() => document.getElementById('listen').textContent);
  console.log('after Space x3, button says:', stillListening);
  if (stillListening !== 'Stop') failed = true;
  await page.waitForTimeout((sceneSeconds + 1.5 - 12 - 4.5) * 1000);
  const count = Number(await page.textContent('#count'));
  const log = await page.$$eval('#log li', (lis) => lis.map((li) => li.textContent).reverse());
  console.log(`scene ${sceneSeconds.toFixed(1)} s -> count ${count}`);
  console.log(log.join('\n'));
  if (count !== 3) failed = true;

  // The scrolling sound picture shows mantra (blue-grey) and counted svaahaa (saffron) bars, and clock labels.
  const picture = await page.evaluate(() => {
    const c = document.getElementById('wave');
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let svaha = 0;
    let voice = 0;
    let marks = 0;
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
      if (a < 200) continue;
      if (r === 240 && g === 131 && b === 42) svaha++;
      if (r === 127 && g === 155 && b === 181) voice++;
      if (r === 244 && g === 234 && b === 214) marks++;
    }
    return { svaha, voice, marks, start: document.getElementById('wave-start').textContent, end: document.getElementById('wave-end').textContent };
  });
  console.log('sound picture:', JSON.stringify(picture));
  // left = when Start was pressed (fixed), right = now: about the scene length apart
  const secs = (hms) => hms.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  const span = secs(picture.end) - secs(picture.start);
  if (!picture.svaha || !picture.voice || Math.abs(span - sceneSeconds) > 4) failed = true;
  await page.screenshot({ path: join(out, 'listening-portrait.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: join(out, 'listening-landscape-phone.png') });
  await page.setViewportSize({ width: 390, height: 844 });

  // "Save last 2 min of sound" downloads what was just heard.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#save-sound')]);
  const saved = join(out, download.suggestedFilename());
  await download.saveAs(saved);
  const wavBytes = (await readFile(saved)).length;
  const { readWav } = await import('../helpers/wav.mjs');
  const savedMarks = readWav(saved).marks;
  console.log('marks in saved clip:', JSON.stringify(savedMarks));
  if (savedMarks.length !== 3) failed = true;
  console.log(`test clip: ${download.suggestedFilename()} ${wavBytes} bytes`);
  if (!/^svaha-test-.*\.wav$/.test(download.suggestedFilename()) || wavBytes < 48000 * 2 * 30) failed = true;

  // Count survives a reload.
  await page.reload();
  const after = Number(await page.textContent('#count'));
  console.log(`after reload: ${after}`);
  if (after !== count) failed = true;

  await page.screenshot({ path: join(out, 'portrait.png') });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.screenshot({ path: join(out, 'landscape-phone.png') });
  await page.setViewportSize({ width: 1340, height: 800 });
  await page.screenshot({ path: join(out, 'landscape-tablet.png') });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: join(out, 'portrait-tablet.png') });
} finally {
  if (app.errors.length) {
    failed = true;
    console.error('page errors:', app.errors);
  }
  await app.close();
}

console.log(failed ? 'E2E FAILED' : 'E2E PASSED');
process.exit(failed ? 1 : 0);
