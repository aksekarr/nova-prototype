import { createVoiceEffect, stopReferenceClip } from './flanger.js';

const ENVELOPE_HZ = 60;
const RMS_WINDOW_SECONDS = 0.016;
const SHAPE_LOOKAHEAD_SECONDS = 0.03;
const SHAPE_PRESETS = {
  rest: { w: 1, h: 1, round: 0, close: 0 },
  open: { w: 1, h: 1.25, round: 0, close: 0 },
  wide: { w: 1.22, h: 0.55, round: 0, close: 0 },
  round: { w: 0.62, h: 1.05, round: 1, close: 0 },
  closed: { w: 0.95, h: 1, round: 0, close: 1 },
  teeth: { w: 1, h: 0.3, round: 0, close: 0 }
};
const CHARACTER_SHAPES = {
  m: 'closed', b: 'closed', p: 'closed',
  f: 'teeth', v: 'teeth',
  o: 'round', u: 'round', w: 'round', q: 'round',
  e: 'wide', i: 'wide', y: 'wide',
  a: 'open'
};

function buildShapeTimeline({ alignment }) {
  const timeline = [];
  let inTag = false;
  alignment.characters.forEach((character, i) => {
    for (const char of character) {
      if (char === '[') inTag = true;
      else if (char === ']') inTag = false;
      else if (!inTag) {
        const name = CHARACTER_SHAPES[char.toLowerCase()] ||
          (/[\s\p{P}]/u.test(char) ? 'rest' : null);
        if (name) timeline.push({
          start: alignment.character_start_times_seconds[i],
          shape: SHAPE_PRESETS[name]
        });
      }
    }
  });
  for (let i = 0; i + 1 < timeline.length; i++) {
    if (timeline[i].shape.close) {
      timeline[i + 1].start = Math.max(timeline[i + 1].start, timeline[i].start + 0.07);
    }
  }
  return timeline;
}

function buildEnvelope(buffer) {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const windowSize = Math.max(1, Math.round(buffer.sampleRate * RMS_WINDOW_SECONDS));
  const envelope = new Float32Array(Math.ceil(buffer.duration * ENVELOPE_HZ));
  for (let i = 0; i < envelope.length; i++) {
    const start = Math.floor(i * buffer.sampleRate / ENVELOPE_HZ);
    const end = Math.min(buffer.length, start + windowSize);
    let sum = 0;
    for (const channel of channels) {
      for (let j = start; j < end; j++) sum += channel[j] * channel[j];
    }
    envelope[i] = Math.sqrt(sum / ((end - start) * channels.length));
  }
  const sorted = Array.from(envelope).sort((a, b) => a - b);
  const peak = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  if (peak > 0) {
    for (let i = 0; i < envelope.length; i++) {
      const value = Math.min(1, envelope[i] / peak);
      envelope[i] = value < 0.08 ? 0 : value;
    }
  }
  return envelope;
}

function buildWords({ text, alignment }) {
  const words = text.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).filter(Boolean);
  let visible = '';
  const times = [];
  let inTag = false;
  alignment.characters.forEach((character, i) => {
    for (const char of character) {
      if (char === '[') inTag = true;
      else if (char === ']') inTag = false;
      else if (!inTag) {
        visible += char;
        // Keep indices aligned with String.matchAll, including UTF-16 pairs.
        for (let j = 0; j < char.length; j++) times.push(alignment.character_start_times_seconds[i]);
      }
    }
  });
  const alignedWords = Array.from(visible.matchAll(/\S+/g));
  if (alignedWords.length !== words.length || alignedWords.some((word, i) =>
    word[0] !== words[i] || !Number.isFinite(times[word.index]))) {
    throw new Error('Voice text and alignment do not match');
  }
  return words.map((text, i) => ({ text, start: times[alignedWords[i].index] }));
}

export function createVoice({ caption, readout }) {
  const lines = new Map();
  let ac = null;
  let gainNode = null;
  let effect = null;
  let speech = null;
  let soundOn = true;
  let envelope = 0;
  const shape = { ...SHAPE_PRESETS.rest };
  let idleStatus = 'Loading';

  function showStatus(text) {
    readout.textContent = text;
    readout.classList.toggle('live', text === 'Speaking');
  }

  // Capture button gestures before their handlers start speech.
  document.addEventListener('click', (event) => {
    if (event.target.closest('button') && ac && ac.state === 'suspended') {
      ac.resume().catch(() => {});
    }
  }, true);

  async function preload(ids) {
    idleStatus = 'Loading';
    if (!speech) showStatus(idleStatus);
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        ac = new AC();
        gainNode = ac.createGain();
        gainNode.gain.value = soundOn ? 1 : 0;
        gainNode.connect(ac.destination);
        effect = createVoiceEffect(ac, gainNode);
      }
      await Promise.all([effect.ready, ...ids.map((id) => {
        if (!lines.has(id)) lines.set(id, loadLine(id));
        return lines.get(id);
      })]);
      idleStatus = 'Silent';
    } catch (error) {
      idleStatus = 'Voice unavailable';
      throw error;
    } finally {
      if (!speech) showStatus(idleStatus);
    }
  }

  async function loadLine(id) {
    const base = new URL(`../voice/${encodeURIComponent(id)}`, import.meta.url);
    const [audioResponse, alignmentResponse] = await Promise.all([
      fetch(`${base}.mp3`), fetch(`${base}.json`)
    ]);
    if (!audioResponse.ok || !alignmentResponse.ok) throw new Error(`Could not load voice line: ${id}`);
    const [buffer, data] = await Promise.all([
      audioResponse.arrayBuffer().then(bytes => ac.decodeAudioData(bytes)),
      alignmentResponse.json()
    ]);
    return {
      buffer, words: buildWords(data), envelope: buildEnvelope(buffer),
      shapes: buildShapeTimeline(data)
    };
  }

  function finish(line) {
    if (speech !== line) return;
    speech = null;
    envelope = 0;
    if (line.source) {
      line.source.onended = null;
      line.source.stop();
      line.source.disconnect();
    }
    line.spans.forEach(span => span.classList.add('on'));
    showStatus(idleStatus);
    line.resolve();
  }

  function speak(id) {
    stop();
    return new Promise((resolve) => {
      const line = { source: null, spans: [], resolve };
      speech = line;
      const loaded = lines.get(id);
      if (!loaded) { finish(line); return; }
      Promise.all([loaded, effect.ready]).then(([data]) => {
        if (speech !== line) return;
        caption.className = 'caption';
        caption.textContent = '';
        line.spans = data.words.map(({ text }) => {
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = text;
          caption.appendChild(span);
          caption.appendChild(document.createTextNode(' '));
          return span;
        });
        line.data = data;
        line.shown = 0;
        line.shapeIndex = -1;
        line.source = ac.createBufferSource();
        line.source.buffer = data.buffer;
        line.source.connect(effect.input);
        line.source.onended = () => finish(line);
        line.startedAt = ac.currentTime;
        effect.reset();
        line.source.start(line.startedAt);
        showStatus('Speaking');
        update(0);
      }).catch(() => {
        idleStatus = 'Voice unavailable';
        finish(line);
      });
    });
  }

  function stop() {
    stopReferenceClip();
    if (speech) finish(speech);
  }

  function update(dt) {
    let targetShape = SHAPE_PRESETS.rest;
    if (speech && speech.source) {
      const position = Math.max(0, ac.currentTime - speech.startedAt);
      const { words, envelope: values, shapes } = speech.data;
      const index = Math.floor(position * ENVELOPE_HZ);
      const target = values[index] || 0;
      const timeConstant = target > envelope ? 0.025 : 0.08;
      envelope += (target - envelope) * (1 - Math.exp(-dt / timeConstant));
      while (speech.shown < words.length && words[speech.shown].start <= position) {
        speech.spans[speech.shown++].classList.add('on');
      }
      while (speech.shapeIndex + 1 < shapes.length &&
        shapes[speech.shapeIndex + 1].start <= position + SHAPE_LOOKAHEAD_SECONDS) {
        speech.shapeIndex++;
      }
      if (speech.shapeIndex >= 0) targetShape = shapes[speech.shapeIndex].shape;
    }
    for (const key of ['w', 'h', 'round', 'close']) {
      const timeConstant = key === 'close' ? 0.012 : 0.045;
      shape[key] += (targetShape[key] - shape[key]) * (1 - Math.exp(-dt / timeConstant));
      // Settle exactly on the preset once the remaining difference is invisible.
      if (Math.abs(targetShape[key] - shape[key]) < 0.00001) shape[key] = targetShape[key];
    }
  }

  function currentEnvelope() {
    return envelope;
  }

  function currentShape() {
    return { ...shape };
  }

  function setSoundOn(value) {
    soundOn = value;
    if (gainNode) gainNode.gain.setValueAtTime(soundOn ? 1 : 0, ac.currentTime);
  }

  return { preload, speak, stop, currentEnvelope, currentShape, setSoundOn, update };
}
