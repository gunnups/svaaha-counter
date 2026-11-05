// Opens the microphone and streams raw samples to a callback.

const RESUME_WAIT_MS = 1500;

/**
 * @param {(samples: Float32Array) => void} onSamples
 * @param {(state: string) => void} onStateChange  'running' | 'suspended' | 'interrupted' | 'closed'
 * @returns {Promise<{sampleRate: number, running: boolean, resume: () => Promise<void>, stop: () => void}>}
 */
export async function startMic(onSamples, onStateChange) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot use the microphone here. Open the app over https (or localhost).');
  }
  // Create and start the audio engine *during the tap*, before the permission
  // prompt: browsers (Safari especially) keep audio paused if it starts later.
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const resumed = ctx.resume().catch(() => {});

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // Raw sound: the phone's voice-call processing would squash the "s".
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop());
    ctx.close();
    if (err && err.name === 'NotAllowedError') throw err;
    throw new Error(`Could not start the microphone: ${err instanceof Error ? err.message : err}`);
  }
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, 'capture');
  const silent = ctx.createGain();
  silent.gain.value = 0; // keep the graph running without playing anything
  source.connect(capture).connect(silent).connect(ctx.destination);
  capture.port.onmessage = (e) => onSamples(e.data);
  ctx.onstatechange = () => onStateChange(ctx.state);
  // Don't wait forever: if the browser keeps audio paused, the app offers "Resume".
  await Promise.race([resumed, new Promise((r) => setTimeout(r, RESUME_WAIT_MS))]);

  return {
    sampleRate: ctx.sampleRate,
    get running() {
      return ctx.state === 'running';
    },
    resume: () => ctx.resume(),
    stop() {
      capture.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
