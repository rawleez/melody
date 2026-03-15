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

    // Ring buffer stores Float32 samples at the input rate
    this._capacity       = Math.ceil(this._inputRate * bufSeconds);
    this._ring           = new Float32Array(this._capacity);
    this._writePos       = 0;
    this._readPos        = 0;
    this._size           = 0;

    // Phase accumulator: fractional input-sample offset carried across quanta.
    // Ensures each process() call advances the read pointer by exactly the right
    // number of integer input samples rather than over-consuming by 1 per quantum
    // (which would cause a constant ~1.56% speedup on long utterances).
    this._phase          = 0;

    // Pre-allocate temp buffer for one process() block.
    // ratio = inputRate / contextRate; if ratio > 1 we need more input samples
    // than output samples per block.  +2 gives the interpolation tail plus slack.
    const ratio          = this._inputRate / sampleRate;
    this._tempSize       = Math.ceil(128 * ratio) + 2;
    this._temp           = new Float32Array(this._tempSize);

    this._wasUnderrun    = false;

    // Prime gate: hold back playback until the buffer has at least 100 ms of
    // audio.  Prevents cold-start underruns (session start, post-flush/barge-in)
    // where Gemini floods frames faster than real-time but the worklet starts
    // draining immediately, producing the chipmunk speedup effect.
    this._primed         = false;
    this._primeThreshold = Math.ceil(this._inputRate * 0.1); // 100 ms @ inputRate

    this.port.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        this._enqueue(new Int16Array(e.data));
      } else if (e.data === 'flush') {
        this._writePos = 0;
        this._readPos  = 0;
        this._size     = 0;
        this._phase    = 0;
        this._primed   = false; // re-arm prime gate after flush
      }
    };
  }

  /** Convert Int16 samples to Float32 and append to the ring buffer. */
  _enqueue(samples) {
    for (let i = 0; i < samples.length; i++) {
      if (this._size >= this._capacity) {
        // Overflow: drop oldest sample to make room for fresh audio.
        // Reset _phase so the interpolation offset stays coherent with the
        // new _readPos origin — without this, process() uses a stale phase
        // that no longer corresponds to the actual buffer position, causing
        // audible speedup during long audio bursts (e.g. job-reading).
        this._readPos = (this._readPos + 1) % this._capacity;
        this._size--;
        this._phase = 0;
      }
      this._ring[this._writePos] = samples[i] / 32768.0;
      this._writePos = (this._writePos + 1) % this._capacity;
      this._size++;
    }
  }

  process(inputs, outputs) {
    const channel = outputs[0]?.[0];
    if (!channel) return true;

    // Prime gate: output silence until the buffer reaches 100 ms fill.
    // This prevents cold-start underruns from causing the chipmunk speedup.
    if (!this._primed) {
      if (this._size < this._primeThreshold) {
        channel.fill(0);
        return true;
      }
      this._primed = true;
    }

    const outLen   = channel.length;                     // 128 frames (render quantum)
    const ratio    = this._inputRate / sampleRate;       // e.g. 24000/48000 = 0.5
    const phase    = this._phase;                        // fractional offset [0, 1)

    // How many integer input samples to peek for interpolation:
    //   last 'a' index = floor(phase + (outLen-1)*ratio)
    //   need +1 for the 'b' interpolation tail, +1 to convert to count
    const inNeeded = Math.floor(phase + (outLen - 1) * ratio) + 2;

    // Peek inNeeded samples from the ring buffer without advancing readPos yet.
    // We will advance by the integer number of samples consumed after interpolation.
    const available = Math.min(inNeeded, this._size);
    const underrun  = available < inNeeded;

    for (let i = 0; i < available; i++) {
      this._temp[i] = this._ring[(this._readPos + i) % this._capacity];
    }
    for (let i = available; i < inNeeded; i++) {
      this._temp[i] = 0; // silence padding
    }

    // Notify main thread on leading edge of each underrun (not every block)
    if (underrun && !this._wasUnderrun) {
      this.port.postMessage({ type: 'underrun' });
    }
    this._wasUnderrun = underrun;

    // Linear interpolation resample: inputRate → AudioContext sample rate
    for (let i = 0; i < outLen; i++) {
      const pos  = phase + i * ratio;
      const idx  = Math.floor(pos);
      const frac = pos - idx;
      const a    = this._temp[idx];
      const b    = idx + 1 < inNeeded ? this._temp[idx + 1] : a;
      channel[i] = a + frac * (b - a);
    }

    // Advance the ring buffer by exactly the integer number of input samples
    // consumed this quantum.  The fractional remainder carries over in _phase,
    // keeping total consumption perfectly in sync with the resampling ratio.
    //
    // On any underrun (partial or complete), reset _phase = 0.
    //
    // Why: during partial underrun (0 < available < intAdvance), carrying
    // totalAdvance - available as the new phase produces a value >> 1
    // (e.g. 54 when available=10, intAdvance=64).  On the next call the
    // interpolation loop starts at pos=54 inside _temp, silently skipping
    // the first 54 valid ring-buffer samples — the chipmunk speedup.
    // Resetting to 0 is correct: the silence gap already filled the temporal
    // hole; the next burst should start from position 0 in the buffer.
    const totalAdvance  = phase + outLen * ratio;
    const intAdvance    = Math.floor(totalAdvance);
    const actualAdvance = Math.min(intAdvance, available);
    this._readPos = (this._readPos + actualAdvance) % this._capacity;
    this._size   -= actualAdvance;
    this._phase   = underrun ? 0 : totalAdvance - intAdvance;

    // Mono → stereo: copy channel 0 to any additional output channels
    for (let ch = 1; ch < outputs[0].length; ch++) {
      outputs[0][ch].set(channel);
    }

    return true;
  }
}

registerProcessor('audio-player-processor', AudioPlayerProcessor);
