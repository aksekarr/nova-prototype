import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceEffectDSP, VOICE_EFFECT_PARAMETERS } from '../js/voice-effect-dsp.js';
import { FLANGER_DEFAULTS, VOICE_EFFECT_PRESETS, voiceEffectParameters } from '../js/flanger.js';

const SR = 44100;
const tone = (hz, length = SR + 4410) => Float32Array.from({ length }, (_, i) => 0.4 * Math.cos(2 * Math.PI * hz * i / SR));
function parameters(tuning = FLANGER_DEFAULTS) {
  return Object.fromEntries(Object.entries(voiceEffectParameters(tuning))
    .map(([key, value]) => [key, new Float32Array([value])]));
}
function render(input, tuning, block = 128, engine = new VoiceEffectDSP(SR)) {
  const output = new Float32Array(input.length), p = parameters(tuning);
  for (let start = 0; start < input.length; start += block) {
    engine.process([[input.subarray(start, start + block)]], [[output.subarray(start, start + block)]], p);
  }
  return output;
}
function amplitude(samples, hz, from = 4410) {
  let re = 0, im = 0;
  for (let i = from; i < samples.length; i++) {
    const phase = 2 * Math.PI * hz * i / SR;
    re += samples[i] * Math.cos(phase); im += samples[i] * Math.sin(phase);
  }
  return 2 * Math.hypot(re, im) / (samples.length - from);
}

test('default voice parameters agree with the worklet and remain bounded for partial or invalid tuning', () => {
  const defaults = voiceEffectParameters();
  for (const p of VOICE_EFFECT_PARAMETERS) assert.equal(defaults[p.name], p.defaultValue);
  assert.equal(voiceEffectParameters({ ringMix: Infinity }).ringMix, defaults.ringMix);
  assert.equal(voiceEffectParameters({ ringMix: 2 }).ringMix, 0.15);
  assert.equal(voiceEffectParameters({ ringRate: -5 }).ringHz, 20);
  assert.equal(voiceEffectParameters({ flangerMix: 0 }).sine, 1);
});

test('full bypass preserves every input sample, including extra output channels', () => {
  const input = tone(997, 1234), right = tone(330, 1234);
  const outputs = [new Float32Array(input.length), new Float32Array(input.length)];
  new VoiceEffectDSP(SR).process([[input, right]], [outputs], parameters({ flangerOn: false, ringMix: 0 }));
  assert.deepEqual(outputs[0], input); assert.deepEqual(outputs[1], right);
});

test('sine sweep rounds each turnaround while preserving the old delay endpoints', () => {
  // Observe the actual impulse's first wet arrival at each sweep endpoint.
  const input = new Float32Array(1000); input[0] = 1;
  const tuning = { ...VOICE_EFFECT_PRESETS.sine, flangerRate: 0, flangerMix: 1, flangerFeedback: 0 };
  const maximum = render(input, tuning);
  const engine = new VoiceEffectDSP(SR); engine.phase = Math.PI;
  const minimum = render(input, tuning, 128, engine);
  const peakAt = values => values.indexOf(Math.max(...values));
  assert.ok(Math.abs(peakAt(maximum) - 0.01184 * SR) <= 1);
  assert.ok(Math.abs(peakAt(minimum) - 0.0005 * SR) <= 1);
  const phase = 0.001;
  const a = new VoiceEffectDSP(SR), b = new VoiceEffectDSP(SR);
  a.phase = b.phase = phase;
  const sine = render(input, tuning, 128, a);
  const triangle = render(input, { ...tuning, flangerWaveform: 0 }, 128, b);
  const distance = values => values.reduce((sum, v, i) => sum + Math.abs(v - maximum[i]), 0);
  assert.ok(distance(sine) < distance(triangle) * 0.01);
});

test('ring layer adds both carrier sidebands while retaining the main voice', () => {
  const output = render(tone(1000), { flangerOn: false, ringMix: 0.04, ringRate: 75 });
  assert.ok(Math.abs(amplitude(output, 1000) - 0.4 * 0.96) < 1e-5);
  assert.ok(amplitude(output, 925) > 0.005);
  assert.ok(amplitude(output, 1075) > 0.005);
  assert.ok(amplitude(output, 750) < 1e-5);
});

test('ring layer filtering reduces low vocal-body modulation', () => {
  const tuning = { flangerOn: false, ringMix: 0.04, ringRate: 75 };
  const low = render(tone(50), tuning), mid = render(tone(1000), tuning);
  assert.ok(amplitude(low, 125) < amplitude(mid, 1075) * 0.2);
});

test('zero ring mix leaves the flanger independent of carrier frequency', () => {
  const input = tone(370, SR / 2);
  assert.deepEqual(render(input, VOICE_EFFECT_PRESETS.sine),
    render(input, { ...VOICE_EFFECT_PRESETS.sine, ringRate: 249 }));
});

test('processing is independent of source chunk boundaries', () => {
  const input = tone(440, 20123);
  assert.deepEqual(render(input, FLANGER_DEFAULTS, 128), render(input, FLANGER_DEFAULTS, 317));
  assert.deepEqual(render(input, FLANGER_DEFAULTS, 128), render(input, FLANGER_DEFAULTS, input.length));
});

test('reset clears all history and replays the same voice exactly', () => {
  const engine = new VoiceEffectDSP(SR), input = tone(615, 9021);
  const first = render(input, FLANGER_DEFAULTS, 128, engine);
  engine.reset();
  assert.deepEqual(render(new Float32Array(2048), FLANGER_DEFAULTS, 128, engine), new Float32Array(2048));
  engine.reset();
  assert.deepEqual(render(input, FLANGER_DEFAULTS, 128, engine), first);
});

test('silence produces no carrier tone and missing input remains finite', () => {
  const engine = new VoiceEffectDSP(SR), output = new Float32Array(128);
  engine.process([], [[output]], parameters());
  assert.deepEqual(output, new Float32Array(128));
  assert.equal(engine.process([], [], parameters()), true);
});

test('supported sample rates and extreme feedback decay without instability', () => {
  for (const sr of [16000, 44100, 48000, 96000]) {
    for (const feedback of [-0.95, 0.95]) {
      const engine = new VoiceEffectDSP(sr), input = new Float32Array(sr * 2);
      input[0] = 0.8;
      const output = new Float32Array(input.length);
      engine.process([[input]], [[output]], parameters({ flangerFeedback: feedback,
        flangerMix: 1, flangerBaseDelay: 20, flangerDepth: 20, ringMix: 0.15 }));
      assert.ok(output.every(Number.isFinite));
      assert.ok(output.every(value => Math.abs(value) <= 0.81));
      assert.ok(output.subarray(-Math.floor(sr / 4)).every(value => Math.abs(value) < 0.005));
    }
  }
});
