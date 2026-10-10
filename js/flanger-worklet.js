import { VoiceEffectDSP, VOICE_EFFECT_PARAMETERS } from './voice-effect-dsp.js';

class NovaFlanger extends AudioWorkletProcessor {
  static get parameterDescriptors() { return VOICE_EFFECT_PARAMETERS; }

  constructor() {
    super();
    this.engine = new VoiceEffectDSP(sampleRate);
    this.port.onmessage = ({ data }) => {
      if (data?.type === 'reset') this.engine.reset();
    };
  }

  process(inputs, outputs, parameters) {
    return this.engine.process(inputs, outputs, parameters);
  }
}

registerProcessor('nova-flanger', NovaFlanger);
