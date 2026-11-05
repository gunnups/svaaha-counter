// Turns raw microphone samples into small per-frame summaries.
// Pure JS (no browser APIs) so the same code runs in Node tests.

export const NUM_BANDS = 16;
const VOICED_BAND = [100, 3000];   // where "aa" vowel energy lives
const SIB_BAND = [3500, 9000];     // where the "s" hiss lives
const BANDS_LOW_HZ = 100;
const BANDS_HIGH_HZ = 8000;
const EPS = 1e-12;

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function makeFft(size) {
  const levels = Math.log2(size);
  const rev = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = Math.sin((2 * Math.PI * i) / size);
  }
  // In-place iterative radix-2 FFT on (re, im).
  return function fft(re, im) {
    for (let i = 0; i < size; i++) {
      const j = rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1;
      const step = size / len;
      for (let i = 0; i < size; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = -sin[k * step];
          const a = i + k;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  };
}

function bandEdges(sampleRate) {
  const hi = Math.min(BANDS_HIGH_HZ, sampleRate * 0.47);
  const ratio = Math.pow(hi / BANDS_LOW_HZ, 1 / NUM_BANDS);
  return Array.from({ length: NUM_BANDS + 1 }, (_, i) => BANDS_LOW_HZ * Math.pow(ratio, i));
}

/**
 * Create a streaming feature extractor.
 * Each frame: { db, sibRatioDb, bands } where
 *   db          overall loudness (dB, arbitrary reference)
 *   sibRatioDb  hiss energy relative to vowel energy (high = "s", low = "aa")
 *   sibDb       hiss-band loudness alone (dB)
 *   bands       NUM_BANDS log-energies describing the sound's colour
 */
export function createFeatureExtractor(sampleRate) {
  const frameSize = nextPow2(Math.round(sampleRate * 0.021));
  const hopSize = frameSize / 2;
  const hopMs = (hopSize / sampleRate) * 1000;
  const fft = makeFft(frameSize);
  const hann = Float64Array.from({ length: frameSize }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize));
  const binHz = sampleRate / frameSize;
  const bin = (hz) => Math.min(frameSize / 2, Math.max(1, Math.round(hz / binHz)));
  const edges = bandEdges(sampleRate).map(bin);
  const voiced = VOICED_BAND.map(bin);
  const sibHigh = Math.min(SIB_BAND[1], sampleRate * 0.47);
  const sib = [bin(SIB_BAND[0]), bin(sibHigh)];

  const pending = new Float32Array(frameSize * 4);
  let pendingLen = 0;
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);
  const power = new Float64Array(frameSize / 2 + 1);

  const sumRange = (lo, hi) => {
    let s = 0;
    for (let k = lo; k < hi; k++) s += power[k];
    return s;
  };

  function analyse(offset) {
    for (let i = 0; i < frameSize; i++) {
      re[i] = pending[offset + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= frameSize / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    const voicedE = sumRange(voiced[0], voiced[1]);
    const sibE = sumRange(sib[0], sib[1]);
    const bands = new Float32Array(NUM_BANDS);
    for (let b = 0; b < NUM_BANDS; b++) {
      const hi = Math.max(edges[b + 1], edges[b] + 1);
      bands[b] = 10 * Math.log10(sumRange(edges[b], hi) + EPS);
    }
    return {
      db: 10 * Math.log10(voicedE + sibE + EPS),
      sibRatioDb: 10 * Math.log10((sibE + EPS) / (voicedE + EPS)),
      sibDb: 10 * Math.log10(sibE + EPS),
      bands,
    };
  }

  /** Feed any number of samples; returns the completed frames. */
  function process(samples) {
    const frames = [];
    let i = 0;
    while (i < samples.length) {
      const take = Math.min(samples.length - i, pending.length - pendingLen);
      pending.set(samples.subarray(i, i + take), pendingLen);
      pendingLen += take;
      i += take;
      let offset = 0;
      while (pendingLen - offset >= frameSize) {
        frames.push(analyse(offset));
        offset += hopSize;
      }
      pending.copyWithin(0, offset, pendingLen);
      pendingLen -= offset;
    }
    return frames;
  }

  return { frameSize, hopSize, hopMs, process };
}
