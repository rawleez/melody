/**
 * audio-player-worklet.js
 *
 * AudioWorkletProcessor that buffers incoming Int16 PCM chunks received from
 * the WebSocket (via the main thread), resamples from the input rate (default
 * 24 kHz — Gemini Live output) to the AudioContext sample rate, and writes
 * them to the output channel.
 *
 * Handles buffer underrun by outputting silence (zeros) — no clicks or pops.
 *
 * Constructor processorOptions:
 *   inputSampleRate  {number}  PCM rate of incoming data (default: 24000)
 *   bufferSeconds    {number}  Ring buffer size in seconds (default: 4)
 *   minBufferMs      {number}  Minimum fill (ms) before playback begins after a cold
 *                              start or flush; prevents cold-start speedup (default: 150)
 *
 * Messages FROM main thread:
 *   ArrayBuffer  — Int16 PCM samples to enqueue
 *   'flush'      — clear the buffer (e.g. on barge-in / session reset)
 *
 * Messages TO main thread:
 *   { type: 'underrun' } — emitted once per underrun event (for UI feedback)
 */
class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const opts           = options.processorOptions ?? {};
    this._inputRate      = opts.inputSampleRate ?? 24000;
    const bufSeconds     = opts.bufferSeconds   ?? 4;
    const minBufferMs    = opts.minBufferMs      ?? 150;

    // Ring buffer stores Float32 samples at the input rate
    this._capacity       = Math.ceil(this._inputRate * bufSeconds);
    this._ring           = new Float32Array(this._capacity);
    this._writePos       = 0;
    this._readPos        = 0;
    this._size           = 0;

    // Minimum fill threshold: hold silence until this many samples are buffered.
    // Prevents cold-start / post-flush chipmunk speedup caused by the worklet
    // draining while the ring buffer is still filling from the first Gemini burst.
    this._minFill        = Math.ceil(this._inputRate * minBufferMs / 1000);
    this._prebuffering   = true;

    // Pre-allocate temp buffer for one process() block.
    // ratio = inputRate / contextRate; if ratio > 1 we need more input samples
    // than output samples per block.  +2 gives the interpolation tail plus slack.
    const ratio          = this._inputRate / sampleRate;
    this._tempSize       = Math.ceil(128 * ratio) + 2;
    this._temp           = new Float32Array(this._tempSize);

    this._wasUnderrun    = false;

    this.port.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this._enqueue(new Int16Array(e.data));
      } else if (e.data === 'flush') {
        this._writePos     = 0;
        this._readPos      = 0;
        this._size         = 0;
        this._prebuffering = true; // re-arm threshold after flush to prevent post-flush speedup
      }
    };
  }

  /** Convert Int16 samples to Float32 and append to the ring buffer. */
  _enqueue(samples) {
    for (let i = 0; i < samples.length; i++) {
      if (this._size >= this._capacity) {
        // Overflow: drop oldest sample to make room for fresh audio
        this._readPos = (this._readPos + 1) % this._capacity;
        this._size--;
      }
      this._ring[this._writePos] = samples[i] / 32768.0;
      this._writePos = (this._writePos + 1) % this._capacity;
      this._size++;
    }
  }

  process(inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;

    // Prebuffering guard: hold silence until the ring buffer reaches the minimum
    // fill threshold. This prevents the cold-start / post-flush chipmunk speedup
    // that occurs when Gemini delivers frames faster than real-time and the worklet
    // starts draining an almost-empty buffer.
    if (this._prebuffering) {
      if (this._size < this._minFill) {
        channel.fill(0);
        return true;
      }
      this._prebuffering = false;
    }

    const outLen   = channel.length;                     // 128 frames (render quantum)
    const ratio    = this._inputRate / sampleRate;       // e.g. 24000/48000 = 0.5
    const inNeeded = Math.ceil(outLen * ratio) + 1;      // +1 for interpolation tail

    // Pull inNeeded samples from ring buffer; zero-fill on underrun (silence)
    const available = Math.min(inNeeded, this._size);
    const underrun  = available < inNeeded;

    for (let i = 0; i < available; i++) {
      this._temp[i] = this._ring[this._readPos];
      this._readPos = (this._readPos + 1) % this._capacity;
    }
    for (let i = available; i < inNeeded; i++) {
      this._temp[i] = 0; // silence padding
    }
    this._size -= available;

    // Notify main thread on leading edge of each underrun (not every block)
    if (underrun && !this._wasUnderrun) {
      this.port.postMessage({ type: 'underrun' });
    }
    this._wasUnderrun = underrun;

    // Linear interpolation resample: inputRate → AudioContext sample rate
    for (let i = 0; i < outLen; i++) {
      const pos  = i * ratio;
      const idx  = Math.floor(pos);
      const frac = pos - idx;
      const a    = this._temp[idx];
      const b    = idx + 1 < inNeeded ? this._temp[idx + 1] : a;
      channel[i] = a + frac * (b - a);
    }

    // Mono → stereo: copy channel 0 to any additional output channels
    for (let ch = 1; ch < outputs[0].length; ch++) {
      outputs[0][ch].set(channel);
    }

    return true;
  }
}

registerProcessor('audio-player-processor', AudioPlayerProcessor);
