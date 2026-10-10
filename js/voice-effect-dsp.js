const TAU = Math.PI * 2;

export const VOICE_EFFECT_PARAMETERS = [
  { name: 'rateHz', defaultValue: 0.133, minValue: 0, maxValue: 5, automationRate: 'a-rate' },
  { name: 'baseDelayMs', defaultValue: 11, minValue: 0.1, maxValue: 20, automationRate: 'a-rate' },
  { name: 'depthMs', defaultValue: 1, minValue: 0, maxValue: 20, automationRate: 'a-rate' },
  { name: 'feedback', defaultValue: 0.39, minValue: -0.95, maxValue: 0.95, automationRate: 'a-rate' },
  { name: 'mix', defaultValue: 0.43, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
  { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
  { name: 'sine', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
  { name: 'ringHz', defaultValue: 75, minValue: 20, maxValue: 250, automationRate: 'a-rate' },
  { name: 'ringMix', defaultValue: 0.04, minValue: 0, maxValue: 0.15, automationRate: 'a-rate' }
];

// Shared by the real-time worklet and the preview's level measurement.
// No lookahead, block delay, allocation or external state in the sample loop.
export class VoiceEffectDSP {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.delay = new Float32Array(Math.ceil(sampleRate * 0.04) + 2);
    // Gentle filtering confines the ring layer; the main voice stays full-band.
    this.highpassAlpha = 1 - Math.exp(-TAU * 400 / sampleRate);
    this.lowpassAlpha = 1 - Math.exp(-TAU * Math.min(5000, sampleRate * 0.45) / sampleRate);
    this.reset();
  }

  reset() {
    this.delay.fill(0);
    this.writeIndex = 0;
    this.phase = 0;
    this.ringPhase = 0;
    this.lowBody = 0;
    this.ringTone = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0], output = outputs[0];
    if (!output?.length) return true;
    const mono = input?.[0];
    const { rateHz, baseDelayMs, depthMs, feedback, mix, enabled, sine, ringHz, ringMix } = parameters;
    const delay = this.delay, sr = this.sampleRate;
    let { writeIndex, phase, ringPhase, lowBody, ringTone } = this;

    for (let i = 0; i < output[0].length; i++) {
      const dry = mono ? mono[i] : 0;
      const rate = rateHz[rateHz.length === 1 ? 0 : i];
      const base = baseDelayMs[baseDelayMs.length === 1 ? 0 : i];
      const depth = depthMs[depthMs.length === 1 ? 0 : i];
      const fb = feedback[feedback.length === 1 ? 0 : i];
      const wetMix = mix[mix.length === 1 ? 0 : i] * enabled[enabled.length === 1 ? 0 : i];
      const sweep = sine[sine.length === 1 ? 0 : i];
      const ringRate = ringHz[ringHz.length === 1 ? 0 : i];
      const ringAmount = ringMix[ringMix.length === 1 ? 0 : i];
      // Cosine is a sine sweep starting at the same maximum delay as the old triangle.
      const triangle = Math.abs(4 * (phase / TAU) - 2) - 1;
      const lfo = triangle + sweep * (Math.cos(phase) - triangle);
      const delaySamples = Math.max(0.1, Math.min(40, base + depth * lfo)) * sr / 1000;
      let readIndex = writeIndex - delaySamples;
      if (readIndex < 0) readIndex += delay.length;
      const before = Math.floor(readIndex);
      const after = before + 1 === delay.length ? 0 : before + 1;
      const fraction = readIndex - before;
      const wet = delay[before] + fraction * (delay[after] - delay[before]);
      delay[writeIndex] = dry + fb * wet;
      const flanged = (1 - wetMix) * dry + wetMix * wet;

      lowBody += this.highpassAlpha * (dry - lowBody);
      ringTone += this.lowpassAlpha * (dry - lowBody - ringTone);
      const metallic = ringTone * Math.cos(ringPhase);
      const effected = (1 - ringAmount) * flanged + ringAmount * metallic;
      const bypass = wetMix === 0 && ringAmount === 0;
      for (let channel = 0; channel < output.length; channel++) {
        const source = input?.[channel] || mono;
        output[channel][i] = bypass ? (source ? source[i] : 0) : effected;
      }
      if (++writeIndex === delay.length) writeIndex = 0;
      phase += TAU * rate / sr;
      if (phase >= TAU) phase -= TAU;
      ringPhase += TAU * ringRate / sr;
      if (ringPhase >= TAU) ringPhase -= TAU;
    }
    this.writeIndex = writeIndex;
    this.phase = phase;
    this.ringPhase = ringPhase;
    this.lowBody = lowBody;
    this.ringTone = ringTone;
    return true;
  }
}
