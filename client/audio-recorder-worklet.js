/**
 * AudioWorkletProcessor that records audio, streams it to the main thread,
 * and performs Voice Activity Detection (VAD) to signal speech start/end.
 * Energy level is sent with every audio frame for live UI visualization.
 */
class AudioRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // VAD parameters
    this.energyThreshold = 0.00125; // RMS energy above which we consider speech
    this.speechDuration  = 0.2;     // seconds of energy needed to confirm speech
    this.silenceDuration = 0.5;     // seconds of silence needed to end speech

    this.speechFrames  = 0;
    this.silenceFrames = 0;
    this.isSpeaking    = false;
    this.sampleRate    = 16000;
  }

  calculateEnergy(pcmData) {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i++) {
      sum += pcmData[i] * pcmData[i];
    }
    return Math.sqrt(sum / pcmData.length);
  }

  process(inputs) {
    const inputChannel = inputs[0][0];
    if (!inputChannel) return true;

    const energy       = this.calculateEnergy(inputChannel);
    const frameDuration = inputChannel.length / this.sampleRate;

    // VAD state machine
    if (energy > this.energyThreshold) {
      this.speechFrames  += frameDuration;
      this.silenceFrames  = 0;
      if (this.speechFrames > this.speechDuration && !this.isSpeaking) {
        this.isSpeaking = true;
        this.port.postMessage({ type: "speech_start" });
      }
    } else {
      this.silenceFrames += frameDuration;
      this.speechFrames   = 0;
      if (this.silenceFrames > this.silenceDuration && this.isSpeaking) {
        this.isSpeaking = false;
        this.port.postMessage({ type: "speech_end" });
      }
    }

    // Convert float32 → int16 PCM
    const pcmData = new Int16Array(inputChannel.length);
    for (let i = 0; i < inputChannel.length; i++) {
      const s = Math.max(-1, Math.min(1, inputChannel[i]));
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Send audio + energy level (energy is a plain number, not transferred)
    this.port.postMessage(
      { type: "audio_data", buffer: pcmData.buffer, energy },
      [pcmData.buffer]
    );

    return true;
  }
}

registerProcessor("audio-recorder-processor", AudioRecorderProcessor);
