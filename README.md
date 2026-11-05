# Svāhā Counter

Counts svāhā offerings during a homam by listening through the phone or tablet microphone.
Plain web page (no server code, no internet needed once opened); works in Safari on iPhone
and Chrome / Samsung Internet on the Galaxy Tab. Counting happens entirely on the device.

## The sound picture

Under the count, the last 15 s of sound scroll past. Left: when Start or Reset was pressed; right: the time now.
grey = quiet, blue-grey = voice / mantra, saffron = a counted svāhā (painted ~1 s after it ends,
once confirmed), white tick = your mark. While testing, tap **Mark svāhā** (or press **Space** on a
computer) right after each svāhā; the marks are saved inside the sound file and
`node tools/analyze.mjs clip.wav` then reports hits, misses and extra counts.

## How it recognises svāhā

1. A short hiss (“s”) followed quickly by a long, **steady** “aaa…haa” vowel, at least 0.6 s.
2. Ordinary talk and the mantra keep changing vowels, so they fail the steadiness check.
3. Each heard svāhā waits ~0.9 s before counting; if another svāhā-like sound follows
   (“…prachodayā**t** svāhā”) the later one wins, so each offering counts once.
4. Two counts can't be closer than the “gap between counts” (3 s default).
5. Optional **teach mode** compares sounds with your own recorded svāhās.

Background level is measured continuously, so it adapts to a quiet home or a busy hall.

## Rehearsal checklist (with family, ~10 offerings)

1. Open the app and tap **Start**. *Show what it hears* is on by default: the status line and the
   log under the counter say what each sound was and why it did or didn't count
   (e.g. *no "s" heard before the "aa"*, *too short*, *not a steady "aa"*).
   If svāhās are being missed, use **Settings → Record a test clip** while doing a few rounds;
   the .wav it saves can be replayed with `node tools/analyze.mjs clip.wav` to tune the settings.
2. **Teach svāhā**: everyone says “svāhā” together 5–8 times, a few seconds apart. Tap *Finish*.
3. **Teach background**: chant the mantra and chat normally for 20 s *without* svāhā.
4. Tap **Start**, do ~10 real mantra + svāhā rounds, compare the count with reality.
5. Read the log under the counter:
   - svāhās missed as *too short* → lower **Shortest svāhā**.
   - missed as *not a steady "aa"* / *not like taught* → lower **Strictness**.
   - nothing logged at all → raise **Sensitivity**.
   - extra counts → raise **Strictness** or **Shortest svāhā**.
6. At the event: re-do step 2 in the hall if it's very different; keep the phone ~1–2 m from
   the people saying svāhā; use **−1 / +1** for any correction. The count is saved on the device
   and survives refresh / app close. **Reset** asks for confirmation.

Keep the screen on: the app requests it, but also set iPhone *Settings → Display → Auto-Lock → Never*
for the event (iOS pauses the microphone when the screen locks).

## Putting it on the phone

The microphone only works on an `https://` address (or `localhost`). Host the folder on any static
host (e.g. GitHub Pages), open it in Safari → Share → **Add to Home Screen**. On Android: Chrome menu →
**Add to Home screen** / **Install app**. After the first open it works offline.

## Development

```bash
npm test          # detection unit tests (real speech clips made with macOS `say`)
npm run e2e       # real Chrome: plays a recorded scene in as the mic, checks the count + screenshots
npm run serve     # http://localhost:8765 on this Mac
node tools/analyze.mjs clip.wav [minVowelMs] [sensitivity] [strictness]   # replay a recorded test clip
```

Bump `VERSION` in `sw.js` whenever files change so installed copies update.

## Development journal

What was tried, what was found, and what changed. Newest at the bottom.
Real recordings live in `recordings/` on the development Mac only (not in git; they are a
person's voice). Tests that need them skip when the files are absent.

### 2026-11-04 · v1: "s" + held "aa" detector (synthetic voices)
- **Approach:** find a short hiss ("s"), then a long, steady vowel; hold each candidate briefly
  so the last one before a pause wins; minimum gap between counts. Tuned only on macOS `say`
  voices plus generated noise.
- **Learning:** synthetic speech made every test pass, but taught us nothing about real chanting.

### 2026-11-05 · first real tries: 0 counted
| Issue | Finding | Fix |
|---|---|---|
| Counter stayed at 0 | macOS mic mode *Voice Isolation* strips the "s" | use *Standard*; app now explains each rejection |
| Still 0 (webcam mic) | C920 records at 16 kHz with steady hum; the hum hid the "s" | "s" judged against the room's own sound |
| Mic "not listening" on GitHub Pages | audio engine started after the permission prompt, so browsers kept it paused | start audio on the tap; *Resume* fallback |
| Svāhā swallowed in continuous chanting | after "too long (chanting?)" the app waited for a pause that never came | a clear "s" restarts listening |
| End of mantra counted, real svāhā "too soon" | candidate committed 0.9 s after it ended; next svāhā came 0.96 s later | hold candidates 1.2 s |
- **Tools added:** *Save last 2 min of sound* (always-on recorder), `tools/analyze.mjs`
  (replay a clip), `tools/frames.mjs` (per-frame features), spectrograms with ffmpeg.
- **Learning:** every fix came from a real recording; guessing from synthetic audio kept failing.
  Background music was a poor stand-in for a hall (it never pauses) — not tuned for.

### 2026-11-05 · marks: measuring against the truth
- Added **Mark svāhā** (button / Space key). Marks are saved inside the WAV and
  `tools/analyze.mjs` scores hits, misses and extra counts.
- Gotcha: the Space-key click is audible right at each mark; segmenting must cut there.
- Recorded A (12 svāhā alone, varied), B (mantra alone, no svāhā), C (10 rounds of flow, marked).
- **The "s" + "aa" detector, scored:** A 4/12 · B **7 false counts** · C 5/10 with 1 extra.
  Conclusion (the user's): finding "s" and "aa" inside running chanting is bound to fail.

### 2026-11-05 · whole-word spotting (template matching)
- **Approach:** compare the running sound with recorded svāhās as whole words using
  streaming subsequence DTW (`js/spotter.js`), so speed and run-on chanting are handled.
- **Try 1 — templates from A (svāhā said alone):** separates A's svāhās from mantra, but finds
  only 1/10 svāhās in C. *A svāhā said alone is a different sound from one said in the flow*
  (shorter, blended with "…dayāt", and quieter relative to the chanting around it).
- **Try 2 — templates from C (the 1.2 s before each mark):** leave-one-out on C separates all
  10/10 from every mantra piece; but on other sessions it found only 1–5 of 10.
  *Mic distance and room change the voice's colour.*
- **Try 3 — colour relative to the last ~1.5 s (cepstral mean normalisation):**

  | unseen recording | expected | found |
  |---|---|---|
  | B mantra alone | 0 | **0** |
  | 08:55, 10 rounds | 10 | **10** (≈9 certain; one gap near 37 s, one count at the clip's very end) |
  | 09:25, 3 continuous | 3 | **3** at the right moments |
  | 09:43, 10 rounds | 10 | **10**, evenly spaced |
  Nine svāhās score 3.0–3.55, mantra never below 4.90; one unusual svāhā scored 4.77.
  Nearby settings (1.0 s / 3 s normalising, 0.9 s / 1.5 s templates) did clearly worse, so more
  marked data is needed before trusting it widely. Isolated svāhās (A) are *not* matched by flow
  templates — fine for a homam, where svāhā always follows the mantra.
- **Status:** proven offline (`node tools/spot-eval.mjs FLOW.wav MANTRA.wav [tests…]`);
  not yet used by the app.
