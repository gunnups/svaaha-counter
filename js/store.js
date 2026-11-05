// Saves the count, settings and learned svaahaa examples on the device (survives refresh,
// phone lock, and closing the app). Everything read back is validated.

import { SETTINGS_DEFAULTS } from './engine.js';
import { NUM_BANDS } from './features.js';

const KEYS = { count: 'svaha.count', settings: 'svaha.settings.v2', oldSettings: 'svaha.settings', learned: 'svaha.learned' };
const MAX_TEMPLATES = 60;    // keep the most recent examples (e.g. solo + a couple of group sessions)
const ROUND = 100;          // store vector values to 2 decimals (keeps storage small)

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
    useLearned: typeof s.useLearned === 'boolean' ? s.useLearned : d.useLearned,
    target: Math.round(clamp(s.target, 1, 100000, d.target)),
    showLog: typeof s.showLog === 'boolean' ? s.showLog : d.showLog,
  };
}

export function loadSettings() {
  const current = read(KEYS.settings);
  if (current) return sanitizeSettings(current);
  // Detection defaults changed in v2: keep only the personal choices from v1.
  const old = read(KEYS.oldSettings) || {};
  return sanitizeSettings({ target: old.target });
}
export const saveSettings = (s) => write(KEYS.settings, sanitizeSettings(s));

const isTemplate = (tpl) =>
  Array.isArray(tpl) &&
  tpl.length > 10 &&
  tpl.every((row) => Array.isArray(row) && row.length === NUM_BANDS && row.every(Number.isFinite));

/** @returns {{templates: Float32Array[][], threshold: number, sessions: number} | null} */
export function loadLearned() {
  const raw = read(KEYS.learned);
  if (!raw || !Array.isArray(raw.templates) || !(raw.threshold > 0)) return null;
  const templates = raw.templates.filter(isTemplate).slice(-MAX_TEMPLATES).map((t) => t.map((row) => Float32Array.from(row)));
  if (!templates.length) return null;
  return { templates, threshold: raw.threshold, sessions: Number.isInteger(raw.sessions) ? raw.sessions : 1 };
}

export function saveLearned(learned) {
  if (!learned) return write(KEYS.learned, null);
  return write(KEYS.learned, {
    templates: learned.templates.slice(-MAX_TEMPLATES).map((t) => t.map((row) => Array.from(row, (x) => Math.round(x * ROUND) / ROUND))),
    threshold: learned.threshold,
    sessions: learned.sessions,
  });
}

export function forgetLearned() {
  try {
    localStorage.removeItem(KEYS.learned);
  } catch {
    /* storage blocked: nothing saved anyway */
  }
}
