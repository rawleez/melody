/**
 * audio-recorder-worklet.js
 *
 * AudioWorkletProcessor that captures microphone input, resamples to 16 kHz,
 * applies basic RMS-based VAD, and posts Int16 PCM chunks to the main thread
 * for forwarding over WebSocket.
 *
 * Constructor processorOptions:
 *   targetSampleRate  {number}  Target sample rate in Hz (default: 16000)
 *   silenceThreshold  {number}  RMS level below which a frame is "silent" (default: 0.01)
 *   silencePadFrames  {number}  Silent frames to include after speech ends (default: 8)
 */
class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts = options.processorOptions ?? {};
    this._targetRate     = opts.targetSampleRate ?? 16000;
    this._threshold      = opts.silenceThreshold ?? 0.01;
    this._padFrames      = opts.silencePadFrames ?? 8;   // trailing silence kept

    // sampleRate is a global in AudioWorkletGlobalScope
    this._ratio          = sampleRate / this._targetRate;

    this._silentCount    = 0;   // consecutive silent frames seen
    this._speaking       = false;

    // Listen for stop signal from main thread
    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._stopped = true;
    };
    this._stopped = false;
  }

  process(inputs) {
    if (this._stopped) return false;  // detach node

    const channel = inputs[0]?.[0];
    if (!channel) return true;

    // --- VAD: RMS energy ---
    let sum = 0;
    for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i];
    const rms = Math.sqrt(sum / channel.length);
    const isSpeech = rms >= this._threshold;

    const wasSpeaking = this._speaking;
    if (isSpeech) {
      this._speaking    = true;
      this._silentCount = 0;
    } else {
      this._silentCount++;
      if (this._silentCount > this._padFrames) this._speaking = false;
    }

    // Notify main thread on leading edge of each speech burst so it can flush
    // the player ring buffer and prevent stale audio backlog (barge-in support).
    if (isSpeech && !wasSpeaking) {
      this.port.postMessage({ type: 'speech_start' });
    }

    // Always send audio — including silence — so the server-side VAD in
    // Gemini Live can detect end-of-speech and trigger a response. Gating
    // transmission on the client side prevents the server from ever seeing
    // the silence that signals the user has finished speaking.

    // --- Resample from AudioContext rate → 16 kHz (linear interpolation) ---
    const outLen = Math.floor(channel.length / this._ratio);
    const resampled = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos  = i * this._ratio;
      const idx  = Math.floor(pos);
      const frac = pos - idx;
      const a    = channel[idx]     ?? 0;
      const b    = channel[idx + 1] ?? a;
      resampled[i] = a + frac * (b - a);
    }

    // --- Convert Float32 → Int16 PCM ---
    const pcm = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s  = Math.max(-1, Math.min(1, resampled[i]));
      pcm[i]   = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Transfer the underlying buffer (zero-copy)
    this.port.postMessage(pcm.buffer, [pcm.buffer]);

    return true;
  }
}

registerProcessor('audio-recorder-processor', AudioRecorderProcessor);
