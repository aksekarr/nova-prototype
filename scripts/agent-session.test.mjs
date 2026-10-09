import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentSession } from '../js/agent-session.js';

const CONFIG = { agentId: 'synthetic-test-only' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const trackStream = () => {
  const track = { enabled: true, stops: 0, stop() { this.stops++; } };
  return { track, getTracks: () => [track] };
};
async function until(predicate, message = 'expected synthetic setup phase') {
  for (let i = 0; i < 40 && !predicate(); i++) await Promise.resolve();
  assert.ok(predicate(), message);
}
const audio = (id, chunk = 'synthetic-pcm', alignment) => ({ type: 'audio',
  audio_event: { event_id: id, audio_base_64: chunk, alignment } });
const complete = id => ({ type: 'agent_response_complete', agent_response_complete_event: { event_id: id } });

function setup(t, { permissions = [deferred()], loaderGate, connectionGate,
  afterPermissionGate, afterConnectionGate, failContextAt = 0, failInputAfterOutput = false, outputFormat } = {}) {
  let permissionCalls = 0, clientLoads = 0, contextAttempts = 0, audible = false;
  const started = [], sockets = [], connections = [], conversations = [], contexts = [], audioElements = [];
  const handles = [], texts = [], changes = [], flushes = [];
  const media = { getUserMedia() { return permissions[permissionCalls++].promise; } };
  const originalMedia = media.getUserMedia;
  const host = {
    WebSocket: class {
      constructor() { this.closes = 0; sockets.push(this); }
      close() { this.closes++; }
    },
    Audio: class {
      constructor() { this.muted = false; this.attached = false; this.pauses = 0; this.srcObject = null; audioElements.push(this); }
      pause() { this.pauses++; }
      remove() { this.attached = false; }
    },
    AudioContext: class {
      constructor() {
        if (++contextAttempts === failContextAt) throw new Error('synthetic context failure');
        this.state = 'running'; this.closes = 0; contexts.push(this);
      }
      close() { this.closes++; this.state = 'closed'; return Promise.resolve(); }
    }
  };
  host.webkitAudioContext = host.AudioContext;
  const nativeSocket = host.WebSocket, nativeContext = host.AudioContext, nativeAudio = host.Audio;
  const client = {
    WebSocketConnection: { create() {
      const socket = new host.WebSocket();
      const connection = {
        closes: 0, outputFormat: outputFormat || { format: 'pcm', sampleRate: 44100 },
        pendingAudioEvents: [audio(1, 'queued')], delivered: [],
        close() { this.closes++; socket.close(); },
        addListener(listener) { this.pendingAudioEvents.splice(0).forEach(listener); },
        removeListener() {},
        handleMessage(event) { this.delivered.push(event); }
      };
      connections.push(connection);
      return connectionGate ? connectionGate.promise.then(() => connection) : Promise.resolve(connection);
    } },
    Conversation: { async startSession(options) {
      started.push(options);
      const stream = await media.getUserMedia({ audio: true });
      if (afterPermissionGate) await afterPermissionGate.promise;
      const connection = await client.WebSocketConnection.create({});
      if (afterConnectionGate) await afterConnectionGate.promise;
      const inputContext = new host.AudioContext();
      const outputContext = new host.webkitAudioContext();
      const audioElement = new host.Audio();
      audioElement.attached = true;
      audioElement.srcObject = { syntheticOutput: true };
      if (failInputAfterOutput) throw new Error('synthetic input failure after output was created');
      const conversation = {
        input: { inputStream: stream, context: inputContext },
        output: { audioElement, context: outputContext },
        volume: 1, micCalls: [], ends: 0,
        setVolume({ volume }) { this.volume = volume; },
        setMicMuted(value) { this.micCalls.push(value); },
        endSession() { this.ends++; return Promise.resolve(); }
      };
      conversations.push(conversation);
      connection.addListener(() => flushes.push({ volume: conversation.volume,
        muted: conversation.output.audioElement.muted }));
      options.onConversationCreated(conversation);
      options.onConnect();
      return conversation;
    } }
  };
  const originalConnection = client.WebSocketConnection.create;
  const voice = { stream: {
    isAudible: () => audible,
    begin() {
      const drained = deferred();
      const handle = { audio: [], alignment: [], text: [], ends: 0, interruptions: 0,
        addAudio(chunk) { this.audio.push(chunk); }, addAlignment(value) { this.alignment.push(value); },
        setText(value) { this.text.push(value); },
        end() { this.ends++; return drained.promise; },
        interrupt() { this.interruptions++; drained.resolve(); }, finish: drained.resolve
      };
      handles.push(handle); return handle;
    }
  } };
  const flow = createAgentSession({ host, media, voice,
    onChange: state => changes.push(state), onReplyText: text => texts.push(text),
    clientLoader() { clientLoads++; return loaderGate ? loaderGate.promise.then(() => client) : client; }
  });
  t.after(() => flow.stop());
  return { flow, host, media, client, permissions, started, sockets, connections, conversations,
    contexts, audioElements, handles, texts, changes, flushes, originalMedia, originalConnection, nativeSocket, nativeContext, nativeAudio,
    get permissionCalls() { return permissionCalls; }, get clientLoads() { return clientLoads; },
    set audible(value) { audible = value; },
    async start() {
      const count = started.length, completed = flow.start(CONFIG);
      await until(() => started.length > count);
      return { completed };
    },
    async connect() {
      const { completed } = await this.start(), granted = trackStream();
      permissions[permissionCalls - 1].resolve(granted);
      assert.deepEqual(await completed, { status: 'connected' });
      return granted;
    },
    assertRestored() {
      assert.equal(media.getUserMedia, originalMedia);
      assert.equal(client.WebSocketConnection.create, originalConnection);
      assert.equal(host.WebSocket, nativeSocket);
      assert.equal(host.Audio, nativeAudio);
      assert.equal(host.AudioContext, nativeContext);
      assert.equal(host.webkitAudioContext, nativeContext);
    }
  };
}

test('constructing and preparing never requests the microphone or opens a session', async t => {
  const h = setup(t);
  assert.deepEqual(h.flow.state, { status: 'idle', speaking: false, micMuted: false, error: null });
  assert.equal(h.clientLoads, 0);
  assert.deepEqual(await h.flow.prepare(), { status: 'prepared' });
  assert.deepEqual(await h.flow.prepare(), { status: 'prepared' });
  assert.equal(h.clientLoads, 1);
  assert.equal(h.permissionCalls, 0);
  assert.equal(h.sockets.length, 0);
  h.assertRestored();
});

test('a duplicate Start shares one setup and invalid configuration never requests access', async t => {
  const h = setup(t);
  assert.deepEqual(await h.flow.start({ agentId: 'invalid value!' }), { status: 'unavailable' });
  assert.equal(h.permissionCalls, 0);
  assert.equal(h.clientLoads, 0);
  const first = h.flow.start(CONFIG), second = h.flow.start(CONFIG);
  assert.equal(first, second);
  await until(() => h.started.length === 1);
  h.permissions[0].resolve(trackStream());
  assert.deepEqual(await first, { status: 'connected' });
  assert.equal(h.permissionCalls, 1);
  assert.equal(h.flow.state.status, 'connected');
  h.assertRestored();
});

test('SDK output is muted in both ways before any queued output listener runs', async t => {
  const h = setup(t);
  await h.connect();
  assert.deepEqual(h.flushes, [{ volume: 0, muted: true }]);
  const options = h.started[0];
  assert.equal(options.connectionType, 'websocket');
  assert.equal(options.useWakeLock, false);
  assert.ok(options.libsampleratePath.startsWith('data:'), 'optional resampling cannot fetch a remote dependency');
  assert.equal(h.conversations[0].micCalls.at(-1), false);
});

test('microphone mute gates captured tracks synchronously and unmutes them explicitly', async t => {
  const h = setup(t), granted = await h.connect();
  h.flow.setMicMuted(true);
  assert.equal(granted.track.enabled, false);
  assert.equal(h.flow.state.micMuted, true);
  assert.equal(h.conversations[0].micCalls.at(-1), true);
  h.flow.setMicMuted(false);
  assert.equal(granted.track.enabled, true);
  assert.equal(h.conversations[0].micCalls.at(-1), false);
  h.flow.stop();
  assert.equal(granted.track.stops, 1);
  assert.equal(h.conversations[0].ends, 1);
  await until(() => h.contexts.every(context => context.state === 'closed'));
  assert.deepEqual(h.flow.state, { status: 'idle', speaking: false, micMuted: false, error: null });
});

test('speaking follows audible local playback, while raw completion keeps network gaps in one reply', async t => {
  const h = setup(t);
  await h.connect();
  const incoming = h.started[0].onIncomingEvent;
  incoming({ type: 'agent_response', agent_response_event: { event_id: 2, agent_response: 'Synthetic reply.' } });
  const alignment = { chars: ['S'], char_start_times_ms: [0], char_durations_ms: [80] };
  incoming(audio(2, 'first', alignment));
  h.flow.onFrame();
  assert.equal(h.flow.state.speaking, false, 'provider audio arrival alone is not audible speech');
  h.audible = true; h.flow.onFrame();
  assert.equal(h.flow.state.speaking, true);
  incoming({ type: 'mode_change', mode: 'listening' });
  incoming({ type: 'process', finished: true });
  h.audible = false; h.flow.onFrame();
  incoming(audio(2, 'after-gap'));
  assert.equal(h.handles.length, 1);
  assert.deepEqual(h.handles[0].audio, ['first', 'after-gap']);
  assert.deepEqual(h.handles[0].alignment, [alignment]);
  assert.deepEqual(h.handles[0].text, ['Synthetic reply.']);
  assert.equal(h.handles[0].ends, 0);
  incoming(complete(2));
  assert.equal(h.handles[0].ends, 1);
  incoming(audio(3, 'next-turn'));
  assert.equal(h.handles.length, 2);
  h.flow.stop();
  assert.ok(h.handles.every(handle => handle.interruptions === 1));
});

test('Stop during permission closes late grants and restores hooks immediately', async t => {
  const h = setup(t), { completed } = await h.start();
  h.flow.stop();
  assert.deepEqual(await completed, { status: 'stopped' });
  assert.equal(h.flow.state.status, 'idle');
  h.assertRestored();
  const late = trackStream();
  h.permissions[0].resolve(late);
  await until(() => late.track.stops === 1);
  assert.equal(h.connections.length, 0);
  assert.equal(h.conversations.length, 0);
});

test('Stop during client loading never opens a microphone when the client arrives late', async t => {
  const loaderGate = deferred(), h = setup(t, { loaderGate });
  const completed = h.flow.start(CONFIG);
  await until(() => h.clientLoads === 1);
  h.flow.stop();
  assert.deepEqual(await completed, { status: 'stopped' });
  loaderGate.resolve();
  await h.flow.prepare();
  assert.equal(h.started.length, 0);
  assert.equal(h.permissionCalls, 0);
  assert.equal(h.flow.state.status, 'idle');
  h.assertRestored();
});

test('Stop closes a pending socket and its late result cannot create audio IO', async t => {
  const connectionGate = deferred(), h = setup(t, { connectionGate });
  const { completed } = await h.start(), granted = trackStream();
  h.permissions[0].resolve(granted);
  await until(() => h.connections.length === 1);
  assert.equal(h.host.WebSocket, h.nativeSocket);
  h.flow.stop();
  assert.deepEqual(await completed, { status: 'stopped' });
  assert.equal(h.sockets[0].closes, 1);
  assert.equal(granted.track.stops, 1);
  connectionGate.resolve();
  await until(() => h.connections[0].closes === 1);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.conversations.length, 0);
  h.assertRestored();
});

test('Stop inside an SDK wait keeps guards until continuation unwinds and cannot reopen IO', async t => {
  const afterPermissionGate = deferred(), h = setup(t, { afterPermissionGate });
  const { completed } = await h.start(), granted = trackStream();
  h.permissions[0].resolve(granted);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  h.flow.stop();
  assert.deepEqual(await completed, { status: 'stopped' });
  assert.equal(granted.track.stops, 1);
  assert.notEqual(h.client.WebSocketConnection.create, h.originalConnection);
  assert.deepEqual(await h.flow.start(CONFIG), { status: 'unavailable' });
  assert.equal(h.started.length, 1, 'internal SDK waits cannot overlap another setup');
  afterPermissionGate.resolve();
  await until(() => h.client.WebSocketConnection.create === h.originalConnection);
  assert.equal(h.sockets.length, 0);
  assert.equal(h.contexts.length, 0);
  h.assertRestored();
});

test('Stop after connection but before IO prevents delayed AudioContext construction', async t => {
  const afterConnectionGate = deferred(), h = setup(t, { afterConnectionGate });
  const { completed } = await h.start();
  h.permissions[0].resolve(trackStream());
  await until(() => h.connections.length === 1);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  h.flow.stop();
  assert.deepEqual(await completed, { status: 'stopped' });
  afterConnectionGate.resolve();
  await until(() => h.host.AudioContext === h.nativeContext);
  assert.equal(h.contexts.length, 0);
  assert.equal(h.conversations.length, 0);
  assert.ok(h.sockets[0].closes > 0);
  h.assertRestored();
});

test('failed partial audio IO closes the context already created and restores both constructor aliases', async t => {
  const h = setup(t, { failContextAt: 2 }), { completed } = await h.start(), granted = trackStream();
  h.permissions[0].resolve(granted);
  assert.deepEqual(await completed, { status: 'unavailable' });
  assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0].state, 'closed');
  assert.equal(h.contexts[0].closes, 1);
  assert.equal(granted.track.stops, 1);
  assert.ok(h.sockets[0].closes > 0);
  assert.equal(h.flow.state.error, 'Seni could not connect. Please try again.');
  h.assertRestored();
});

test('permission errors use fixed safe copy and restore setup resources', async t => {
  const h = setup(t), { completed } = await h.start();
  h.permissions[0].reject(Object.assign(new Error('sensitive synthetic provider detail'), { name: 'NotAllowedError' }));
  assert.deepEqual(await completed, { status: 'unavailable' });
  assert.equal(h.flow.state.error, 'Microphone access was denied. Allow it in your browser, then try again.');
  assert.ok(!JSON.stringify(h.changes).includes('sensitive'));
  h.assertRestored();
});

test('queue admission failure and provider errors never expose raw payloads', async t => {
  const h = setup(t);
  await h.connect();
  h.started[0].onIncomingEvent({ type: 'queue_status', queue_status_event: { status: 'waiting', detail: 'sensitive' } });
  assert.equal(h.flow.state.status, 'error');
  assert.equal(h.flow.state.error, 'Seni is busy right now. Please try again shortly.');
  assert.equal(h.conversations[0].ends, 1);
  assert.ok(!JSON.stringify(h.changes).includes('sensitive'));
});

test('unsupported provider audio closes before constructing output and restores setup', async t => {
  const h = setup(t, { outputFormat: { format: 'mp3', sampleRate: 44100 } });
  const { completed } = await h.start();
  h.permissions[0].resolve(trackStream());
  assert.deepEqual(await completed, { status: 'unavailable' });
  assert.equal(h.connections[0].closes, 1);
  assert.equal(h.contexts.length, 0);
  h.assertRestored();
});

test('late cancelled setup cannot restore newer hooks or let its callbacks affect a fresh session', async t => {
  const h = setup(t, { permissions: [deferred(), deferred()] });
  const first = await h.start(), oldCallbacks = h.started[0];
  h.flow.stop();
  assert.deepEqual(await first.completed, { status: 'stopped' });
  const second = await h.start(), newHook = h.media.getUserMedia;
  const late = trackStream();
  h.permissions[0].resolve(late);
  await until(() => late.track.stops === 1);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(h.media.getUserMedia, newHook, 'old cleanup cannot restore a hook owned by the new session');
  const granted = trackStream();
  h.permissions[1].resolve(granted);
  assert.deepEqual(await second.completed, { status: 'connected' });
  for (const callback of [() => oldCallbacks.onConnect(),
    () => oldCallbacks.onError(new Error('obsolete')),
    () => oldCallbacks.onDisconnect({ reason: 'error' }),
    () => oldCallbacks.onIncomingEvent(audio(88, 'obsolete'))]) callback();
  assert.equal(h.flow.state.status, 'connected');
  assert.equal(h.flow.state.error, null);
  assert.equal(granted.track.stops, 0);
  assert.equal(h.conversations[0].ends, 0);
  assert.equal(h.handles.length, 0);
  h.assertRestored();
});

test('connection guard drops obsolete PCM and clears queued output at interruption', async t => {
  const h = setup(t);
  await h.connect();
  const connection = h.connections[0];
  connection.pendingAudioEvents.push(audio(4, 'obsolete'));
  const interruption = { type: 'interruption', interruption_event: { event_id: 10 } };
  connection.handleMessage(interruption);
  connection.handleMessage(audio(9, 'obsolete'));
  const current = audio(10, 'current');
  connection.handleMessage(current);
  assert.deepEqual(connection.pendingAudioEvents, []);
  assert.deepEqual(connection.delivered, [interruption, current]);
  h.flow.stop();
  connection.handleMessage(audio(11, 'after-stop'));
  assert.deepEqual(connection.delivered, [interruption, current]);
});


test('muting before permission arrives disables the late track before SDK IO begins', async t => {
  const afterPermissionGate = deferred(), h = setup(t, { afterPermissionGate });
  const { completed } = await h.start();
  h.flow.setMicMuted(true);
  const granted = trackStream();
  h.permissions[0].resolve(granted);
  await until(() => granted.track.enabled === false);
  assert.equal(h.conversations.length, 0);
  afterPermissionGate.resolve();
  assert.deepEqual(await completed, { status: 'connected' });
  assert.equal(granted.track.enabled, false);
  assert.equal(h.conversations[0].micCalls.at(-1), true);
  h.flow.setMicMuted(false);
  assert.equal(granted.track.enabled, true);
});

test('a cancelled start keeps its own result even when a newer attempt reports an error', async t => {
  const h = setup(t), { completed } = await h.start();
  h.flow.stop();
  const invalid = h.flow.start({ agentId: 'invalid value!' });
  assert.deepEqual(await completed, { status: 'stopped' });
  assert.deepEqual(await invalid, { status: 'unavailable' });
  const late = trackStream();
  h.permissions[0].resolve(late);
  await until(() => late.track.stops === 1);
  assert.equal(h.flow.state.error, 'Voice conversation is not available yet.');
});

test('input-worklet errors release a connected session with fixed generic copy', async t => {
  const h = setup(t), granted = await h.connect();
  h.conversations[0].input.onError(new Error('sensitive synthetic device details'));
  assert.equal(h.flow.state.status, 'error');
  assert.equal(h.flow.state.error, 'Seni could not connect. Please try again.');
  assert.equal(granted.track.stops, 1);
  assert.equal(h.conversations[0].ends, 1);
  await until(() => h.contexts.every(context => context.state === 'closed'));
  assert.ok(!JSON.stringify(h.changes).includes('sensitive'));
});


test('Stop lets sequential SDK teardown reach output before closing leftover contexts', async t => {
  const h = setup(t), granted = await h.connect();
  const conversation = h.conversations[0];
  let outputCleaned = false;
  for (const context of h.contexts) {
    const close = context.close.bind(context);
    context.close = () => context.state === 'closed'
      ? Promise.reject(new DOMException('Context already closed', 'InvalidStateError')) : close();
  }
  // Match pinned VoiceConversation: await detach, close input, then close output.
  conversation.endSession = async function () {
    this.ends++;
    await Promise.resolve();
    await this.input.context.close();
    outputCleaned = true;
    await this.output.context.close();
  };
  h.flow.stop();
  assert.equal(granted.track.stops, 1, 'microphone tracks still stop synchronously');
  assert.equal(conversation.ends, 1);
  await until(() => outputCleaned && h.contexts.every(context => context.state === 'closed'),
    'SDK output cleanup must survive input context closure');
  assert.ok(h.contexts.every(context => context.closes === 1));
  assert.equal(h.flow.state.status, 'idle');
});


test('failed partial input setup removes only the SDK output element retained by this session', async t => {
  const h = setup(t, { failInputAfterOutput: true });
  const unrelated = new h.host.Audio();
  unrelated.attached = true;
  unrelated.srcObject = { unrelated: true };
  const { completed } = await h.start(), granted = trackStream();
  h.permissions[0].resolve(granted);
  assert.deepEqual(await completed, { status: 'unavailable' });
  assert.equal(h.conversations.length, 0, 'the SDK never returned a conversation to clean up');
  const output = h.audioElements[1];
  assert.equal(output.attached, false);
  assert.equal(output.pauses, 1);
  assert.equal(output.srcObject, null);
  assert.ok(h.contexts.every(context => context.state === 'closed'));
  assert.equal(granted.track.stops, 1);
  assert.equal(unrelated.attached, true);
  assert.equal(unrelated.pauses, 0);
  assert.deepEqual(unrelated.srcObject, { unrelated: true });
  h.assertRestored();
});

test('restored Audio constructor excludes later elements from session cleanup', async t => {
  const h = setup(t);
  await h.connect();
  h.assertRestored();
  const unrelated = new h.host.Audio();
  unrelated.attached = true;
  h.flow.stop();
  await until(() => !h.audioElements[0].attached);
  assert.equal(unrelated.attached, true);
  assert.equal(unrelated.pauses, 0);
});
