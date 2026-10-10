import { createVoiceEffect, stopReferenceClip } from './flanger.js';
import { MOUTH_CHANNELS, makeMouthPresets, buildShapeTimeline, mouthTransitionStart } from './speech-mouth.js';

const ENVELOPE_HZ = 60;
const RMS_WINDOW_SECONDS = 0.016;
const STREAM_SAMPLE_RATE = 44100;
const STREAM_LEAD_SECONDS = 0.1;
const AUDIO_ACTIVATION_TIMEOUT_MS = 1500;
// A short reference history prevents silence / a quiet first consonant from
// becoming the normalisation peak. It ages out of the running percentile.
const STREAM_RMS_REFERENCE = 0.12;
const SHAPE_PRESETS = makeMouthPresets();
SHAPE_PRESETS.REST.h = 1;
// Preserve the original neutral input to silent facial expressions.
const IDLE_SHAPE = { ...SHAPE_PRESETS.REST, h: 1 };

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

// Expression timing is separate from the mouth/caption parsers. Cue identities
// come from the full reply text, so another alignment chunk can refine a cue's
// times without making the same occurrence into a new event.
function buildCueTimeline(text, alignment, ended = true) {
  const normalise = word => word.toLowerCase().replace(/\p{P}/gu, '');
  const words = [], tags = [];
  for (const token of text.matchAll(/\[[^\]]*\]|[^\s[\]]+/g)) {
    if (token[0][0] === '[') {
      tags.push({ id: `tag:${tags.length}`, name: token[0].slice(1, -1).trim().toLowerCase(),
        wordIndex: words.length });
    } else words.push({ text: token[0], value: normalise(token[0]), start: Infinity, end: Infinity });
  }

  const characters = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const joined = characters.join('');
  const close = joined.indexOf(']'), open = joined.indexOf('[');
  const leadingTags = text.match(/^\s*(?:\[[^\]]*\]\s*)+/)?.[0] || '';
  const unfinishedTag = joined.trim() && close < 0 && open < 0 &&
    Array.from({ length: leadingTags.length }, (_, i) => leadingTags.slice(i))
      .some(suffix => suffix.startsWith(joined) && suffix.includes(']'));
  const partialTag = Boolean(leadingTags && (unfinishedTag || (close >= 0 && (open < 0 || close < open))));
  let visible = '', tag = partialTag ? { name: '', start: 0, end: 0, partial: true, index: 0 } : null;
  const visibleStarts = [], visibleEnds = [], alignedTags = [];
  characters.forEach((character, i) => {
    const start = starts[i];
    const end = Number.isFinite(ends[i]) ? ends[i] : (starts[i + 1] ?? start);
    for (const char of character) {
      if (char === '[') tag = { name: '', start, end, partial: false, index: visible.length };
      else if (char === ']') {
        if (tag) alignedTags.push({ ...tag, end, name: tag.name.trim().toLowerCase() });
        tag = null;
      } else if (tag) { tag.name += char; tag.end = end; }
      else {
        visible += char;
        for (let j = 0; j < char.length; j++) {
          visibleStarts.push(start);
          visibleEnds.push(end);
        }
      }
    }
  });
  const tokens = Array.from(visible.matchAll(/\S+/g));
  let nextWord = 0;
  const matches = [];
  tokens.forEach((token, i) => {
    const value = normalise(token[0]);
    if (!value) return;
    const partial = i === tokens.length - 1 && !/\s$/.test(visible) && !ended;
    const match = words.findIndex((word, j) => j >= nextWord &&
      (word.value === value || (partial && word.value.startsWith(value))));
    if (match < 0) return;
    const start = visibleStarts[token.index], end = visibleEnds[token.index + token[0].length - 1];
    // An omitted word inherits the next reliable boundary, just as captions do.
    for (; nextWord <= match; nextWord++) {
      words[nextWord].start = start;
      words[nextWord].end = nextWord === match ? end : start;
    }
    matches.push({ index: token.index, wordIndex: match });
  });
  const cues = [];
  const usedTags = new Set();
  for (const aligned of alignedTags) {
    const following = matches.find(match => match.index >= aligned.index)?.wordIndex;
    const candidates = tags.filter(tag => !usedTags.has(tag.id) &&
      (tag.name === aligned.name || (aligned.partial && tag.name.endsWith(aligned.name))));
    const match = candidates.find(tag => tag.wordIndex === following) || candidates[0];
    if (!match) continue;
    usedTags.add(match.id);
    const nextWordStart = words[match.wordIndex]?.start;
    cues.push({ id: match.id, type: 'tag', name: match.name, start: aligned.start, end: aligned.end,
      ...(Number.isFinite(nextWordStart) ? { nextWordStart } : {}) });
  }
  for (const tag of tags) {
    if (usedTags.has(tag.id)) continue;
    const nextWordStart = words[tag.wordIndex]?.start;
    if (tag.wordIndex === 0) {
      cues.push({ id: tag.id, type: 'tag', name: tag.name, start: 0,
        end: Number.isFinite(nextWordStart) ? nextWordStart : 0,
        ...(Number.isFinite(nextWordStart) ? { nextWordStart } : {}) });
    } else if (Number.isFinite(nextWordStart)) {
      cues.push({ id: tag.id, type: 'tag', name: tag.name, start: nextWordStart, end: nextWordStart, nextWordStart });
    }
  }
  let questionIndex = 0;
  words.forEach((word, i) => {
    if (!word.text.includes('?')) return;
    const id = `question:${questionIndex++}`;
    const lastWord = word.value ? word : words.slice(0, i).findLast(item => item.value);
    if (lastWord && Number.isFinite(lastWord.start) && Number.isFinite(lastWord.end)) {
      cues.push({ id, type: 'question', start: lastWord.start, end: lastWord.end + 0.3 });
    }
  });
  return cues.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function createVoice({ caption, readout }) {
  const lines = new Map();
  let ac = null;
  let gainNode = null;
  let effect = null;
  let speech = null;
  let reply = null;
  let soundOn = true;
  let envelope = 0;
  // One smoother owns every speech mouth channel, including the sculpted vocabulary.
  const shape = { ...IDLE_SHAPE };
  let idleStatus = 'Loading';
  let nextReplyId = 0;
  let lastEnd = null;
  let audioActivation = null;
  let preloadStatusVersion = 0;

  function showStatus(text) {
    readout.textContent = text;
    readout.classList.toggle('live', text === 'Speaking');
  }

  function ensureAudio() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    try { ac = new AC({ sampleRate: STREAM_SAMPLE_RATE }); }
    catch { ac = new AC(); }
    gainNode = ac.createGain();
    gainNode.gain.value = soundOn ? 1 : 0;
    gainNode.connect(ac.destination);
    effect = createVoiceEffect(ac, gainNode);
    ac.addEventListener?.('statechange', () => {
      // A stopped audio clock cannot deliver the source's ended event. Let the
      // caller retry instead of leaving a cached line and its sequence pending.
      if (speech?.source && ac.state !== 'running') {
        idleStatus = 'Voice unavailable';
        finish(speech, true, audioUnavailable());
      }
    });
  }

  function audioUnavailable(cause) {
    const error = new Error('Audio could not start. Try again.', { cause });
    error.code = 'AUDIO_UNAVAILABLE';
    return error;
  }

  // Call directly from a user gesture, before awaiting any files or animation.
  // Safari can report interrupted as well as suspended. A fulfilled resume is
  // insufficient unless the clock is actually running; a pending one is bounded.
  function activate() {
    try { ensureAudio(); }
    catch (error) { return Promise.reject(audioUnavailable(error)); }
    if (ac.state === 'running') return Promise.resolve();
    if (ac.state === 'closed') return Promise.reject(audioUnavailable());
    if (audioActivation) return audioActivation;
    const attempt = new Promise((resolve, reject) => {
      const complete = (error) => {
        clearTimeout(timeout);
        // Another gesture can have started the clock while resume was pending.
        if (ac.state === 'running') resolve();
        else reject(audioUnavailable(error));
      };
      const timeout = setTimeout(() => complete(), AUDIO_ACTIVATION_TIMEOUT_MS);
      try {
        Promise.resolve(ac.resume()).then(() => complete(), complete);
      } catch (error) { complete(error); }
    });
    audioActivation = attempt.finally(() => { audioActivation = null; });
    return audioActivation;
  }

  // Capture button gestures before their handlers start speech.
  document.addEventListener('click', (event) => {
    if (event.target.closest('button') && ac && ac.state !== 'running') {
      activate().catch(() => {});
    }
  }, true);

  async function preload(ids, { background = false } = {}) {
    // Warming unrelated lines must not change the current interaction's status.
    // A later preload, playback or stop also retires this load's status updates.
    const statusVersion = background || speech || reply ? null : ++preloadStatusVersion;
    const ownsStatus = () => statusVersion !== null && statusVersion === preloadStatusVersion;
    if (ownsStatus()) {
      idleStatus = 'Loading';
      showStatus(idleStatus);
    }
    try {
      ensureAudio();
      await Promise.all([effect.ready, ...ids.map((id) => {
        if (!lines.has(id)) {
          const loading = loadLine(id).catch(error => {
            if (lines.get(id) === loading) lines.delete(id);
            throw error;
          });
          lines.set(id, loading);
        }
        return lines.get(id);
      })]);
      if (ownsStatus()) idleStatus = 'Silent';
    } catch (error) {
      if (ownsStatus()) idleStatus = 'Voice unavailable';
      throw error;
    } finally {
      if (ownsStatus() && !speech && !reply) showStatus(idleStatus);
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
      buffer, text: data.text, alignment: data.alignment,
      words: buildWords(data), envelope: buildEnvelope(buffer),
      shapes: buildShapeTimeline(data, { presets: SHAPE_PRESETS }), cues: buildCueTimeline(data.text, data.alignment)
    };
  }

  function finish(line, interrupted = false, error = null) {
    if (speech !== line) return;
    lastEnd = { replyId: line.replyId, reason: interrupted ? 'interrupted' : 'completed',
      position: line.source ? Math.max(0, ac.currentTime - line.startedAt) : 0,
      cues: line.data?.cues || [] };
    speech = null;
    envelope = 0;
    if (line.source) {
      line.source.onended = null;
      // start() can fail before the source is scheduled.
      try { line.source.stop(); } catch {}
      line.source.disconnect();
    }
    line.spans.forEach(span => span.classList.add('on'));
    showStatus(idleStatus);
    line.resolve(error ? { status: 'unavailable', error } : { status: interrupted ? 'stopped' : 'completed' });
  }

  function speak(id) {
    stop();
    return new Promise((resolve) => {
      const line = { source: null, spans: [], resolve, replyId: ++nextReplyId };
      speech = line;
      const loaded = lines.get(id);
      if (!loaded) {
        idleStatus = 'Voice unavailable';
        finish(line, true, new Error(`Voice line has not been loaded: ${id}`));
        return;
      }
      Promise.all([loaded, effect.ready, activate()]).then(([data]) => {
        if (speech !== line) return;
        if (ac.state !== 'running') throw audioUnavailable();
        idleStatus = 'Silent';
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
      }).catch(error => {
        if (speech !== line) return;
        idleStatus = 'Voice unavailable';
        finish(line, true, error);
      });
    });
  }

  function stop() {
    preloadStatusVersion++;
    if (idleStatus === 'Loading') {
      idleStatus = 'Silent';
      if (!speech && !reply) showStatus(idleStatus);
    }
    stopReferenceClip();
    if (speech) finish(speech, true);
    if (reply) finishStream(reply, true);
  }

  // Map the audio clock into content time. In an underrun the content clock
  // stays at the previous chunk's end; each new segment carries the same gap
  // for both the mouth and captions, including gaps not yet audible.
  function streamPosition(line, now) {
    let position = 0;
    for (const segment of line.segments) {
      if (now < segment.start) return { position, audible: false };
      if (now < segment.end) {
        return { position: segment.offset + now - segment.start, audible: true };
      }
      position = segment.offset + segment.duration;
    }
    return { position, audible: false };
  }

  function finishStream(line, interrupted = false) {
    if (line.finished) return;
    lastEnd = { replyId: line.replyId, reason: interrupted ? 'interrupted' : 'completed',
      position: streamPosition(line, ac.currentTime).position, cues: line.cues };
    line.finished = true;
    line.interrupted = interrupted;
    for (const source of line.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    line.sources.clear();
    line.pending.length = 0;
    line.tail = new Float32Array(0);
    if (reply === line) {
      reply = null;
      if (!interrupted) line.spans.forEach(span => span.classList.add('on'));
      showStatus(idleStatus);
    }
    if (line.underruns) console.debug('Live reply underruns:', line.underruns);
    line.resolve();
  }

  function settleStream(line) {
    if (line.ended && !line.pending.length && !line.sources.size) finishStream(line);
  }

  function appendEnvelope(line, samples, final = false) {
    const joined = new Float32Array(line.tail.length + samples.length);
    joined.set(line.tail);
    joined.set(samples, line.tail.length);
    const base = line.tailOffset;
    line.sampleCount += samples.length;
    const windowSize = Math.round(STREAM_SAMPLE_RATE * RMS_WINDOW_SECONDS);
    let start = Math.floor(line.envelope.length * STREAM_SAMPLE_RATE / ENVELOPE_HZ);
    while (start < line.sampleCount && (final || start + windowSize <= line.sampleCount)) {
      const end = Math.min(line.sampleCount, start + windowSize);
      let sum = 0;
      for (let i = start; i < end; i++) sum += joined[i - base] ** 2;
      const rms = Math.fround(Math.sqrt(sum / (end - start)));
      let lo = 0, hi = line.rms.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (line.rms[mid] < rms) lo = mid + 1;
        else hi = mid;
      }
      line.rms.splice(lo, 0, rms);
      const peak = line.rms[Math.ceil(line.rms.length * 0.95) - 1];
      const value = peak > 0 ? Math.min(1, rms / peak) : 0;
      line.envelope.push(Math.fround(value < 0.08 ? 0 : value));
      start = Math.floor(line.envelope.length * STREAM_SAMPLE_RATE / ENVELOPE_HZ);
    }
    line.tailOffset = Math.min(start, line.sampleCount);
    line.tail = joined.slice(line.tailOffset - base);
  }

  function refreshStreamAlignment(line) {
    const alignment = line.alignment;
    line.cues = buildCueTimeline(line.text, alignment, line.ended);
    // Some replies begin halfway through a leading tag, including its closing
    // bracket but not its opening bracket. Restore just the tag parser state.
    const joined = alignment.characters.join('');
    const close = joined.indexOf(']'), open = joined.indexOf('[');
    const leadingTags = line.text.match(/^\s*(?:\[[^\]]*\]\s*)+/)?.[0] || '';
    const unfinishedTag = joined.trim() && close < 0 && open < 0 &&
      Array.from({ length: leadingTags.length }, (_, i) => leadingTags.slice(i))
        .some(suffix => suffix.startsWith(joined) && suffix.includes(']'));
    const partialTag = leadingTags && (unfinishedTag || (close >= 0 && (open < 0 || close < open)));
    const parsed = partialTag ? {
      characters: ['[', ...alignment.characters],
      character_start_times_seconds: [0, ...alignment.character_start_times_seconds],
      character_end_times_seconds: [0, ...alignment.character_end_times_seconds]
    } : alignment;
    line.shapes = buildShapeTimeline({ alignment: parsed, text: line.text }, { presets: SHAPE_PRESETS, ended: line.ended });
    let visible = '', inTag = false;
    const times = [];
    parsed.characters.forEach((character, i) => {
      for (const char of character) {
        if (char === '[') inTag = true;
        else if (char === ']') inTag = false;
        else if (!inTag) {
          visible += char;
          for (let j = 0; j < char.length; j++) times.push(parsed.character_start_times_seconds[i]);
        }
      }
    });
    const tokens = Array.from(visible.matchAll(/\S+/g));
    const normalise = word => word.toLowerCase().replace(/\p{P}/gu, '');
    for (const word of line.words) word.start = Infinity;
    let next = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const value = normalise(token[0]);
      if (!value) continue;
      const partial = i === tokens.length - 1 && !/\s$/.test(visible) && !line.ended;
      const match = line.words.findIndex((word, j) => j >= next &&
        (normalise(word.text) === value || (partial && normalise(word.text).startsWith(value))));
      if (match < 0) continue;
      const start = times[token.index];
      // Missing leading words, or a mismatch in the middle, light with the
      // next matched word. Always consume matches in caption order.
      for (; next <= match; next++) line.words[next].start = start;
    }
    if (line.ended) {
      const last = next ? line.words[next - 1].start : 0;
      for (; next < line.words.length; next++) line.words[next].start = last;
    }
  }

  function scheduleStream(line) {
    if (reply !== line || line.finished || !line.ready) return;
    for (const { buffer, arrival, offset } of line.pending.splice(0)) {
      const previous = line.segments[line.segments.length - 1];
      const expected = previous ? previous.end : arrival + STREAM_LEAD_SECONDS;
      const start = Math.max(expected, ac.currentTime);
      const gap = previous ? Math.max(0, start - expected) : 0;
      if (gap > 0) line.underruns++;
      if (!previous) line.startedAt = start;
      const source = ac.createBufferSource();
      source.buffer = buffer;
      source.connect(effect.input);
      const segment = { start, end: start + buffer.duration, offset, duration: buffer.duration, gap };
      line.segments.push(segment);
      line.sources.add(source);
      source.onended = () => {
        source.disconnect();
        line.sources.delete(source);
        if (!line.finished) settleStream(line);
      };
      if (!previous) effect.reset();
      source.start(start);
    }
    settleStream(line);
  }

  function beginStream() {
    stop();
    ensureAudio();
    const line = {
      text: '', words: [], spans: [], shown: 0, shapes: [],
      replyId: ++nextReplyId, cues: [],
      alignment: { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }, alignmentOffset: 0,
      envelope: [], rms: Array(12).fill(STREAM_RMS_REFERENCE),
      tail: new Float32Array(0), tailOffset: 0, sampleCount: 0,
      pending: [], sources: new Set(), segments: [], startedAt: null,
      underruns: 0, ready: false, ended: false, finished: false, interrupted: false
    };
    line.done = new Promise(resolve => { line.resolve = resolve; });
    reply = line;
    caption.className = 'caption';
    caption.textContent = '';
    ac.resume().catch(() => {});
    effect.ready.then(() => {
      if (reply !== line) return;
      line.ready = true;
      scheduleStream(line);
    }).catch(() => {
      if (reply !== line) return;
      idleStatus = 'Voice unavailable';
      finishStream(line, true);
    });
    const accepts = () => reply === line && !line.finished && !line.ended;
    const handle = {
      setText(text) {
        if (!accepts()) return;
        line.text = typeof text === 'string' ? text : '';
        line.words = line.text.replace(/\[[^\]]*\]/g, '').trim().split(/\s+/).filter(Boolean)
          .map(text => ({ text, start: Infinity }));
        caption.textContent = '';
        line.shown = 0;
        line.spans = line.words.map(({ text }) => {
          const span = document.createElement('span');
          span.className = 'w';
          span.textContent = text;
          caption.appendChild(span);
          caption.appendChild(document.createTextNode(' '));
          return span;
        });
        refreshStreamAlignment(line);
      },
      addAudio(base64) {
        if (!accepts()) return;
        const arrival = ac.currentTime;
        const bytes = atob(base64);
        if (!bytes.length || bytes.length % 2) return;
        const buffer = ac.createBuffer(1, bytes.length / 2, STREAM_SAMPLE_RATE);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          const value = bytes.charCodeAt(2 * i) | (bytes.charCodeAt(2 * i + 1) << 8);
          samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
        }
        const offset = line.sampleCount / STREAM_SAMPLE_RATE;
        appendEnvelope(line, samples);
        line.pending.push({ buffer, arrival, offset });
        scheduleStream(line);
      },
      addAlignment(chunk) {
        if (!accepts() || !Array.isArray(chunk?.chars)) return;
        let duration = 0;
        chunk.chars.forEach((character, i) => {
          const start = chunk.char_start_times_ms?.[i];
          const length = chunk.char_durations_ms?.[i];
          if (typeof character !== 'string' || !Number.isFinite(start) ||
              !Number.isFinite(length) || start < 0 || length < 0) return;
          duration = Math.max(duration, start + length);
          line.alignment.characters.push(character);
          line.alignment.character_start_times_seconds.push((line.alignmentOffset + start) / 1000);
          line.alignment.character_end_times_seconds.push((line.alignmentOffset + start + length) / 1000);
        });
        line.alignmentOffset += duration;
        refreshStreamAlignment(line);
      },
      end() {
        if (accepts()) {
          line.ended = true;
          appendEnvelope(line, new Float32Array(0), true);
          refreshStreamAlignment(line);
          settleStream(line);
        }
        return line.done;
      },
      interrupt() { if (reply === line) finishStream(line, true); },
      // Numerical diagnostics for the dev simulator; never expose PCM or text.
      inspect() {
        return {
          startedAt: line.startedAt, sampleRate: STREAM_SAMPLE_RATE, contextSampleRate: ac.sampleRate,
          segments: line.segments.map(segment => ({ ...segment,
            shift: segment.start - line.startedAt - segment.offset,
            timelineStart: streamPosition(line, segment.start).position })),
          underruns: line.underruns, shapes: line.shapes.map(item => ({ ...item, shape: { ...item.shape } })),
          words: line.words.map(({ start }) => ({ start })), envelope: [...line.envelope],
          sampleCount: line.sampleCount, finished: line.finished, interrupted: line.interrupted,
          audible: !line.finished && streamPosition(line, ac.currentTime).audible
        };
      }
    };
    line.handle = handle;
    return handle;
  }

  const stream = {
    begin: beginStream,
    setText(text) { reply?.handle.setText(text); },
    addAudio(base64) { reply?.handle.addAudio(base64); },
    addAlignment(chunk) { reply?.handle.addAlignment(chunk); },
    end() { return reply ? reply.handle.end() : Promise.resolve(); },
    interrupt() { if (reply) finishStream(reply, true); },
    isActive() { return Boolean(reply); },
    isAudible() { return Boolean(reply && streamPosition(reply, ac.currentTime).audible); }
  };

  function update(dt) {
    let targetShape = IDLE_SHAPE, targetDuration = Infinity;
    if (reply) {
      const { position, audible } = streamPosition(reply, ac.currentTime);
      const target = audible ? reply.envelope[Math.floor(position * ENVELOPE_HZ)] || 0 : 0;
      const timeConstant = target > envelope ? 0.025 : 0.08;
      envelope += (target - envelope) * (1 - Math.exp(-dt / timeConstant));
      showStatus(audible ? 'Speaking' : idleStatus);
      if (audible) {
        while (reply.shown < reply.words.length && reply.words[reply.shown].start <= position) {
          reply.spans[reply.shown++].classList.add('on');
        }
        for (let i = 0; i < reply.shapes.length; i++) {
          const start = mouthTransitionStart(reply.shapes, i);
          if (start > position) break;
          targetShape = reply.shapes[i].shape;
          targetDuration = mouthTransitionStart(reply.shapes, i + 1) - start;
        }
      }
    } else if (!speech) {
      envelope += (0 - envelope) * (1 - Math.exp(-dt / 0.08));
      if (envelope < 0.00001) envelope = 0;
    }
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
        mouthTransitionStart(shapes, speech.shapeIndex + 1) <= position) {
        speech.shapeIndex++;
      }
      if (speech.shapeIndex >= 0) {
        targetShape = shapes[speech.shapeIndex].shape;
        targetDuration = mouthTransitionStart(shapes, speech.shapeIndex + 1)
          - mouthTransitionStart(shapes, speech.shapeIndex);
      }
    }
    for (const key of MOUTH_CHANNELS) {
      // Keep slow speech soft, but let a brief articulation reach its shape.
      // Lip closure attacks quickly; release retains its existing response.
      const timeConstant = key === 'close'
        ? (targetShape.close > shape.close ? Math.min(.012, Math.max(.004, targetDuration * .22)) : .012)
        : Math.min(.045, Math.max(.018, targetDuration * .4));
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

  function currentCues() {
    if (reply) {
      const { position, audible } = streamPosition(reply, ac.currentTime);
      return { replyId: reply.replyId, state: audible ? 'speaking' : 'gap', position, cues: reply.cues };
    }
    if (speech) return { replyId: speech.replyId, state: speech.source ? 'speaking' : 'gap',
      position: speech.source ? Math.max(0, ac.currentTime - speech.startedAt) : 0, cues: speech.data?.cues || [] };
    return null;
  }

  function lastReplyEnd() { return lastEnd; }

  function setSoundOn(value) {
    soundOn = value;
    if (gainNode) gainNode.gain.setValueAtTime(soundOn ? 1 : 0, ac.currentTime);
  }

  // The simulator reuses the existing preload/cache path, with no extra fetches.
  function getLabLine(id) { return lines.get(id); }

  return { preload, activate, speak, stop, currentEnvelope, currentShape, currentCues, lastReplyEnd, setSoundOn, update, stream, getLabLine };
}
