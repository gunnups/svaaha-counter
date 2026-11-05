// End-to-end "Learn my svaahaa": in real Chrome, learn from 6 marked rounds (Space after
// each svaahaa), finish, reset, and check the next 3 rounds are counted by what was learned.
// Run: npm run e2e:learn
import { svaha, mantra, SR, withRoom } from '../scenes.mjs';
import { openApp } from './harness.mjs';

const LEARN_ROUNDS = 6;
const COUNT_ROUNDS = 3;
const LEAD_S = 2;
const PAUSE_BEFORE_SVAHA_S = 0.15;
const PAUSE_AFTER_S = 3;
const MARK_DELAY_S = 0.15; // the person taps just after the svaahaa

const m = mantra.samples.length / SR;
const s = svaha.samples.length / SR;
const round = m + PAUSE_BEFORE_SVAHA_S + s + PAUSE_AFTER_S;
const svahaEnd = (k) => LEAD_S + k * round + m + PAUSE_BEFORE_SVAHA_S + s;
const parts = [LEAD_S];
for (let i = 0; i < LEARN_ROUNDS + COUNT_ROUNDS; i++) parts.push(mantra.samples, PAUSE_BEFORE_SVAHA_S, svaha.samples, PAUSE_AFTER_S);
const scene = withRoom(parts);

const app = await openApp(scene, SR, 'learn-scene.wav');
const { page, atSceneTime } = app;
let failed = false;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
};
try {
  await page.click('#open-settings');
  await page.check('input[name="showLog"]'); // testing tools: the log proves which listener counted
  await page.click('#learn');
  for (let k = 0; k < LEARN_ROUNDS; k++) {
    await atSceneTime(svahaEnd(k) + MARK_DELAY_S);
    await page.keyboard.press('Space');
  }
  check((await page.textContent('#status-text')).includes(`${LEARN_ROUNDS} marked`), `status shows ${LEARN_ROUNDS} marked`);
  await atSceneTime(svahaEnd(LEARN_ROUNDS - 1) + 1);
  await page.click('#finish-learning');
  await page.waitForFunction(() => /Learned \d+ svāhā/.test(document.getElementById('status-text').textContent), null, { timeout: 10000 });
  const learnedText = await page.textContent('#status-text');
  console.log('after finishing:', learnedText);
  check(learnedText.includes(`Learned ${LEARN_ROUNDS} svāhā`), 'learned every marked svāhā');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('svaha.learned')));
  check(stored?.templates?.length === LEARN_ROUNDS && stored.threshold > 0, 'saved on the device');

  await page.click('#reset');
  await page.click('#confirm-reset button[value="reset"]');
  await atSceneTime(scene.length / SR + 2.5);
  const count = Number(await page.textContent('#count'));
  const log = await page.$$eval('#log li', (lis) => lis.map((li) => li.textContent).reverse().slice(-6));
  console.log(log.join('\n'));
  check(count === COUNT_ROUNDS, `counted ${count} of the next ${COUNT_ROUNDS} rounds with what it learned`);
  const afterReset = log.filter((l) => l.includes('count')).slice(-COUNT_ROUNDS);
  check(afterReset.every((l) => l.includes('matched your svāhā')), 'counts after learning came from the learned svāhā');
} finally {
  if (app.errors.length) {
    failed = true;
    console.error('page errors:', app.errors);
  }
  await app.close();
}
console.log(failed ? 'E2E LEARN FAILED' : 'E2E LEARN PASSED');
process.exit(failed ? 1 : 0);
