// Screen wiring: buttons, settings, teach mode, keep-awake, and the count itself.

import { startMic } from './audio.js';
import { createEngine } from './engine.js';
import * as store from './store.js';
import { createRecorder, MAX_SECONDS } from './recorder.js';

const SAVE_LABEL = `Save last ${MAX_SECONDS / 60} min of sound`;

const BACKGROUND_TEACH_MS = 20000;
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
  teachSvaha: $('teach-svaha'),
  teachBackground: $('teach-background'),
  teachStatus: $('teach-status'),
  saveSound: $('save-sound'),
};

let count = store.loadCount();
let settings = store.loadSettings();
let taught = store.loadTaught();
let mic = null;
let engine = null;
let wakeLock = null;
let backgroundTimer = null;
let recorder = null;
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
  const taughtNote = settings.useTaught && taught.positives.length ? ` · taught ${taught.positives.length}` : '';
  setStatus('listening', `Listening${taughtNote}`);
}

function addLog(decision) {
  if (!settings.showLog) return;
  const li = document.createElement('li');
  li.dataset.type = decision.type;
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const secs = (decision.event.vowelMs / 1000).toFixed(1);
  const flux = decision.event.flux !== undefined ? ` steady ${decision.event.flux}` : '';
  li.textContent = `${time}  ${decision.type}  ${secs}s${flux}${decision.reason ? `  ${decision.reason}` : ''}`;
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
  if (decision.type === 'count') setCount(count + 1, true);
  if (decision.type === 'ignored') {
    ui.teachStatus.textContent = `Heard a sound but did not keep it: ${decision.reason ?? 'unclear'}. Learned so far: ${
      engine?.mode === 'teach-svaha' ? taught.positives.length : taught.negatives.length
    }.`;
  }
  if (decision.type === 'taught-svaha') {
    taught = { ...taught, positives: [...taught.positives, decision.seq] };
    saveTaught(`Heard svāhā ${taught.positives.length}. Say it again, or tap the button to finish.`);
  }
  if (decision.type === 'taught-background') {
    taught = { ...taught, negatives: [...taught.negatives, decision.seq] };
    saveTaught(`Recording background… ${taught.negatives.length} look-alike sounds noted.`);
  }
}

function saveTaught(message) {
  store.saveTaught(taught);
  engine?.setTaught(taught);
  ui.teachStatus.textContent = message;
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
  engine = createEngine(mic.sampleRate, settings, taught);
  recorder = createRecorder(mic.sampleRate);
  await keepScreenOn();
  ui.listen.textContent = 'Stop';
  ui.listen.setAttribute('aria-pressed', 'true');
  listeningStatus();
  if (!mic.running) onAudioState('suspended'); // browser kept audio paused: offer Resume
  requestAnimationFrame(drawMeter);
  return true;
}

function stopListening() {
  finishTeaching();
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

/* ---------- teach mode ---------- */

function finishTeaching() {
  clearTimeout(backgroundTimer);
  backgroundTimer = null;
  ui.teachSvaha.setAttribute('aria-pressed', 'false');
  ui.teachBackground.setAttribute('aria-pressed', 'false');
  ui.teachSvaha.textContent = 'Teach svāhā';
  if (engine && engine.mode !== 'count') {
    engine.setMode('count');
    ui.teachStatus.textContent = `Taught ${taught.positives.length} svāhā and ${taught.negatives.length} background sounds.`;
    listeningStatus();
  }
}

async function beginTeaching(mode) {
  if (!(await startListening())) return;
  finishTeaching();
  // A new teaching session replaces the old examples (e.g. re-teach in the hall).
  taught = mode === 'teach-svaha' ? { ...taught, positives: [] } : { ...taught, negatives: [] };
  engine.setTaught(taught);
  engine.setMode(mode);
  setStatus('teaching', mode === 'teach-svaha' ? 'Teaching: say svāhā…' : 'Teaching: recording background…');
}

ui.teachSvaha.addEventListener('click', async () => {
  if (engine?.mode === 'teach-svaha') return finishTeaching();
  await beginTeaching('teach-svaha');
  ui.teachSvaha.setAttribute('aria-pressed', 'true');
  ui.teachSvaha.textContent = 'Finish';
  ui.teachStatus.textContent = 'Say “svāhā” now, a few seconds apart.';
});

ui.teachBackground.addEventListener('click', async () => {
  if (engine?.mode === 'teach-background') return finishTeaching();
  await beginTeaching('teach-background');
  ui.teachBackground.setAttribute('aria-pressed', 'true');
  ui.teachStatus.textContent = 'Chant the mantra / talk normally, without svāhā, for 20 seconds.';
  backgroundTimer = setTimeout(finishTeaching, BACKGROUND_TEACH_MS);
});

$('clear-taught').addEventListener('click', () => {
  taught = { positives: [], negatives: [] };
  saveTaught('Forgot all taught sounds.');
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

/* ---------- buttons ---------- */

$('plus').addEventListener('click', () => setCount(count + 1, true));
$('minus').addEventListener('click', () => setCount(count - 1));

$('reset').addEventListener('click', () => {
  ui.resetCount.textContent = String(count);
  ui.resetDialog.showModal();
});

ui.resetDialog.addEventListener('close', () => {
  if (ui.resetDialog.returnValue === 'reset') setCount(0);
});

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
    useTaught: f.namedItem('useTaught').checked,
    showLog: f.namedItem('showLog').checked,
  });
}

function applySettings() {
  ui.log.hidden = !settings.showLog;
  ui.saveSound.hidden = !settings.showLog;
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
  ui.teachStatus.textContent = `Taught: ${taught.positives.length} svāhā, ${taught.negatives.length} background.`;
  ui.settingsDialog.showModal();
});

ui.settingsDialog.addEventListener('close', finishTeaching);

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
