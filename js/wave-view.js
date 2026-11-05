// Draws the scrolling 30-second sound picture under the count:
// grey = quiet, blue-grey = mantra (voice), saffron = counted svaahaa.

const FLOOR_DB = -60; // quieter than this draws as a flat line
const TOP_DB = -6;    // this loud fills the height
const GAP_PX = 1;     // space between bars (CSS px)

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 0..1 bar height from a peak sample value, on a dB scale (voices are often quiet). */
export function barHeight(peak) {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (TOP_DB - FLOOR_DB)));
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} startLabel  shows when this session began (Start or Reset was pressed)
 * @param {HTMLElement} endLabel    shows the current clock time
 */
export function createWaveView(canvas, startLabel, endLabel) {
  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(canvas);
  const colours = {
    quiet: css.getPropertyValue('--wave-quiet').trim() || '#3a342a',
    voice: css.getPropertyValue('--wave-voice').trim() || '#7f9bb5',
    svaha: css.getPropertyValue('--wave-svaha').trim() || '#f0832a',
  };
  let shownSecond = -1;

  function fitToScreen() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return dpr;
  }

  function labels(wallNowMs, sessionStartMs) {
    const second = Math.floor(wallNowMs / 1000);
    if (second === shownSecond) return;
    shownSecond = second;
    startLabel.textContent = clock(sessionStartMs);
    endLabel.textContent = clock(wallNowMs);
  }

  /**
   * @param {{columns: (nowMs: number) => {peak: number, kind: string}[], columnMs: number, windowMs: number}} history
   * @param {number} nowMs      time on the listening clock (ms since Start)
   * @param {number} wallNowMs  the same moment as a real clock time
   * @param {number} sessionStartMs  clock time when Start or Reset was pressed
   */
  function draw(history, nowMs, wallNowMs, sessionStartMs) {
    const dpr = fitToScreen();
    const { width, height } = canvas;
    const columns = history.columns(nowMs);
    const step = width / columns.length;
    const shift = ((nowMs % history.columnMs) / history.columnMs) * step; // smooth scroll between columns
    const barW = Math.max(1, step - GAP_PX * dpr);
    const mid = height / 2;
    ctx.clearRect(0, 0, width, height);
    columns.forEach((col, i) => {
      if (col.kind === 'empty') return;
      const half = Math.max(dpr, barHeight(col.peak) * (mid - dpr));
      ctx.fillStyle = colours[col.kind];
      ctx.fillRect(i * step - shift, mid - half, barW, half * 2);
    });
    labels(wallNowMs, sessionStartMs);
  }

  /** Show a new session start right away (e.g. after Reset while stopped). */
  function setSessionStart(sessionStartMs) {
    shownSecond = -1;
    startLabel.textContent = clock(sessionStartMs);
  }

  return { draw, setSessionStart };
}
