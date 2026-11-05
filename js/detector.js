// Finds "svaaahaa"-shaped sounds in a stream of feature frames:
//   a short hiss ("s")  ->  soon followed by a long held vowel ("vaaa-haa")
//   -> then the voice stops.
// Everything is measured relative to the room's own background level,
// so it adapts to a quiet house or a noisy hall.

export const DETECTOR_DEFAULTS = Object.freeze({
  marginDb: 12,          // how far above the room's background a voice must be
  sibRatioDb: -6,        // hiss/vowel ratio above this = "s"
  voicedRatioDb: -12,    // hiss/vowel ratio below this = vowel
  minSibMs: 30,          // shortest "s"
  maxSibToVowelMs: 350,  // "s" must lead into the vowel within this time
  minVowelMs: 600,       // shortest held "aaa...haa" that counts
  maxFlux: 4.1,          // how much the vowel's sound may wander (speech wanders more)
  maxVowelMs: 2800,      // longer than this is chanting/talking, not svaahaa
  maxGapMs: 170,         // short dips (the "h") allowed inside the vowel
  dropDb: 15,            // the vowel has ended once it falls this far below its own peak
                         // (so quieter chatter around a loud svaahaa doesn't stretch it)
  floorWindowMs: 6000,   // how much recent history defines "background"
  floorPercentile: 0.2,
  warmupMs: 600,
});

const PRE_ROLL_FRAMES = 40;
const FLUX_STEP = 3;
const SIB_SOFTER_DB = 9; // the "s" may be this much softer than the vowel threshold
// Rooms with hum/rumble (fans, AC, monitors) push every frame's hiss ratio down,
// so an "s" is also accepted when it stands out from this room's usual sound:
const SIB_REL_DB = 15;   // hiss ratio this far above the room's typical ratio
const SIB_RISE_DB = 6;   // and the hiss band this far above the room's own hiss

const SMOOTH_FRAMES = 2;

/** Moving average over n frames: removes flicker from several voices beating together. */
function smoothFrames(rows, n) {
  if (n <= 1) return rows;
  return rows.map((_, i) => {
    const from = Math.max(0, i - n + 1);
    const out = new Array(rows[i].length).fill(0);
    for (let j = from; j <= i; j++) for (let b = 0; b < out.length; b++) out[b] += rows[j][b] / (i - from + 1);
    return out;
  });
}

function centred(bands) {
  let mean = 0;
  for (const v of bands) mean += v;
  mean /= bands.length;
  return Array.from(bands, (v) => v - mean);
}

/**
 * How much the vowel's "sound colour" changes over ~30 ms steps, measured on
 * the steadiest stretch of `windowFrames` frames. A held "aaa" has a long
 * steady stretch (low value) even if someone talks over part of it; talking
 * keeps moving between vowels (high value).
 */
export function vowelFlux(frames, voicedRatioDb = DETECTOR_DEFAULTS.voicedRatioDb, windowFrames = Infinity) {
  const raw = frames.filter((f) => f.sibRatioDb < voicedRatioDb).map((f) => centred(f.bands));
  const v = smoothFrames(raw, SMOOTH_FRAMES);
  if (v.length <= FLUX_STEP) return Infinity;
  const steps = [];
  for (let i = FLUX_STEP; i < v.length; i++) {
    let s = 0;
    for (let b = 0; b < v[i].length; b++) s += (v[i][b] - v[i - FLUX_STEP][b]) ** 2;
    steps.push(Math.sqrt(s / v[i].length));
  }
  const w = Math.max(1, Math.min(steps.length, Math.floor(windowFrames)));
  let sum = steps.slice(0, w).reduce((a, x) => a + x, 0);
  let best = sum;
  for (let i = w; i < steps.length; i++) {
    sum += steps[i] - steps[i - w];
    best = Math.min(best, sum);
  }
  return best / w;
}

/** Running percentile of the recent history (e.g. the room's background level). */
function createPercentile(size, p) {
  const history = new Float32Array(size);
  let len = 0;
  let pos = 0;
  let value = -Infinity;
  return {
    add(x) {
      history[pos] = x;
      pos = (pos + 1) % size;
      len = Math.min(len + 1, size);
      if (len % 10 === 0 || len < 20) {
        const sorted = Array.from(history.subarray(0, len)).sort((a, b) => a - b);
        value = sorted[Math.floor(sorted.length * p)];
      }
    },
    get value() {
      return value;
    },
  };
}

/**
 * @param {number} hopMs  time between frames
 * @param {Partial<typeof DETECTOR_DEFAULTS>} [options]
 */
export function createDetector(hopMs, options = {}) {
  let opts = { ...DETECTOR_DEFAULTS, ...options };
  const floorSize = Math.max(50, Math.round(opts.floorWindowMs / hopMs));
  const history = new Float32Array(floorSize);
  let historyLen = 0;
  let historyPos = 0;
  let floorDb = -Infinity;
  const ratioTypical = createPercentile(floorSize, 0.5);
  const hissFloor = createPercentile(floorSize, DETECTOR_DEFAULTS.floorPercentile);

  let state = 'idle';
  let t = 0;
  let sibRunMs = 0;
  let lastSibT = 0;
  let eventStartT = 0;
  let vowelStartT = 0;
  let vowelMs = 0;
  let gapMs = 0;
  let peakDb = -Infinity;
  let voicedRunMs = 0;    // idle: held voice with no "s" before it (reported, never counted)
  let voicedGapMs = 0;
  let recent = [];       // pre-roll so the event includes the "s"
  let eventFrames = [];

  function updateFloor(db) {
    history[historyPos] = db;
    historyPos = (historyPos + 1) % floorSize;
    historyLen = Math.min(historyLen + 1, floorSize);
    if (historyLen % 10 === 0 || historyLen < 20) {
      const sorted = Array.from(history.subarray(0, historyLen)).sort((a, b) => a - b);
      floorDb = sorted[Math.floor(sorted.length * opts.floorPercentile)];
    }
  }

  function reset() {
    state = 'idle';
    sibRunMs = 0;
    eventFrames = [];
  }

  function finish() {
    const event = {
      startMs: eventStartT,
      endMs: t,
      vowelMs: Math.round(vowelMs),
      frames: eventFrames,
    };
    reset();
    if (event.vowelMs < opts.minVowelMs) return { ...event, rejected: 'too short' };
    const flux = vowelFlux(event.frames, opts.voicedRatioDb, opts.minVowelMs / hopMs);
    const scored = { ...event, flux: Math.round(flux * 10) / 10 };
    return flux <= opts.maxFlux ? scored : { ...scored, rejected: 'not a steady "aa"' };
  }

  /** In idle: notice a held voice that started without an "s" (helps explain misses). */
  function trackVoiceWithoutS(isVoiced) {
    if (isVoiced) {
      voicedRunMs += hopMs;
      voicedGapMs = 0;
      return null;
    }
    voicedGapMs += hopMs;
    if (voicedGapMs <= opts.maxGapMs) return null;
    const heldMs = voicedRunMs;
    voicedRunMs = 0;
    if (heldMs < opts.minVowelMs) return null;
    return { startMs: t - heldMs, endMs: t, vowelMs: Math.round(heldMs), frames: [], rejected: 'no "s" heard before the "aa"' };
  }

  /**
   * Process one frame. Returns an event object when a candidate ends, else null.
   * Events with a `rejected` field were heard but did not qualify.
   */
  function step(frame) {
    t += hopMs;
    updateFloor(frame.db);
    ratioTypical.add(frame.sibRatioDb);
    hissFloor.add(frame.sibDb ?? -Infinity);
    recent.push(frame);
    if (recent.length > PRE_ROLL_FRAMES) recent.shift();
    if (t < opts.warmupMs) return null;

    const above = frame.db - floorDb;
    const standsOut =
      frame.sibRatioDb - ratioTypical.value > SIB_REL_DB && (frame.sibDb ?? -Infinity) - hissFloor.value > SIB_RISE_DB;
    const isSib = (above > opts.marginDb - SIB_SOFTER_DB && frame.sibRatioDb > opts.sibRatioDb) || standsOut;
    const isVoiced = above > opts.marginDb && frame.sibRatioDb < opts.voicedRatioDb;

    switch (state) {
      case 'idle': {
        const noS = trackVoiceWithoutS(isVoiced);
        sibRunMs = isSib ? sibRunMs + hopMs : 0;
        if (sibRunMs >= opts.minSibMs) {
          state = 'sib';
          eventStartT = t - sibRunMs;
          lastSibT = t;
          const preFrames = Math.ceil(sibRunMs / hopMs);
          eventFrames = recent.slice(-preFrames);
          voicedRunMs = 0;
        }
        return noS;
      }
      case 'sib':
        eventFrames.push(frame);
        if (isVoiced) {
          state = 'vowel';
          vowelStartT = t;
          vowelMs = hopMs;
          gapMs = 0;
          peakDb = frame.db;
        } else if (isSib) {
          lastSibT = t;
        } else if (t - lastSibT > opts.maxSibToVowelMs) {
          reset();
        }
        return null;
      case 'vowel': {
        eventFrames.push(frame);
        const loudEnough = frame.db > peakDb - opts.dropDb;
        if (isVoiced && loudEnough) {
          peakDb = Math.max(peakDb, frame.db);
          vowelMs += hopMs;
          gapMs = 0;
        } else {
          gapMs += hopMs;
          if (gapMs > opts.maxGapMs) {
            eventFrames = eventFrames.slice(0, eventFrames.length - Math.round(gapMs / hopMs));
            return finish();
          }
        }
        if (t - vowelStartT > opts.maxVowelMs) {
          state = 'too-long';
          gapMs = 0;
          sibRunMs = 0;
          eventFrames = [];
          return { startMs: eventStartT, endMs: t, vowelMs: Math.round(vowelMs), frames: [], rejected: 'too long (chanting?)' };
        }
        return null;
      }
      case 'too-long':
        // Wait for this voice to pause before listening for a new "s" -
        // but in continuous chanting there may be no pause before svaahaa,
        // so a clear "s" also starts a new candidate.
        sibRunMs = isSib ? sibRunMs + hopMs : 0;
        if (sibRunMs >= opts.minSibMs) {
          state = 'sib';
          eventStartT = t - sibRunMs;
          lastSibT = t;
          eventFrames = recent.slice(-Math.ceil(sibRunMs / hopMs));
          return null;
        }
        gapMs = (isVoiced || isSib) && frame.db > peakDb - opts.dropDb ? 0 : gapMs + hopMs;
        if (gapMs > opts.maxGapMs) reset();
        return null;
      default:
        return null;
    }
  }

  return {
    step,
    setOptions(next) {
      opts = { ...opts, ...next };
    },
    get floorDb() {
      return floorDb;
    },
    get state() {
      return state;
    },
  };
}
