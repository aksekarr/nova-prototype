import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaptureRecorder, parseCapture } from '../js/capture.js';
import { compareSimulation } from '../js/livesim.js';
import { MOUTH_CHANNELS } from '../js/speech-mouth.js';

function makeStream() {
  let current = null, inspections = 0;
  const handles = [];
  const stream = {
    begin() {
      current?.interrupt();
      let finished = false, interrupted = false;
      const calls = [];
      current = {
        calls,
        setText(value) { calls.push(['setText', value]); },
        addAudio(value) { calls.push(['addAudio', value]); },
        addAlignment(value) { calls.push(['addAlignment', value]); },
        end() { finished = true; calls.push(['end']); return Promise.resolve(); },
        interrupt() { if (!finished) { finished = interrupted = true; calls.push(['interrupt']); } },
        inspect() { inspections++; return { finished, interrupted }; }
      };
      handles.push(current);
      return current;
    }
  };
  for (const key of ['setText', 'addAudio', 'addAlignment', 'end', 'interrupt']) {
    stream[key] = (...args) => current?.[key](...args);
  }
  return { stream, handles, get inspections() { return inspections; } };
}

test('disabled capture leaves playback handles unchanged and never inspects packets', async () => {
  const fixture = makeStream(), recorder = createCaptureRecorder(fixture.stream);
  const reply = fixture.stream.begin();
  assert.equal(reply, fixture.handles[0]);
  reply.setText('Synthetic test');
  for (let i = 0; i < 10; i++) fixture.stream.addAudio('AAA=');
  await reply.end();
  fixture.stream.begin();
  assert.equal(recorder.count, 0);
  assert.deepEqual(recorder.snapshot().replies, []);
  assert.equal(fixture.inspections, 0);
  assert.equal(fixture.handles[0].calls.filter(([type]) => type === 'addAudio').length, 10);
});

test('enabled capture retains valid transport events and owns copies of packet data', async () => {
  const fixture = makeStream(), recorder = createCaptureRecorder(fixture.stream);
  recorder.setEnabled(true);
  const reply = fixture.stream.begin();
  reply.setText('Hi');
  const alignment = { chars: ['H', 'i'], char_start_times_ms: [0, 50], char_durations_ms: [50, 50] };
  reply.addAlignment(alignment);
  alignment.chars[0] = 'X';
  fixture.stream.addAudio('AAA=');
  await fixture.stream.end();
  const session = parseCapture(recorder.snapshot());
  assert.equal(session.replies.length, 1);
  const captured = session.replies[0];
  assert.deepEqual(captured.events.map(event => event.type), ['begin', 'setText', 'addAlignment', 'addAudio', 'end']);
  assert.equal(captured.events[2].data.chars[0], 'H');
  assert.equal(captured.text, 'Hi');
  assert.equal(captured.interrupted, false);
});

test('disabling capture finishes the selected reply, then bypasses the next reply', async () => {
  const fixture = makeStream(), recorder = createCaptureRecorder(fixture.stream);
  recorder.setEnabled(true);
  const captured = fixture.stream.begin();
  captured.setText('Synthetic first reply');
  recorder.setEnabled(false);
  await captured.end();
  const before = fixture.inspections;
  const uncaptured = fixture.stream.begin();
  uncaptured.addAudio('AAA=');
  await uncaptured.end();
  assert.equal(uncaptured, fixture.handles[1]);
  assert.equal(recorder.count, 1);
  assert.equal(fixture.inspections, before);
  assert.equal(parseCapture(recorder.snapshot()).replies[0].text, 'Synthetic first reply');
});

test('replacing a captured reply records its interruption before the next begins', async () => {
  const fixture = makeStream(), recorder = createCaptureRecorder(fixture.stream);
  recorder.setEnabled(true);
  fixture.stream.begin().setText('First');
  const second = fixture.stream.begin();
  second.setText('Second');
  await second.end();
  const { replies } = parseCapture(recorder.snapshot());
  assert.equal(replies.length, 2);
  assert.equal(replies[0].interrupted, true);
  assert.equal(replies[0].events.at(-1).type, 'interrupt');
  assert.equal(replies[1].interrupted, false);
});

test('simulation comparison detects a mismatch in every mouth channel', () => {
  const shape = Object.fromEntries(MOUTH_CHANNELS.map(key => [key, 0]));
  const line = { shapes: [{ start: 0, shape }], words: [], envelope: [] };
  const metrics = { shapes: [{ start: 0, shape: { ...shape } }], words: [], envelope: [],
    segments: [], startedAt: 0, interrupted: false, underruns: 0 };
  assert.equal(compareSimulation(line, metrics).shapeValuesMatch, true);
  for (const key of MOUTH_CHANNELS) {
    metrics.shapes[0].shape = { ...shape, [key]: 1 };
    assert.equal(compareSimulation(line, metrics).shapeValuesMatch, false, key);
  }
});
