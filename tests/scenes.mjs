// Shared test audio: real speech (macOS `say`) placed into realistic scenes.
import { fileURLToPath } from 'node:url';
import { readWav, noise, pinkNoise, scene, mix, scale } from './helpers/wav.mjs';
import { createEngine, SETTINGS_DEFAULTS } from '../js/engine.js';

const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const svaha = readWav(dir + 'svaha.wav');
export const svaha2 = readWav(dir + 'svaha2.wav');
export const mantra = readWav(dir + 'mantra.wav');
export const talk = readWav(dir + 'talk.wav');
export const SR = svaha.sampleRate;

export const roomNoise = (seconds, amp = 0.003) => noise(Math.round(seconds * SR), amp, 7);
export { scene, mix, scale };

/** Run audio through a fresh engine in mic-sized chunks; return decisions. */
export function run(samples, settings = {}, learned = null) {
  const engine = createEngine(SR, { ...SETTINGS_DEFAULTS, ...settings }, learned);
  const out = [];
  for (let i = 0; i < samples.length; i += 2048) out.push(...engine.push(samples.subarray(i, i + 2048)));
  return out;
}

export const counts = (decisions) => decisions.filter((d) => d.type === 'count').length;

/** Background hum + scene. */
export function withRoom(parts, amp = 0.003) {
  const s = scene(SR, parts);
  return mix(s, roomNoise(s.length / SR + 1, amp), 1);
}

/** Realistic room: mostly low rumble, little hiss. */
export function withRealRoom(parts, amp = 0.003) {
  const s = scene(SR, parts);
  return mix(s, pinkNoise(Math.round((s.length / SR + 1) * SR), amp), 1);
}
