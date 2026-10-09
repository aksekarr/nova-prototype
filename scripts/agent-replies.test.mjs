import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentReplies } from '../js/agent-replies.js';

function setup() {
  const handles = [], texts = [];
  const stream = { begin() {
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const handle = { audio: [], alignment: [], text: [], ends: 0, interruptions: 0, finish,
      addAudio(chunk) { this.audio.push(chunk); },
      addAlignment(chunk) { this.alignment.push(chunk); },
      setText(text) { this.text.push(text); },
      end() { this.ends++; return done; },
      interrupt() { this.interruptions++; finish(); }
    };
    handles.push(handle);
    return handle;
  } };
  return { handles, texts, router: createAgentReplies({ stream, onReplyText: text => texts.push(text) }) };
}
const audio = (id, chunk = 'synthetic-pcm', alignment) => ({ type: 'audio',
  audio_event: { event_id: id, audio_base_64: chunk, alignment } });
const message = (id, text, response_id) => ({ type: 'agent_response',
  agent_response_event: { event_id: id, agent_response: text, response_id } });
const complete = id => ({ type: 'agent_response_complete', agent_response_complete_event: { event_id: id } });
const interruption = id => ({ type: 'interruption', interruption_event: { event_id: id } });

test('audio and alignment retain one reply through playback gaps until provider completion', () => {
  const { router, handles, texts } = setup();
  router.accept(message(10, 'A synthetic reply.'));
  assert.equal(handles.length, 0);
  const alignment = { chars: ['A'], char_start_times_ms: [0], char_durations_ms: [80] };
  router.accept(audio(10, 'first', alignment));
  assert.equal(router.replyOpen, true);
  assert.deepEqual(texts, ['A synthetic reply.']);
  for (const event of [{ type: 'mode_change', mode: 'listening' },
    { type: 'process', finished: true }, { type: 'ping', ping_event: { event_id: 900 } },
    { type: 'agent_chat_response_part', text_response_part: { type: 'stop', event_id: 10 } }]) {
    assert.equal(router.accept(event), false);
  }
  router.accept(audio(10, 'after-gap'));
  assert.equal(handles.length, 1);
  assert.deepEqual(handles[0].audio, ['first', 'after-gap']);
  assert.deepEqual(handles[0].alignment, [alignment]);
  assert.equal(handles[0].ends, 0);
  router.accept(complete(10));
  assert.equal(handles[0].ends, 1);
  assert.equal(router.replyOpen, false);
});

test('text arriving after PCM updates its handle without restarting audio', () => {
  const { router, handles } = setup();
  router.accept(audio(2));
  router.accept(message(2, 'First message.', 'first'));
  router.accept(message(2, 'First message.', 'first'));
  router.accept(message(3, 'Following a tool call.', 'second'));
  assert.equal(handles.length, 1);
  assert.equal(handles[0].text.at(-1), 'First message. Following a tool call.');
  router.accept(message(2, 'Corrected first message.', 'first'));
  assert.equal(handles[0].text.at(-1), 'Corrected first message. Following a tool call.');
});

test('text without response IDs is deduplicated without losing distinct messages', () => {
  const { router, handles } = setup();
  router.accept(message(5, 'One.'));
  router.accept(message(5, 'One.'));
  router.accept(message(5, 'Two.'));
  router.accept(audio(5));
  assert.deepEqual(handles[0].text, ['One. Two.']);
});

test('interruption discards late audio, alignment, text and completion below its cutoff', () => {
  const { router, handles } = setup();
  router.accept(audio(10));
  router.accept(interruption(20));
  assert.equal(handles[0].interruptions, 1);
  assert.equal(router.replyOpen, false);
  for (const event of [audio(10, 'old', { chars: ['X'] }), message(10, 'Obsolete.'), complete(10), interruption(15)]) {
    assert.equal(router.accept(event), false);
  }
  router.accept(audio(20, 'current'));
  assert.equal(handles.length, 2, 'the SDK accepts audio at the interruption boundary');
  assert.deepEqual(handles[1].audio, ['current']);
  assert.equal(router.accept(interruption(20)), false, 'duplicate interruption cannot cancel resumed output');
  assert.equal(handles[1].interruptions, 0);
  assert.equal(router.accept(complete(19)), false);
  assert.equal(handles[1].ends, 0);
});

test('duplicate completion and late old events cannot touch the next reply', async () => {
  const { router, handles } = setup();
  router.accept(audio(4));
  router.accept(complete(4));
  assert.equal(router.accept(complete(4)), false);
  assert.equal(router.accept(audio(4, 'late')), false);
  assert.equal(router.accept(message(4, 'Late text.')), false);
  router.accept(audio(5, 'next'));
  assert.equal(handles.length, 2);
  assert.equal(router.accept(complete(4)), false);
  assert.equal(router.accept(interruption(4)), false);
  handles[0].finish();
  await Promise.resolve();
  assert.equal(router.replyOpen, true);
  assert.equal(handles[1].ends, 0);
  assert.equal(handles[1].interruptions, 0);
  router.accept(complete(5));
  assert.equal(handles[1].ends, 1);
});

test('a stale boundary cannot close or interrupt output with a newer event ID', () => {
  const { router, handles } = setup();
  router.accept(audio(20));
  assert.equal(router.accept(complete(19)), false);
  assert.equal(router.accept(interruption(19)), false);
  assert.equal(router.replyOpen, true);
  assert.equal(handles[0].ends, 0);
  assert.equal(handles[0].interruptions, 0);
});

test('a text-only completed turn does not leak its pending text into the next audio', () => {
  const { router, handles, texts } = setup();
  router.accept(message(8, 'No audio for this turn.'));
  router.accept(complete(8));
  router.accept(audio(9));
  assert.equal(handles.length, 1);
  assert.deepEqual(handles[0].text, []);
  assert.deepEqual(texts, [null]);
});

test('reset stops active and draining handles and allows a fresh session with lower IDs', async () => {
  const { router, handles } = setup();
  router.accept(audio(50));
  router.accept(complete(50));
  router.accept(audio(51));
  router.reset();
  assert.equal(router.replyOpen, false);
  assert.equal(handles[0].interruptions, 1);
  assert.equal(handles[1].interruptions, 1);
  router.accept(audio(1));
  await Promise.resolve();
  assert.equal(router.replyOpen, true);
  assert.equal(handles[2].interruptions, 0);
});

test('local interrupt rejects the cancelled reply while allowing newer output', () => {
  const { router, handles } = setup();
  router.accept(audio(10));
  router.interrupt();
  assert.equal(handles[0].interruptions, 1);
  assert.equal(router.accept(audio(10)), false);
  assert.equal(router.accept(message(10, 'Late.')), false);
  router.accept(audio(11));
  assert.equal(handles.length, 2);
});

test('malformed events and user transcripts never create a reply', () => {
  const { router, handles, texts } = setup();
  for (const event of [null, {}, audio(NaN), audio(-1), audio(1, ''), audio('2'),
    { type: 'audio' }, message(1, null), complete(Infinity), interruption('2'),
    { type: 'user_transcript', user_transcription_event: { event_id: 1, user_transcript: 'Not retained.' } }]) {
    assert.equal(router.accept(event), false);
  }
  assert.equal(handles.length, 0);
  assert.deepEqual(texts, []);
});
