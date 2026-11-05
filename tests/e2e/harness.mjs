// Shared e2e setup: serves the app, launches real Chrome, and replaces only the
// microphone with a player of a recorded scene (headless Chrome on macOS cannot open
// even a fake microphone). Everything after it is the real app.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeWav } from '../helpers/wav.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const out = fileURLToPath(new URL('./out/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json' };

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

/** In the page: getUserMedia plays the scene; window.__sceneStart = performance.now() at its start. */
function fakeMicFromScene(sceneUrl) {
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext();
    const data = await (await fetch(sceneUrl)).arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    const player = ctx.createBufferSource();
    player.buffer = buffer;
    const dest = ctx.createMediaStreamDestination();
    player.connect(dest);
    await ctx.resume();
    player.start();
    window.__sceneStart = performance.now();
    return dest.stream;
  };
}

/**
 * @param {Float32Array} sceneAudio
 * @param {number} sampleRate
 * @param {string} name  file name for the scene under tests/e2e/out/
 */
export async function openApp(sceneAudio, sampleRate, name, launchArgs = ['--autoplay-policy=no-user-gesture-required']) {
  await mkdir(out, { recursive: true });
  writeWav(join(out, name), sceneAudio, sampleRate);
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ channel: 'chrome', args: launchArgs });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(fakeMicFromScene, `/tests/e2e/out/${name}`);
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  /** Wait until the scene has played `seconds` of audio. */
  const atSceneTime = (seconds) =>
    page.waitForFunction((s) => window.__sceneStart !== undefined && performance.now() - window.__sceneStart >= s * 1000, seconds, {
      timeout: (seconds + 30) * 1000,
      polling: 20,
    });
  const close = async () => {
    await browser.close();
    server.close();
  };
  return { page, errors, atSceneTime, close };
}
