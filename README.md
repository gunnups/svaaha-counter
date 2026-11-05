# Svāhā Counter

Counts svāhā offerings during a homam by listening through the phone or tablet microphone.
Plain web page (no server code, no internet needed once opened); works in Safari on iPhone
and Chrome / Samsung Internet on the Galaxy Tab. Counting happens entirely on the device.

## How it recognises svāhā

**Learn my svāhā (recommended).** The app learns how *your* svāhā sounds, the way you say it at the
end of the mantra, and then counts by comparing whole words — so fast or drawn-out svāhā, and
svāhā running straight on from the mantra, are all fine. It learns on the device you use and keeps
what it learned only on that device.

1. Settings → **Start learning**.
2. Chant about 10 rounds of mantra + svāhā as you will at the homam. Right after each svāhā tap
   **Mark svāhā** (under the counter; on a computer you can press Space).
3. Tap **Finish learning**. It tells you how many it learned and whether they stand apart from the mantra.
4. With family: everyone chants together, one person marks. Keep **Add to what it already learned**
   ticked so the group's svāhā join yours.

Until a device has learned, it uses a basic listener (a hiss "s" followed by a held "aa").
Two counts can't be closer than the *gap between counts* (3 s by default).

## At the homam

- Keep the phone ~1–2 m from the people saying svāhā. Use **−1 / +1** for any correction.
- The count is saved on the device and survives refresh / app close; **Reset** asks first.
- Set *Settings → Display → Auto-Lock → Never* (iOS stops the microphone when the screen locks).
- Under the count, the last 15 s of sound scroll past (left: when Start or Reset was pressed;
  right: now): blue-grey = chanting, saffron = a counted svāhā, white tick = a mark.
  A svāhā that stays blue-grey was missed.

## Putting it on the phone

The microphone only works on an `https://` address (or `localhost`). Host the folder on any static
host (e.g. GitHub Pages), open it in Safari → Share → **Add to Home Screen**. On Android: Chrome menu →
**Add to Home screen** / **Install app**. After the first open it works offline.

## Development

```bash
npm test            # unit tests
npm run e2e         # real Chrome: plays a scene in as the microphone, checks counting + screenshots
npm run e2e:learn   # real Chrome: learns from 6 marked rounds, then counts the next 3
npm run serve       # http://localhost:8765
```

Bump `VERSION` in `sw.js` whenever files change so installed copies update.
