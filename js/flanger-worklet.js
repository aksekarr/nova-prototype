const TAU = Math.PI * 2;

class NovaFlanger extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rateHz', defaultValue: 0.133, minValue: 0, maxValue: 5, automationRate: 'a-rate' },
      { name: 'baseDelayMs', defaultValue: 6.17, minValue: 0.1, maxValue: 20, automationRate: 'a-rate' },
      { name: 'depthMs', defaultValue: 5.67, minValue: 0, maxValue: 20, automationRate: 'a-rate' },
      { name: 'feedback', defaultValue: 0.39, minValue: -0.95, maxValue: 0.95, automationRate: 'a-rate' },
      { name: 'mix', defaultValue: 0.43, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'enabled', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'a-rate' }
    ];
  }

  constructor() {
    super();
    this.delay = new Float32Array(Math.ceil(sampleRate * 0.04) + 2);
    this.writeIndex = 0;
    this.phase = 0;
    this.port.onmessage = ({ data }) => {
      if (data && data.type === 'reset') {
        this.delay.fill(0);
        this.writeIndex = 0;
        this.phase = 0;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output.length) return true;
    const mono = input && input[0];
    const { rateHz, baseDelayMs, depthMs, feedback, mix, enabled } = parameters;
    const delay = this.delay;
    let writeIndex = this.writeIndex;
    let phase = this.phase;

    for (let i = 0; i < output[0].length; i++) {
      const dry = mono ? mono[i] : 0;
      const rate = rateHz[rateHz.length === 1 ? 0 : i];
      const base = baseDelayMs[baseDelayMs.length === 1 ? 0 : i];
      const depth = depthMs[depthMs.length === 1 ? 0 : i];
      const fb = feedback[feedback.length === 1 ? 0 : i];
      const wetMix = mix[mix.length === 1 ? 0 : i];
      const on = enabled[enabled.length === 1 ? 0 : i] >= 0.5;
      const q = phase / TAU, lfo = Math.abs(4 * q - 2) - 1;
      const delaySamples = Math.max(0.1, Math.min(40, base + depth * lfo)) * sampleRate / 1000;
      let readIndex = writeIndex - delaySamples;
      if (readIndex < 0) readIndex += delay.length;
      const before = Math.floor(readIndex);
      const after = before + 1 === delay.length ? 0 : before + 1;
      const fraction = readIndex - before;
      // Interpolate the ring per sample, allowing sweeps below a render quantum.
      const wet = delay[before] + fraction * (delay[after] - delay[before]);
      delay[writeIndex] = dry + fb * wet;
      const bypass = !on || wetMix === 0;
      const effected = (1 - wetMix) * dry + wetMix * wet;
      for (let channel = 0; channel < output.length; channel++) {
        const source = input && (input[channel] || mono);
        output[channel][i] = bypass ? (source ? source[i] : 0) : effected;
      }
      if (++writeIndex === delay.length) writeIndex = 0;
      phase += TAU * rate / sampleRate;
      if (phase >= TAU) phase -= TAU;
    }

    this.writeIndex = writeIndex;
    this.phase = phase;
    return true;
  }
}

registerProcessor('nova-flanger', NovaFlanger);
