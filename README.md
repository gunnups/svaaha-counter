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
