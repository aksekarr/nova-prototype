import { VOICE_EFFECT_PRESETS, createFlangerNode, voiceEffectParameters } from './flanger.js';
import { VoiceEffectDSP } from './voice-effect-dsp.js';

const clip = document.getElementById('clip');
const status = document.getElementById('status');
const metrics = document.getElementById('metrics');
const quote = document.getElementById('quote');
const buttons = [...document.querySelectorAll('[data-preset]')];
const cache = new Map();
let context = null, playing = null, request = 0;

function measure(samples) {
  let sum = 0, peak = 0;
  for (const value of samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  return { rms: Math.sqrt(sum / Math.max(1, samples.length)), peak };
}

async function load(id) {
  const [audio, text] = await Promise.all([
    fetch(new URL(`../voice/${id}.mp3`, import.meta.url)),
    fetch(new URL(`../voice/${id}.json`, import.meta.url))
  ]);
  if (!audio.ok || !text.ok) throw new Error('Recording unavailable.');
  const [decoded, data] = await Promise.all([
    audio.arrayBuffer().then(bytes => context.decodeAudioData(bytes)), text.json()
  ]);
  const buffer = context.createBuffer(1, decoded.length, decoded.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
    const channel = decoded.getChannelData(ch);
    for (let i = 0; i < samples.length; i++) samples[i] += channel[i] / decoded.numberOfChannels;
  }
  const levels = {};
  for (const [name, tuning] of Object.entries(VOICE_EFFECT_PRESETS)) {
    const output = new Float32Array(samples.length);
    const parameters = Object.fromEntries(Object.entries(voiceEffectParameters(tuning))
      .map(([key, value]) => [key, new Float32Array([value])]));
    new VoiceEffectDSP(buffer.sampleRate).process([[samples]], [[output]], parameters);
    levels[name] = measure(output);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  // Match RMS across versions; lower the common level if any version needs headroom.
  // These gains are preview-only and never change the live voice.
  const target = Math.min(levels.original.rms,
    ...Object.values(levels).map(({ rms, peak }) => peak > 0 ? 0.94 * rms / peak : Infinity));
  for (const level of Object.values(levels)) level.gain = level.rms > 0 ? target / level.rms : 1;
  return { buffer, text: data.text.replace(/\[[^\]]*\]/g, '').trim(), levels };
}

function stop() {
  const current = playing;
  playing = null;
  for (const button of buttons) button.setAttribute('aria-pressed', 'false');
  if (!current) return;
  current.gain.gain.cancelScheduledValues(context.currentTime);
  current.gain.gain.setValueAtTime(current.gain.gain.value, context.currentTime);
  current.gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.01);
  current.source.stop(context.currentTime + 0.012);
}

async function play(name) {
  const ticket = ++request;
  stop();
  status.textContent = 'Preparing comparison…';
  try {
    if (!context) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try { context = new AC({ sampleRate: 44100 }); } catch { context = new AC(); }
    }
    // Resume within the click gesture, before fetching or decoding.
    await context.resume();
    const id = clip.value;
    if (!cache.has(id)) {
      const loading = load(id).catch(error => { cache.delete(id); throw error; });
      cache.set(id, loading);
    }
    const data = await cache.get(id);
    if (ticket !== request) return;
    const node = await createFlangerNode(context, VOICE_EFFECT_PRESETS[name]);
    if (!node) throw new Error('Voice processing is unavailable in this browser.');
    if (ticket !== request) { node.disconnect(); return; }
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = data.buffer;
    const startAt = context.currentTime + 0.015;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(data.levels[name].gain, startAt + 0.005);
    source.connect(node);
    node.connect(gain);
    gain.connect(context.destination);
    const current = { source, node, gain };
    playing = current;
    source.onended = () => {
      source.disconnect(); node.disconnect(); gain.disconnect();
      if (playing !== current) return;
      playing = null;
      for (const button of buttons) button.setAttribute('aria-pressed', 'false');
      status.textContent = 'Finished—choose another sound to compare.';
    };
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.preset === name));
    quote.textContent = data.text;
    metrics.textContent = JSON.stringify({ clip: id, sampleRate: context.sampleRate,
      durationSeconds: data.buffer.duration, selected: name, settings: VOICE_EFFECT_PRESETS[name],
      previewLevels: Object.fromEntries(Object.entries(data.levels).map(([key, v]) => [key, {
        gain: v.gain, matchedRms: v.rms * v.gain, matchedPeak: v.peak * v.gain
      }])) }, null, 2);
    status.textContent = `Playing ${buttons.find(button => button.dataset.preset === name).childNodes[0].textContent.trim()}`;
    source.start(startAt);
  } catch (error) {
    if (ticket === request) status.textContent = error.message || 'Could not play. Try again.';
  }
}

for (const button of buttons) button.addEventListener('click', () => play(button.dataset.preset));
document.getElementById('stop').addEventListener('click', () => {
  ++request; stop(); status.textContent = 'Stopped—choose a sound.';
});
clip.addEventListener('change', () => {
  ++request; stop(); quote.textContent = ''; status.textContent = 'Ready—choose a sound.';
  metrics.textContent = 'Levels are measured when this recording loads.';
});
window.addEventListener('pagehide', () => { ++request; stop(); context?.suspend(); });
