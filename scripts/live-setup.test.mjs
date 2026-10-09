import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveStudy } from '../js/live.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const trackStream = () => {
  const track = { stops: 0, stop() { this.stops++; } };
  return { track, getTracks: () => [track] };
};

function setup(t, { permissions = [deferred()], connectionGate = null, afterPermissionGate = null } = {}) {
  let permissionIndex = 0, clientLoads = 0;
  const started = [], setupWaiters = [], sockets = [], connections = [], conversations = [], captions = [];
  const media = { getUserMedia() { return permissions[permissionIndex++].promise; } };
  const originalMedia = media.getUserMedia;
  const host = { WebSocket: class {
    constructor() { this.closes = 0; sockets.push(this); }
    close() { this.closes++; }
  } };
  const nativeSocket = host.WebSocket;
  const client = { WebSocketConnection: {
    create() {
      new host.WebSocket();
      const connection = { closes: 0, close() { this.closes++; },
        outputFormat: { format: 'pcm', sampleRate: 44100 },
        addListener() {}, removeListener() {}, handleMessage() {} };
      connections.push(connection);
      return connectionGate ? connectionGate.promise.then(() => connection) : Promise.resolve(connection);
    }
  }, Conversation: {
    async startSession(options) {
      started.push(options);
      setupWaiters.shift()?.();
      const stream = await media.getUserMedia({ audio: true });
      if (afterPermissionGate) await afterPermissionGate.promise;
      await client.WebSocketConnection.create({});
      const conversation = {
        input: { inputStream: stream }, output: { audioElement: { muted: false } },
        playbackEventTarget: { removeListener() {}, addListener() {} },
        handlePlaybackEvent() {}, setVolume() {}, ends: 0,
        endSession() { this.ends++; return Promise.resolve(); }
      };
      conversations.push(conversation);
      options.onConversationCreated(conversation);
      options.onConnect();
      return conversation;
    }
  } };
  const originalConnection = client.WebSocketConnection.create;
  const controls = { input: { value: 'synthetic-test-only' }, start: { disabled: false }, stop: { disabled: true } };
  const state = { speaking: false, mode: 'nebula' };
  const voiceReadout = { textContent: 'Silent', classList: { remove() {}, toggle() {} } };
  const flow = createLiveStudy({ voice: { stream: { interrupt() {}, isAudible: () => false } },
    face: {}, state, el: { voice: voiceReadout }, controls, host, media,
    setMode(mode) { state.mode = mode; return true; }, setExpr() {},
    restCaption(text) { captions.push(text); }, stopAll() {},
    beginMouthPlayback: () => ({}), finishMouthPlayback() {},
    clientLoader() { clientLoads++; return Promise.resolve(client); }
  });
  t.after(() => flow.stop());
  return { flow, controls, client, host, media, nativeSocket, state, captions,
    originalMedia, originalConnection, permissions, connections, conversations, sockets,
    get clientLoads() { return clientLoads; },
    async start() {
      controls.input.value = 'synthetic-test-only';
      const begun = new Promise(resolve => setupWaiters.push(resolve));
      const completed = flow.start();
      await begun;
      return { completed };
    }
  };
}

test('constructing the parked live controller does not start a provider or microphone', t => {
  const h = setup(t);
  assert.equal(h.clientLoads, 0);
  assert.equal(h.media.getUserMedia, h.originalMedia);
  assert.equal(h.client.WebSocketConnection.create, h.originalConnection);
  assert.equal(h.flow.session, null);
});

test('Stop releases controls and hooks before an unanswered microphone prompt settles', async t => {
  const h = setup(t);
  const { completed } = await h.start();
  assert.notEqual(h.media.getUserMedia, h.originalMedia);
  h.flow.stop();
  assert.equal(h.flow.session, null);
  assert.equal(h.controls.start.disabled, false);
  assert.equal(h.controls.stop.disabled, true);
  assert.equal(h.media.getUserMedia, h.originalMedia);
  assert.equal(h.client.WebSocketConnection.create, h.originalConnection);
  assert.equal(h.state.mode, 'nebula');
  const late = trackStream();
  h.permissions[0].resolve(late);
  await completed;
  assert.equal(late.track.stops, 1, 'late permission grants must be stopped immediately');
  assert.equal(h.connections.length, 0, 'a stopped permission request cannot advance to connection setup');
});

test('late completion of cancelled setup cannot release a newer session’s hooks or controls', async t => {
  const h = setup(t, { permissions: [deferred(), deferred()] });
  const first = await h.start();
  h.flow.stop();
  const second = await h.start();
  const newSession = h.flow.session, newHook = h.media.getUserMedia;
  const oldStream = trackStream();
  h.permissions[0].resolve(oldStream);
  await first.completed;
  assert.equal(oldStream.track.stops, 1);
  assert.equal(h.flow.session, newSession);
  assert.equal(h.media.getUserMedia, newHook);
  assert.equal(h.controls.start.disabled, true);
  assert.equal(h.controls.stop.disabled, false);
  h.flow.stop();
  const newStream = trackStream();
  h.permissions[1].resolve(newStream);
  await second.completed;
  assert.equal(newStream.track.stops, 1);
  assert.equal(h.media.getUserMedia, h.originalMedia);
  assert.equal(h.client.WebSocketConnection.create, h.originalConnection);
});

test('Stop closes a pending socket and prevents a late connection from starting audio IO', async t => {
  const permission = deferred(), connectionGate = deferred();
  const h = setup(t, { permissions: [permission], connectionGate });
  const { completed } = await h.start();
  const granted = trackStream();
  permission.resolve(granted);
  // The permission/guard/SDK awaits each take a microtask; wait for the explicit
  // connection construction rather than a real timer or external browser.
  for (let i = 0; !h.connections.length && i < 10; i++) await Promise.resolve();
  assert.equal(h.connections.length, 1);
  assert.equal(h.host.WebSocket, h.nativeSocket);
  h.flow.stop();
  assert.equal(h.sockets[0].closes, 1);
  assert.equal(granted.track.stops, 1);
  connectionGate.resolve();
  await completed;
  assert.equal(h.connections[0].closes, 1);
  assert.equal(h.conversations.length, 0);
  assert.equal(h.controls.start.disabled, false);
});

test('a denied prompt restores controls with a fixed status and no provider details', async t => {
  const h = setup(t);
  const { completed } = await h.start();
  h.permissions[0].reject(Object.assign(new Error('sensitive provider details'), { name: 'NotAllowedError' }));
  await completed;
  assert.equal(h.flow.session, null);
  assert.equal(h.controls.start.disabled, false);
  assert.equal(h.media.getUserMedia, h.originalMedia);
  assert.equal(h.captions.at(-1), 'Microphone permission denied. Allow microphone access, then Start again.');
});

test('connected session remains stoppable after setup hooks have been restored', async t => {
  const h = setup(t);
  const { completed } = await h.start();
  const granted = trackStream();
  h.permissions[0].resolve(granted);
  await completed;
  assert.equal(h.flow.session.connected, true);
  assert.equal(h.media.getUserMedia, h.originalMedia);
  assert.equal(h.conversations[0].output.audioElement.muted, true);
  h.flow.onFrame();
  assert.equal(h.state.speaking, false);
  assert.equal(h.flow.listening, true);
  h.flow.stop();
  assert.equal(h.flow.session, null);
  assert.equal(h.conversations[0].ends, 1);
  assert.ok(granted.track.stops >= 1);
});


test('cancellation between SDK calls retains the guard until delayed setup safely unwinds', async t => {
  const permission = deferred(), afterPermissionGate = deferred();
  const h = setup(t, { permissions: [permission], afterPermissionGate });
  const { completed } = await h.start();
  const granted = trackStream();
  permission.resolve(granted);
  for (let i = 0; i < 4; i++) await Promise.resolve();
  h.flow.stop();
  assert.equal(h.flow.session, null);
  assert.equal(granted.track.stops, 1);
  assert.equal(h.controls.start.disabled, true, 'SDK internal waits must not overlap a new setup');
  assert.notEqual(h.client.WebSocketConnection.create, h.originalConnection);
  afterPermissionGate.resolve();
  await completed;
  assert.equal(h.connections.length, 0, 'cancelled SDK continuation cannot open a socket');
  assert.equal(h.media.getUserMedia, h.originalMedia);
  assert.equal(h.client.WebSocketConnection.create, h.originalConnection);
  assert.equal(h.controls.start.disabled, false);
});
