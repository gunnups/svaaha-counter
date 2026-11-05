// Screen wiring: buttons, settings, "Learn my svāhā", keep-awake, and the count itself.

import { startMic } from './audio.js';
import { createEngine, marginFor } from './engine.js';
import { createWaveHistory } from './wave.js';
import { createWaveView } from './wave-view.js';
import * as store from './store.js';
import { createRecorder, MAX_SECONDS } from './recorder.js';

const SAVE_LABEL = `Save last ${MAX_SECONDS / 60} min of sound`;
const MARK_LABEL = 'Mark svāhā';

const MIC_DENIED_HELP =
  'Microphone is blocked for this page. Chrome: click the icon left of the address → Microphone → Allow, then reload. ' +
  'iPhone: Settings → Apps → Safari → Microphone → Allow (or aA in the address bar → Website Settings).';
const LOG_LIMIT = 40;
const HEARD_NOTE_MS = 4000;

const $ = (id) => document.getElementById(id);
const ui = {
  count: $('count'),
  target: $('target'),
  progress: $('progress-fill'),
  meter: $('meter-fill'),
  status: $('status'),
  statusText: $('status-text'),
  listen: $('listen'),
  log: $('log'),
  resetDialog: $('confirm-reset'),
  resetCount: $('reset-count'),
  settingsDialog: $('settings'),
  form: $('settings-form'),
  learn: $('learn'),
  learnAdd: $('learn-add'),
  learnStatus: $('learn-status'),
  finishLearning: $('finish-learning'),
  saveSound: $('save-sound'),
  markSvaha: $('mark-svaha'),
};

const waveView = createWaveView($('wave'), $('wave-start'), $('wave-end'));

let count = store.loadCount();
let settings = store.loadSettings();
let learned = store.loadLearned();
let mic = null;
let engine = null;
let wakeLock = null;
let recorder = null;
let wave = null;           // last 30 s of sound for the scrolling picture
let audioMs = 0;          // listening clock: ms of sound received since Start
let chunkAt = 0;          // performance.now() when the last sound arrived
let wallStart = 0;        // Date.now() at Start, to show real clock times
let sessionStart = 0;     // Date.now() when Start or Reset was last pressed (left label)
const MAX_SMOOTH_MS = 120;
const WAVE_WINDOW_MS = 15000; // the picture shows the last 15 s
const WAVE_COLUMN_MS = 50;
const WAVE_BLOCK = 512;       // samples per loudness reading (~10 ms)  // scroll smoothly between sound chunks, but never run ahead
let heardTimer = null;

/* ---------- count ---------- */

function setCount(next, bump = false) {
  count = Math.max(0, next);
  store.saveCount(count);
  renderCount(bump);
}

function renderCount(bump = false) {
  ui.count.textContent = String(count);
  ui.target.textContent = String(settings.target);
  ui.progress.style.transform = `scaleX(${Math.min(1, count / settings.target)})`;
  if (bump) {
    ui.count.classList.remove('bump');
    void ui.count.offsetWidth; // restart the animation
    ui.count.classList.add('bump');
  }
}

/* ---------- status + log ---------- */

function setStatus(state, text) {
  ui.status.dataset.state = state;
  ui.statusText.textContent = text;
}

function listeningStatus() {
  const how = engine?.usingLearned ? ` · knows your svāhā (${learned.templates.length})` : '';
  setStatus('listening', `Listening${how}`);
}

const LOG_MIN_MS = 300; // tiny fragments mean nothing to a person; don't list them

function addLog(decision) {
  if (!settings.showLog) return;
  if (decision.type !== 'count' && decision.event.vowelMs < LOG_MIN_MS) return;
  const li = document.createElement('li');
  li.dataset.type = decision.type;
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const { event } = decision;
  const detail = event.match !== undefined
    ? `matched your svāhā (${event.match})` // learned matcher: lower = closer
    : `${(event.vowelMs / 1000).toFixed(1)}s${event.flux !== undefined ? ` steady ${event.flux}` : ''}`;
  li.textContent = `${time}  ${decision.type}  ${detail}${decision.reason ? `  ${decision.reason}` : ''}`;
  ui.log.prepend(li);
  while (ui.log.children.length > LOG_LIMIT) ui.log.lastElementChild.remove();
}

/* ---------- listening ---------- */

const HEARD_TEXT = {
  count: () => 'Counted svāhā ✓',
  rejected: (d) => `Heard ${(d.event.vowelMs / 1000).toFixed(1)} s · not counted: ${d.reason}`,
};

/** Show briefly what was just heard, so it is clear why something did or didn't count. */
function noteHeard(decision) {
  const text = HEARD_TEXT[decision.type];
  if (!text || !settings.showLog || engine?.mode !== 'count') return;
  ui.statusText.textContent = text(decision);
  clearTimeout(heardTimer);
  heardTimer = setTimeout(() => engine && engine.mode === 'count' && listeningStatus(), HEARD_NOTE_MS);
}

function handle(decision) {
  addLog(decision);
  noteHeard(decision);
  if (decision.type === 'count') {
    setCount(count + 1, true);
    wave?.markSvaha(decision.event.startMs, decision.event.endMs);
  }
}

function onAudioState(state) {
  if (state === 'running') {
    if (engine?.mode === 'count') listeningStatus();
  } else if (mic) {
    setStatus('error', 'Microphone is paused. Tap Resume.');
    ui.listen.textContent = 'Resume';
  }
}

async function keepScreenOn() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null; // not supported or refused; set Auto-Lock to Never instead
  }
}

function onSamples(samples) {
  if (!engine) return;
  recorder?.add(samples);
  engine.push(samples).forEach(handle);
  const isVoice = engine.level * 30 > marginFor(settings.sensitivity);
  for (let i = 0; i < samples.length; i += WAVE_BLOCK) {
    const block = samples.subarray(i, i + WAVE_BLOCK);
    let energy = 0;
    for (const v of block) energy += v * v;
    wave.add(audioMs + (i / mic.sampleRate) * 1000, Math.sqrt(energy / block.length), isVoice);
  }
  audioMs += (samples.length / mic.sampleRate) * 1000;
  chunkAt = performance.now();
}

async function startListening() {
  if (mic) return true;
  setStatus('idle', 'Starting microphone…');
  try {
    mic = await startMic(onSamples, onAudioState);
  } catch (err) {
    const denied = err && err.name === 'NotAllowedError';
    setStatus('error', denied ? MIC_DENIED_HELP : String(err.message || err));
    return false;
  }
  engine = createEngine(mic.sampleRate, settings, learned);
  recorder = createRecorder(mic.sampleRate);
  wave = createWaveHistory({ windowMs: WAVE_WINDOW_MS, columnMs: WAVE_COLUMN_MS });
  audioMs = 0;
  chunkAt = performance.now();
  wallStart = Date.now();
  startSession(wallStart);
  await keepScreenOn();
  ui.listen.textContent = 'Stop';
  ui.listen.setAttribute('aria-pressed', 'true');
  listeningStatus();
  if (!mic.running) onAudioState('suspended'); // browser kept audio paused: offer Resume
  requestAnimationFrame(drawMeter);
  return true;
}

function stopListening() {
  cancelLearning();
  mic?.stop();
  mic = null;
  engine = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  ui.listen.textContent = 'Start';
  ui.listen.setAttribute('aria-pressed', 'false');
  ui.meter.style.transform = 'scaleX(0)';
  setStatus('idle', 'Stopped · tap Start to listen');
}

function drawMeter() {
  if (!engine) return;
  ui.meter.style.transform = `scaleX(${engine.level.toFixed(3)})`;
  const nowMs = audioMs + Math.min(MAX_SMOOTH_MS, performance.now() - chunkAt);
  waveView.draw(wave, nowMs, wallStart + nowMs, sessionStart);
  requestAnimationFrame(drawMeter);
}

ui.listen.addEventListener('click', async () => {
  if (mic && ui.listen.textContent === 'Resume') {
    await mic.resume();
    ui.listen.textContent = 'Stop';
    if (mic.running) listeningStatus();
    return;
  }
  if (mic) stopListening();
  else await startListening();
});

/* ---------- "Learn my svāhā" ---------- */

const LEARN_LABEL = 'Start learning';

function learnedSummary() {
  if (!learned) return 'Not learned yet: counting with the basic "s" + "aa" listener.';
  return `Knows ${learned.templates.length} of your svāhā (${learned.sessions} session${learned.sessions > 1 ? 's' : ''}).`;
}

function learningStatus() {
  const n = engine?.marksSinceLearning ?? 0;
  setStatus('teaching', `Learning · chant, tap Mark after each svāhā · ${n} marked`);
}

async function startLearning() {
  if (!(await startListening())) return;
  engine.startLearning();
  ui.settingsDialog.close();
  ui.finishLearning.hidden = false;
  ui.markSvaha.hidden = false;
  learningStatus();
}

function cancelLearning() {
  engine?.cancelLearning();
  ui.finishLearning.hidden = true;
  applySettings();
}

function finishLearning() {
  if (!engine?.learning) return;
  setStatus('teaching', 'Learning your svāhā…');
  ui.finishLearning.hidden = true;
  // let the status paint before the (short) number crunching
  setTimeout(() => {
    const earlier = ui.learnAdd.checked && learned ? learned.templates : [];
    const result = engine.finishLearning(earlier);
    applySettings();
    if (result.error) {
      setStatus('error', `${result.error} Try again: Settings → Start learning.`);
      return;
    }
    learned = { templates: result.templates, threshold: result.threshold, sessions: (earlier.length ? learned.sessions : 0) + 1 };
    store.saveLearned(learned);
    engine.setLearned(learned);
    const fresh = result.templates.length - earlier.length;
    const verdict = result.quality.separated ? 'clearly different from the mantra ✓' : 'close to parts of the mantra — consider learning again';
    setStatus('listening', `Learned ${fresh} svāhā · ${verdict}`);
  }, 50);
}

ui.learn.addEventListener('click', startLearning);
ui.finishLearning.addEventListener('click', finishLearning);

$('forget-learned').addEventListener('click', () => {
  learned = null;
  store.forgetLearned();
  engine?.setLearned(null);
  ui.learnStatus.textContent = learnedSummary();
});

/* ---------- saving the last minutes of sound ---------- */

function saveRecentSound() {
  if (!recorder || recorder.seconds() < 1) {
    ui.saveSound.textContent = 'Tap Start first';
    setTimeout(() => (ui.saveSound.textContent = SAVE_LABEL), 2500);
    return;
  }
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(recorder.toWav());
  link.download = `svaha-test-${stamp}.wav`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  ui.saveSound.textContent = `Saved last ${Math.round(recorder.seconds())} s ✓`;
  setTimeout(() => (ui.saveSound.textContent = SAVE_LABEL), 4000);
}

ui.saveSound.addEventListener('click', saveRecentSound);

/* ---------- marking "I said svāhā here" (for checking and tuning) ---------- */

function markSvaha() {
  if (!recorder || !wave) return;
  recorder.mark();
  wave.mark(audioMs);
  engine?.mark();
  if (engine?.learning) learningStatus();
  ui.markSvaha.textContent = `Marked ✓ (${recorder.marks().length})`;
  clearTimeout(markLabelTimer);
  markLabelTimer = setTimeout(() => (ui.markSvaha.textContent = MARK_LABEL), 1200);
}

let markLabelTimer = null;
ui.markSvaha.addEventListener('click', markSvaha);
// Space = mark, everywhere on the main screen. (A focused button would otherwise take
// Space as a click - e.g. Start/Stop - so the key is always claimed here.)
const spaceIsMark = (e) => e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !document.querySelector('dialog[open]');
document.addEventListener('keydown', (e) => {
  if (!spaceIsMark(e)) return;
  e.preventDefault();
  if (!e.repeat) markSvaha();
});
document.addEventListener('keyup', (e) => {
  if (spaceIsMark(e)) e.preventDefault();
});

/* ---------- buttons ---------- */

$('plus').addEventListener('click', () => setCount(count + 1, true));
$('minus').addEventListener('click', () => setCount(count - 1));

$('reset').addEventListener('click', () => {
  ui.resetCount.textContent = String(count);
  ui.resetDialog.showModal();
});

ui.resetDialog.addEventListener('close', () => {
  if (ui.resetDialog.returnValue !== 'reset') return;
  setCount(0);
  startSession(Date.now());
});

function startSession(atMs) {
  sessionStart = atMs;
  waveView.setSessionStart(atMs);
}

/* ---------- settings ---------- */

const formatters = {
  sensitivity: (v) => String(v),
  minVowelMs: (v) => (v / 1000).toFixed(2),
  gapSeconds: (v) => Number(v).toFixed(1),
  strictness: (v) => Number(v).toFixed(1),
};

function fillForm() {
  for (const [name, value] of Object.entries(settings)) {
    const input = ui.form.elements.namedItem(name);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value;
    else input.value = String(value);
  }
  renderOutputs();
}

function renderOutputs() {
  for (const out of ui.form.querySelectorAll('output[data-for]')) {
    out.textContent = formatters[out.dataset.for](settings[out.dataset.for]);
  }
}

function readForm() {
  const f = ui.form.elements;
  return store.sanitizeSettings({
    target: f.namedItem('target').value,
    sensitivity: f.namedItem('sensitivity').value,
    minVowelMs: f.namedItem('minVowelMs').value,
    gapSeconds: f.namedItem('gapSeconds').value,
    strictness: f.namedItem('strictness').value,
    useLearned: f.namedItem('useLearned').checked,
    showLog: f.namedItem('showLog').checked,
  });
}

function applySettings() {
  ui.log.hidden = !settings.showLog;
  ui.saveSound.hidden = !settings.showLog;
  ui.markSvaha.hidden = !settings.showLog && !engine?.learning;
  engine?.setSettings(settings);
  renderCount();
}

ui.form.addEventListener('input', () => {
  settings = readForm();
  store.saveSettings(settings);
  renderOutputs();
  applySettings();
});

$('open-settings').addEventListener('click', () => {
  fillForm();
  ui.learnStatus.textContent = learnedSummary();
  ui.settingsDialog.showModal();
});


/* ---------- lifecycle ---------- */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mic && (!wakeLock || wakeLock.released)) keepScreenOn();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    /* offline support unavailable; app still works online */
  });
}

applySettings();
renderCount();
ui.saveSound.textContent = SAVE_LABEL;
