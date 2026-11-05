// Draws the scrolling 30-second sound picture under the count:
// grey = quiet, blue-grey = mantra (voice), saffron = counted svaahaa, white tick = person's mark.

const MIN_RANGE_DB = 24; // the picture spans at least this many dB, quiet room to loud voice
const GAP_PX = 1;     // space between bars (CSS px)

const pad = (n) => String(n).padStart(2, '0');
const clock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const toDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

/**
 * Scale for the bars from what is on screen: the quiet room sits at the bottom and the
 * loudest moment at the top, so syllables and the svaahaa stand out instead of a flat block.
 * @returns {(level: number) => number} level -> 0..1 height
 */
export function scaleFor(levels) {
  const dbs = levels.filter((v) => v > 0).map(toDb).sort((a, b) => a - b);
  if (dbs.length === 0) return () => 0;
  const low = dbs[Math.floor(dbs.length * 0.1)];
  const high = Math.max(dbs[dbs.length - 1], low + MIN_RANGE_DB);
  return (level) => Math.min(1, Math.max(0, (toDb(level) - low) / (high - low)));
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
    mark: css.getPropertyValue('--wave-mark').trim() || '#f4ead6',
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
    const scale = scaleFor(columns.filter((c) => c.kind !== 'empty').map((c) => c.peak));
    ctx.clearRect(0, 0, width, height);
    columns.forEach((col, i) => {
      const x = i * step - shift;
      if (col.kind !== 'empty') {
        const half = Math.max(dpr, scale(col.peak) * (mid - dpr));
        ctx.fillStyle = colours[col.kind];
        ctx.fillRect(x, mid - half, barW, half * 2);
      }
      if (col.marked) {
        ctx.fillStyle = colours.mark;
        ctx.fillRect(x, 0, Math.max(1, 2 * dpr), height);
      }
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
