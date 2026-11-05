import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addRound, NO_PACE, createRoundTimer, formatAverage, formatTotal, paceLine } from '../js/pace.js';

/** Feed voice/quiet every 20 ms: [ms, isVoice] spans. Returns the time reached. */
function feed(timer, from, spans) {
  let t = from;
  for (const [ms, isVoice] of spans) for (const end = t + ms; t < end; t += 20) timer.voice(t, isVoice);
  return t;
}

test('the running average adds each round: (average x rounds + new) / (rounds + 1)', () => {
  let pace = NO_PACE;
  for (const ms of [6000, 5000, 7000]) pace = addRound(pace, ms);
  assert.deepEqual(pace, { avgMs: 6000, rounds: 3 });
  assert.deepEqual(NO_PACE, { avgMs: 0, rounds: 0 }); // not changed
});

test('a round is mantra + svaahaa only: pauses and breaks between rounds are left out', () => {
  const timer = createRoundTimer();
  timer.restart(0);
  // 2 s quiet, 5 s chanting (with a short breath), counted at its end
  let t = feed(timer, 0, [[2000, false], [2500, true], [200, false], [2300, true]]);
  assert.equal(timer.counted(t), 5000);
  // a 40 s break, then a 6 s round
  t = feed(timer, t, [[40000, false], [6000, true]]);
  assert.equal(timer.counted(t), 6000);
  // the next mantra starts straight away (0.4 s pause), 5.5 s round
  t = feed(timer, t, [[400, false], [5500, true]]);
  assert.equal(timer.counted(t), 5500);
});

test('no voice since the last count (a double count): nothing measured', () => {
  const timer = createRoundTimer();
  timer.restart(0);
  const t = feed(timer, 0, [[1000, false], [5000, true], [500, false]]);
  assert.equal(timer.counted(t), 5500);
  assert.equal(timer.counted(t + 3000), null);
});

test('after Reset or learning, the round starts at the next voice', () => {
  const timer = createRoundTimer();
  let t = feed(timer, 0, [[3000, true], [1000, false]]); // learning rounds, not measured
  timer.restart(t);
  t = feed(timer, t, [[500, false], [6000, true]]);
  assert.equal(timer.counted(t), 6000);
});

test('formatting: average in seconds, total in minutes and seconds', () => {
  assert.equal(formatAverage({ avgMs: 5940, rounds: 10 }), '5.9 s');
  assert.equal(formatAverage(NO_PACE), '–');
  assert.equal(formatTotal(0), '0 min 00 s');
  assert.equal(formatTotal(724999), '12 min 04 s');
  assert.equal(formatTotal(3723000), '1 h 02 min');
  assert.equal(paceLine({ avgMs: 5900, rounds: 3 }, 59000), 'Average 5.9 s per svāhā · Total 0 min 59 s');
});
