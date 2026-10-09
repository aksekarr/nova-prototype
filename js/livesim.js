// Development-only transport simulator. All input comes from the voice cache.
import { MOUTH_CHANNELS } from './speech-mouth.js';

const SAMPLE_RATE = 44100;

function encodePCM(samples, start, end) {
  const bytes = new Uint8Array((end - start) * 2);
  const view = new DataView(bytes.buffer);
  for (let i = start; i < end; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16((i - start) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function prepareSimulation(line, { random = Math.random } = {}) {
  const { buffer, alignment } = line;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const samples = new Float32Array(Math.round(buffer.duration * SAMPLE_RATE));
  // The voice context normally decodes at 44.1 kHz. Interpolate only on its
  // default-rate fallback; never fetch or decode the selected line again.
  for (let i = 0; i < samples.length; i++) {
    const position = i * buffer.sampleRate / SAMPLE_RATE;
    const first = Math.min(buffer.length - 1, Math.floor(position));
    const next = Math.min(buffer.length - 1, first + 1);
    const mix = position - first;
    for (const channel of channels) {
      samples[i] += (channel[first] * (1 - mix) + channel[next] * mix) / channels.length;
    }
  }
  const audio = [];
  for (let start = 0; start < samples.length;) {
    let end = Math.min(samples.length, start + Math.round((0.1 + random() * 0.5) * SAMPLE_RATE));
    const tail = samples.length - end;
    if (tail > 0 && tail < SAMPLE_RATE * 0.1) {
      if (end - start + tail <= SAMPLE_RATE * 0.6) end = samples.length;
      else end = samples.length - Math.ceil(SAMPLE_RATE * 0.1);
    }
    audio.push({ base64: encodePCM(samples, start, end), offset: start / SAMPLE_RATE,
      duration: (end - start) / SAMPLE_RATE });
    start = end;
  }

  const { characters, character_start_times_seconds: starts,
    character_end_times_seconds: ends } = alignment;
  const leadingTags = characters.join('').match(/^(?:\[[^\]]*\])+/)?.[0].length || 0;
  let dropped = 0, prefixLength = 0;
  while (dropped < characters.length && prefixLength + characters[dropped].length <= leadingTags) {
    prefixLength += characters[dropped++].length;
  }
  const chunks = [];
  let base = 0;
  for (let start = 0; start < characters.length;) {
    const end = Math.min(characters.length, Math.max(start + 8 + Math.floor(random() * 17),
      start === 0 ? dropped + 1 : 0));
    const first = start === 0 ? dropped : start;
    chunks.push({
      chars: characters.slice(first, end),
      char_start_times_ms: starts.slice(first, end).map(time => (time - base) * 1000),
      char_durations_ms: ends.slice(first, end).map((time, i) => (time - starts[first + i]) * 1000)
    });
    // Retain the missing tag's time in the first chunk, and preserve silence
    // between characters. Audio and alignment deliberately have separate cuts.
    base = Math.max(...ends.slice(start, end));
    start = end;
  }
  return { audio, alignment: chunks, sampleCount: samples.length };
}

export function compareSimulation(line, metrics) {
  const maxTimingError = (expected, actual) => expected.length === actual.length
    ? expected.reduce((max, item, i) => Math.max(max, Math.abs(item.start - actual[i].start) * 1000), 0)
    : null;
  const shapeValuesMatch = line.shapes.length === metrics.shapes.length &&
    line.shapes.every((item, i) => MOUTH_CHANNELS.every(key =>
      item.shape[key] === metrics.shapes[i].shape[key]));
  const count = Math.min(line.envelope.length, metrics.envelope.length);
  let envelopeDifference = 0, largestSeamSamples = 0, largestGapMismatchMs = 0, accumulatedGap = 0;
  for (let i = 0; i < count; i++) envelopeDifference += Math.abs(line.envelope[i] - metrics.envelope[i]);
  for (let i = 0; i < metrics.segments.length; i++) {
    const segment = metrics.segments[i];
    if (i) {
      const previous = metrics.segments[i - 1];
      accumulatedGap += Math.max(0, segment.start - previous.end);
      largestSeamSamples = Math.max(largestSeamSamples,
        Math.abs(segment.start - previous.end) * SAMPLE_RATE);
    }
    const mappedShift = segment.start - metrics.startedAt - segment.timelineStart;
    largestGapMismatchMs = Math.max(largestGapMismatchMs,
      Math.abs(mappedShift - accumulatedGap) * 1000);
  }
  return {
    interrupted: metrics.interrupted,
    underruns: metrics.underruns,
    audioChunks: metrics.segments.length,
    shapeMaxMs: maxTimingError(line.shapes, metrics.shapes),
    shapeValuesMatch,
    wordMaxMs: maxTimingError(line.words, metrics.words),
    envelopeMeanAbsoluteDifference: count ? envelopeDifference / count : null,
    envelopeFramesCompared: count,
    largestSeamSamples,
    largestGapMismatchMs
  };
}

export function startLiveSimulation(voice, line, { slowNetwork = false, random = Math.random } = {}) {
  const packets = prepareSimulation(line, { random });
  const reply = voice.stream.begin();
  const timers = new Set();
  let cancelled = false, delivered = 0;
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const total = packets.audio.length + packets.alignment.length;
  const clearTimers = () => { for (const timer of timers) clearTimeout(timer); timers.clear(); };
  const finish = () => resolveDone(compareSimulation(line, reply.inspect()));

  function deliver(kind, packet, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (cancelled) return;
      try {
        if (kind === 'audio') reply.addAudio(packet.base64);
        else reply.addAlignment(packet);
        if (++delivered === total) Promise.resolve(reply.end()).then(finish, rejectDone);
      } catch (error) {
        cancelled = true;
        clearTimers();
        reply.interrupt();
        rejectDone(error);
      }
    }, delay * 1000);
    timers.add(timer);
  }

  reply.setText(line.text);
  let audioArrival = 0;
  packets.audio.forEach((packet, i) => {
    if (i) audioArrival += slowNetwork
      ? packets.audio[i - 1].duration * (1.3 + random() * 0.3) + 0.12 + random() * 0.05
      : packets.audio[i - 1].duration * (0.08 + random() * 0.06) + 0.005 + random() * 0.01;
    deliver('audio', packet, audioArrival);
  });
  const alignmentSpan = 0.3 + random() * 1.9;
  const intervals = packets.alignment.map(() => 0.5 + random());
  const intervalTotal = intervals.slice(1).reduce((sum, value) => sum + value, 0);
  let alignmentArrival = 0, alignmentOffset = 0;
  packets.alignment.forEach((packet, i) => {
    if (i) alignmentArrival += alignmentSpan * intervals[i] / intervalTotal;
    // A normal connection must deliver each partial word before its first
    // character can drive the face. Keep one frame ahead of the player's
    // 30 ms lookahead, allowing for its 100 ms initial audio lead.
    const firstCharacter = alignmentOffset + Math.min(...packet.char_start_times_ms) / 1000;
    const deadline = Math.max(0, firstCharacter + 0.1 - 0.03 - 1 / 60);
    deliver('alignment', packet, Math.min(alignmentArrival, deadline));
    alignmentOffset += Math.max(...packet.char_start_times_ms.map((start, j) =>
      (start + packet.char_durations_ms[j]) / 1000));
  });
  if (!total) Promise.resolve(reply.end()).then(finish, rejectDone);

  return {
    done,
    inspect: () => reply.inspect(),
    interrupt() {
      if (cancelled) return;
      cancelled = true;
      clearTimers();
      reply.interrupt();
      finish();
    }
  };
}
