// Saves the count, settings and taught examples on the device (survives refresh,
// phone lock, and closing the app). Everything read back is validated.

import { SETTINGS_DEFAULTS } from './engine.js';
import { SEQ_LEN } from './templates.js';
import { NUM_BANDS } from './features.js';

const KEYS = { count: 'svaha.count', settings: 'svaha.settings.v2', oldSettings: 'svaha.settings', taught: 'svaha.taught' };
const MAX_EXAMPLES = 20;

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or blocked (private mode) - the app keeps working
  }
}

export function loadCount() {
  const n = Number(read(KEYS.count));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export const saveCount = (n) => write(KEYS.count, n);

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const d = SETTINGS_DEFAULTS;
  return {
    sensitivity: clamp(s.sensitivity, 1, 10, d.sensitivity),
    minVowelMs: clamp(s.minVowelMs, 250, 2000, d.minVowelMs),
    gapSeconds: clamp(s.gapSeconds, 0.5, 30, d.gapSeconds),
    strictness: clamp(s.strictness, 0.7, 1.3, d.strictness),
    useTaught: typeof s.useTaught === 'boolean' ? s.useTaught : d.useTaught,
    target: Math.round(clamp(s.target, 1, 100000, d.target)),
    showLog: typeof s.showLog === 'boolean' ? s.showLog : d.showLog,
  };
}

export function loadSettings() {
  const current = read(KEYS.settings);
  if (current) return sanitizeSettings(current);
  // Detection defaults changed in v2: keep only the personal choices from v1.
  const old = read(KEYS.oldSettings) || {};
  return sanitizeSettings({ target: old.target, useTaught: old.useTaught });
}
export const saveSettings = (s) => write(KEYS.settings, sanitizeSettings(s));

const isSeq = (seq) =>
  Array.isArray(seq) &&
  seq.length === SEQ_LEN &&
  seq.every((row) => Array.isArray(row) && row.length === NUM_BANDS && row.every(Number.isFinite));

export function loadTaught() {
  const raw = read(KEYS.taught) || {};
  const pick = (list) => (Array.isArray(list) ? list.filter(isSeq).slice(-MAX_EXAMPLES) : []);
  return { positives: pick(raw.positives), negatives: pick(raw.negatives) };
}

export function saveTaught(taught) {
  return write(KEYS.taught, {
    positives: taught.positives.slice(-MAX_EXAMPLES),
    negatives: taught.negatives.slice(-MAX_EXAMPLES),
  });
}
