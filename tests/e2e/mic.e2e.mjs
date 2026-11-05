// End-to-end: real Chrome, real page, a recorded scene played in as the microphone.
// Run: npm run e2e   (serves the app itself on a free port)
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svaha, mantra, talk, SR, withRoom, mix, scale } from '../scenes.mjs';
import { writeWav } from '../helpers/wav.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = fileURLToPath(new URL('./out/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(root, path.endsWith('/') ? path + 'index.html' : path);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    let body;
    try {
      body = await readFile(file);
    } catch {
      return res.writeHead(404).end();
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// 3 offerings: mantra -> svaahaa, with people chatting quietly underneath.
const parts = [2];
for (let i = 0; i < 3; i++) parts.push(mantra.samples, 0.15, svaha.samples, 3);
const sceneAudio = mix(withRoom(parts), scale(talk.samples, 0.06), 1);
const sceneSeconds = sceneAudio.length / SR;
await mkdir(out, { recursive: true });
writeWav(join(out, 'scene.wav'), sceneAudio, SR);

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });

// Headless Chrome on macOS cannot open even a fake microphone here, so the
// microphone (only) is replaced by a player of the recorded scene. Everything
// after it - audio worklet, detection, counting, storage, UI - is the real app.
function fakeMicFromScene() {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const data = await (await fetch('/tests/e2e/out/scene.wav')).arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    const player = ctx.createBufferSource();
    player.buffer = buffer;
    const dest = ctx.createMediaStreamDestination();
    player.connect(dest);
    await ctx.resume();
    player.start();
    return dest.stream;
  };
}

let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page.on('pageerror', (e) => {
    failed = true;
    console.error('page error:', e.message);
  });
  await page.addInitScript(fakeMicFromScene);
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // Turn on the test log so we can see decisions.
  await page.click('#open-settings');
  await page.check('input[name="showLog"]');
  await page.click('#settings button[value="close"]');

  page.on('console', (m) => console.log('console:', m.text()));
  await page.click('#listen');
  await page
    .waitForFunction(() => document.getElementById('status').dataset.state === 'listening', null, { timeout: 10000 })
    .catch(async (err) => {
      console.error('status:', await page.textContent('#status-text'));
      throw err;
    });
  await page.waitForTimeout((sceneSeconds + 1.5) * 1000);
  const count = Number(await page.textContent('#count'));
  const log = await page.$$eval('#log li', (lis) => lis.map((li) => li.textContent).reverse());
  console.log(`scene ${sceneSeconds.toFixed(1)} s -> count ${count}`);
  console.log(log.join('\n'));
  if (count !== 3) failed = true;

  // "Record a test clip" saves a WAV download.
  await page.click('#open-settings');
  await page.click('#record');
  await page.waitForTimeout(1500);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#record')]);
  const saved = join(out, download.suggestedFilename());
  await download.saveAs(saved);
  const wavBytes = (await readFile(saved)).length;
  console.log(`test clip: ${download.suggestedFilename()} ${wavBytes} bytes`);
  if (!/^svaha-test-.*\.wav$/.test(download.suggestedFilename()) || wavBytes < 48000) failed = true;
  await page.click('#settings button[value="close"]');

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
  await browser.close();
  server.close();
}

console.log(failed ? 'E2E FAILED' : 'E2E PASSED');
process.exit(failed ? 1 : 0);
