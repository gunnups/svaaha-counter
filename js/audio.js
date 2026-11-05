// Opens the microphone and streams raw samples to a callback.

/**
 * @param {(samples: Float32Array) => void} onSamples
 * @param {(state: string) => void} onStateChange  'running' | 'suspended' | 'interrupted' | 'closed'
 * @returns {Promise<{sampleRate: number, resume: () => Promise<void>, stop: () => void}>}
 */
export async function startMic(onSamples, onStateChange) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot use the microphone here. Open the app over https (or localhost).');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // Raw sound: the phone's voice-call processing would squash the "s".
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new Error(`Could not start audio processing: ${err instanceof Error ? err.message : err}`);
  }
  const source = ctx.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(ctx, 'capture');
  const silent = ctx.createGain();
  silent.gain.value = 0; // keep the graph running without playing anything
  source.connect(capture).connect(silent).connect(ctx.destination);
  capture.port.onmessage = (e) => onSamples(e.data);
  ctx.onstatechange = () => onStateChange(ctx.state);
  await ctx.resume();

  return {
    sampleRate: ctx.sampleRate,
    resume: () => ctx.resume(),
    stop() {
      capture.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
