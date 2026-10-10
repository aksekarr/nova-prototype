import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandingCapture } from '../js/landing-capture.js';
import { createAgentReplies } from '../js/agent-replies.js';
import { parseCapture } from '../js/capture.js';

function setup() {
  const element = extra => ({ disabled: false, textContent: '', events: {},
    addEventListener(type, callback) { this.events[type] = callback; }, ...extra });
  const controls = { capture: element({ checked: true }), download: element(), text: element() };
  const blobs = [], links = [], revoked = [], timers = [];
  const host = { Blob, URL: {
    createObjectURL(blob) { blobs.push(blob); return `blob:synthetic-${blobs.length}`; },
    revokeObjectURL(url) { revoked.push(url); }
  }, document: { body: { append(link) { links.push(link); } }, createElement(tag) {
    assert.equal(tag, 'a');
    return { click() { this.clicked = true; }, remove() { this.removed = true; } };
  } }, setTimeout(callback) { timers.push(callback); } };
  let current;
  const handles = [];
  const stream = { begin() {
    current?.interrupt();
    let finished = false, interrupted = false, resolve;
    const done = new Promise(r => { resolve = r; });
    current = { setText() {}, addAudio() {}, addAlignment() {},
      end() { return done; },
      finish() { finished = true; resolve(); },
      interrupt() { if (!finished) { finished = interrupted = true; resolve(); } },
      inspect() { return { finished, interrupted }; }
    };
    handles.push(current);
    return current;
  } };
  for (const type of ['setText', 'addAudio', 'addAlignment', 'end', 'interrupt']) {
    stream[type] = (...args) => current?.[type](...args);
  }
  createLandingCapture({ stream, controls, host });
  return { controls, blobs, links, revoked, timers, handles,
    router: createAgentReplies({ stream }) };
}
const message = (id, text, responseId) => ({ type: 'agent_response',
  agent_response_event: { event_id: id, agent_response: text, response_id: responseId } });
const audio = (id, data = 'AAA=', alignment) => ({ type: 'audio',
  audio_event: { event_id: id, audio_base_64: data, alignment } });
const complete = id => ({ type: 'agent_response_complete', agent_response_complete_event: { event_id: id } });

test('main capture exports corrected reply text and replay data after local audio drains, excluding user speech', async () => {
  const h = setup();
  assert.equal(h.controls.download.disabled, true);
  assert.equal(h.controls.text.disabled, true);
  h.controls.download.events.click();
  assert.equal(h.blobs.length, 0);
  h.router.accept({ type: 'user_transcript', user_transcription_event: {
    event_id: 9, user_transcript: 'Synthetic user speech must not be retained.'
  } });
  h.router.accept(message(10, 'First wording.', 'first'));
  h.router.accept(audio(10, 'AAA=', { chars: ['H'], char_start_times_ms: [0], char_durations_ms: [50] }));
  h.router.accept(message(10, 'Corrected wording.', 'first'));
  h.router.accept(message(11, 'Second sentence.', 'second'));
  h.router.accept(audio(11, 'AQA='));
  h.router.accept(complete(11));
  assert.equal(h.controls.download.disabled, true, 'provider completion alone does not finish local playback');
  h.handles[0].finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(h.controls.download.textContent, 'Download captures (1)');
  assert.equal(h.controls.text.disabled, false);
  h.controls.download.events.click();
  h.controls.text.events.click();
  const json = await h.blobs[0].text();
  const capture = parseCapture(json);
  assert.equal(capture.replies.length, 1);
  assert.equal(capture.replies[0].text, 'Corrected wording. Second sentence.');
  assert.deepEqual(capture.replies[0].events.filter(event => event.type === 'addAudio').map(event => event.data), ['AAA=', 'AQA=']);
  assert.equal(json.includes('Synthetic user speech'), false);
  const text = await h.blobs[1].text();
  assert.ok(text.includes('Reply 1\nCorrected wording. Second sentence.'));
  assert.equal(text.includes('AAA='), false);
  assert.match(h.links[0].download, /^nova-captures-.*\.json$/);
  assert.match(h.links[1].download, /^seni-replies-.*\.txt$/);
  assert.ok(h.links.every(link => link.clicked && link.removed));
  h.timers.forEach(callback => callback());
  assert.deepEqual(h.revoked, ['blob:synthetic-1', 'blob:synthetic-2']);
});

test('ending a conversation retains its interrupted reply; capture can pause and resume across sessions', async () => {
  const h = setup();
  h.router.accept(message(50, 'A reply cut short.'));
  h.router.accept(audio(50));
  h.controls.capture.checked = false;
  h.controls.capture.events.change();
  h.router.reset();
  assert.equal(h.controls.download.textContent, 'Download captures (1)');
  h.router.accept(message(1, 'This session is not captured.'));
  h.router.accept(audio(1));
  h.router.accept(complete(1));
  h.handles[1].finish();
  await Promise.resolve();
  assert.equal(h.controls.download.textContent, 'Download captures (1)');
  h.controls.capture.checked = true;
  h.controls.capture.events.change();
  h.router.reset();
  h.router.accept(message(1, 'Capture resumed.'));
  h.router.accept(audio(1));
  h.router.accept(complete(1));
  h.handles[2].finish();
  await Promise.resolve();
  await Promise.resolve();
  h.controls.download.events.click();
  h.controls.text.events.click();
  const capture = parseCapture(await h.blobs[0].text());
  assert.deepEqual(capture.replies.map(reply => [reply.text, reply.interrupted]), [
    ['A reply cut short.', true], ['Capture resumed.', false]
  ]);
  const text = await h.blobs[1].text();
  assert.ok(text.includes('Reply 1 (interrupted)'));
  assert.equal(text.includes('This session is not captured.'), false);
});
