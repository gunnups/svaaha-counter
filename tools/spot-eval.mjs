// Experiment: whole-word svaahaa spotting learned from a marked recording.
//   templates  <- the 1.2 s before each mark in a *flow* clip (mantra + svaahaa, marked)
//   threshold  <- between those svaahaas (leave-one-out) and everything else
//                 (the flow clip away from marks + a "mantra alone" clip)
//   test       <- other clips: with marks they are scored, otherwise counts are listed
// Usage: node tools/spot-eval.mjs FLOW.wav MANTRA.wav [test clips...]
import { readWav } from '../tests/helpers/wav.mjs';
import { createFeatureExtractor } from '../js/features.js';
import { createPooler, createVectoriser, createSpotter, POOL, TEMPLATE_SECONDS } from '../js/spotter.js';
import { scoreAgainstMarks } from './score.mjs';
import { fileURLToPath } from 'node:url';

const MARK_LAG_S = 0.05;   // the mark (key click) comes just after the svaahaa
const NOT_NEAR_MARK_S = 2.5;
const TAIL_FRAMES = 100;   // keep listening ~2 s after a clip ends

/** Clip -> vectors exactly as the app would compute them. */
export function vectorsOf(path) {
  const { sampleRate, samples, marks } = readWav(path);
  const fx = createFeatureExtractor(sampleRate);
  const hop = (fx.hopMs * POOL) / 1000;
  const pool = createPooler();
  const vector = createVectoriser(hop * 1000);
  const frames = [];
  for (const f of fx.process(samples)) {
    const p = pool(f);
    if (p) frames.push({ vec: vector(p.bands) });
  }
  return { frames, hop, marks };
}

/** Templates: the sound just before each mark. */
export function templatesFrom(clip) {
  const at = (t) => Math.round(t / clip.hop);
  return clip.marks
    .map((m) => clip.frames.slice(at(m - MARK_LAG_S - TEMPLATE_SECONDS), at(m - MARK_LAG_S)).map((f) => f.vec))
    .filter((t) => t.length > 10);
}

/** The match cost after every frame of a clip. */
function costTrace(frames, templates) {
  const spot = createSpotter(templates, { threshold: -1 }, 1);
  return frames.map((f) => (spot.push(f.vec), spot.cost));
}

function detect(clip, templates, threshold) {
  const spot = createSpotter(templates, { threshold }, clip.hop * 1000);
  const silence = { vec: clip.frames[0].vec.map(() => 0) };
  const hits = [];
  for (const f of [...clip.frames, ...Array(TAIL_FRAMES).fill(silence)]) {
    const h = spot.push(f.vec);
    if (h) hits.push(h.atMs / 1000);
  }
  return hits;
}

const fmt = (xs) => xs.map((x) => x.toFixed(2)).join(' ');
const runDirectly = process.argv[1] === fileURLToPath(import.meta.url);
const [flowPath, mantraPath, ...testPaths] = runDirectly ? process.argv.slice(2) : [];
if (flowPath) {
  const flow = vectorsOf(flowPath);
  const mantra = vectorsOf(mantraPath);
  const templates = templatesFrom(flow);
  const at = (t) => Math.round(t / flow.hop);
  const positives = flow.marks.map((m, i) =>
    Math.min(...costTrace(flow.frames, templates.filter((_, j) => j !== i)).slice(at(m - 2), at(m + 0.3))),
  );
  const elsewhere = costTrace(flow.frames, templates).filter((_, k) =>
    flow.marks.every((m) => Math.abs(k * flow.hop - m) > NOT_NEAR_MARK_S),
  );
  const mantraBest = Math.min(...costTrace(mantra.frames, templates));
  const worstSvaha = Math.max(...positives);
  const bestOther = Math.min(mantraBest, ...elsewhere);
  const threshold = Number(process.env.THRESHOLD) || (worstSvaha + bestOther) / 2;
  console.log(`${templates.length} templates from ${flowPath.split('/').pop()}`);
  console.log(`svaahaa (leave-one-out) costs: ${fmt([...positives].sort((a, b) => a - b))}`);
  console.log(`closest non-svaahaa: ${bestOther.toFixed(2)} (mantra clip ${mantraBest.toFixed(2)}) -> threshold ${threshold.toFixed(2)}`);
  for (const path of [mantraPath, ...testPaths]) {
    const clip = path === mantraPath ? mantra : vectorsOf(path);
    const hits = detect(clip, templates, threshold);
    let line = `${path.split('/').pop()}: ${hits.length} counted [${fmt(hits)}]`;
    if (clip.marks.length) {
      const s = scoreAgainstMarks(hits, clip.marks);
      line += `  marks ${clip.marks.length}: hits ${s.hits}, missed ${s.missed.length}, extra ${s.extra.length}`;
    }
    console.log(line);
  }
}
