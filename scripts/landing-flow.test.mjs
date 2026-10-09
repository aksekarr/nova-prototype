import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandingFlow } from '../js/landing-flow.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function setup(overrides = {}, options = {}) {
  let clock = 0;
  const calls = [], states = [], replies = [];
  const voice = {
    activate() { calls.push(['activate']); return Promise.resolve(); },
    preload(ids, settings) { calls.push(['preload', ids, settings]); return Promise.resolve(); },
    getLabLine(id) { calls.push(['line', id]); return Promise.resolve({ text: 'Approved introduction' }); },
    speak(id) { calls.push(['speak', id]); return Promise.resolve({ status: 'completed' }); },
    stop() { calls.push(['stop']); },
    ...overrides
  };
  const flow = createLandingFlow({ voice, getClock: () => clock,
    setMode(mode) { calls.push(['mode', mode]); return true; },
    setReplyText(text) { replies.push(text); },
    onChange(state) { states.push(state); }, ...options });
  return { flow, voice, calls, states, replies,
    advance(seconds) { clock += seconds; flow.onFrame(); },
    speaks: () => calls.filter(([type]) => type === 'speak') };
}

test('entry begins audio activation and face formation in the click, then speaks only intro after 3 s of rendered time', async () => {
  const h = setup();
  assert.deepEqual(h.flow.state, { phase: 'arrival', busy: false, speaking: false, error: null });
  assert.equal(h.states.length, 0, 'factory construction does not invoke callbacks');
  const entry = h.flow.meet();
  assert.deepEqual(h.calls.slice(0, 3), [['activate'], ['preload', ['intro'], undefined], ['mode', 'face']]);
  assert.equal(h.flow.phase, 'forming');
  await flush();
  assert.equal(h.speaks().length, 0);
  h.advance(2.999); await flush();
  assert.equal(h.speaks().length, 0);
  h.advance(0.001);
  assert.deepEqual(await entry, { status: 'completed' });
  assert.deepEqual(h.speaks(), [['speak', 'intro']]);
  assert.deepEqual(h.replies, ['Approved introduction']);
  assert.deepEqual(h.states.map(state => state.phase), ['forming', 'greeting', 'present']);
  assert.equal(h.flow.state.speaking, false);
});

test('slow loading does not delay formation, but does delay the greeting', async () => {
  const loading = deferred();
  const h = setup({ preload: () => loading.promise });
  const entry = h.flow.meet();
  assert.ok(h.calls.some(([type, mode]) => type === 'mode' && mode === 'face'));
  h.advance(3); await flush();
  assert.equal(h.flow.phase, 'loading');
  assert.equal(h.speaks().length, 0);
  loading.resolve();
  await entry;
  assert.equal(h.flow.phase, 'present');
});

test('greeting still waits for audio activation after loading and formation finish', async () => {
  const activation = deferred();
  const h = setup({ activate: () => activation.promise });
  const entry = h.flow.meet();
  h.advance(3); await flush();
  assert.equal(h.speaks().length, 0);
  activation.resolve(); await entry;
  assert.equal(h.speaks().length, 1);
});

test('warmup loads only intro, never blocks entry, and a failed warmup remains retryable', async () => {
  let attempts = 0;
  const settings = [];
  const h = setup({ preload(ids, options) {
    assert.deepEqual(ids, ['intro']); settings.push(options);
    return ++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve();
  } });
  assert.deepEqual(await h.flow.prepare(), { status: 'unavailable' });
  assert.equal(h.flow.phase, 'arrival');
  assert.equal(h.states.length, 0);
  assert.deepEqual(settings[0], { background: true });
  const entry = h.flow.meet();
  h.advance(3); await entry;
  assert.equal(h.flow.phase, 'present');
});

test('failed entry loading exposes an error and can be retried without restarting elapsed formation', async () => {
  let attempts = 0;
  const h = setup({ preload() {
    return ++attempts === 1 ? Promise.reject(new Error('private request details')) : Promise.resolve();
  } });
  assert.deepEqual(await h.flow.meet(), { status: 'unavailable' });
  assert.equal(h.flow.phase, 'error');
  assert.match(h.flow.state.error, /Try again/);
  assert.ok(!h.flow.state.error.includes('private'));
  h.advance(3);
  assert.deepEqual(await h.flow.meet(), { status: 'completed' });
  assert.equal(h.flow.phase, 'present');
});

test('activation rejection is recoverable and cannot leave the entry permanently busy', async () => {
  const h = setup({ activate: () => Promise.reject(Object.assign(new Error('interrupted'), { code: 'AUDIO_UNAVAILABLE' })) });
  assert.deepEqual(await h.flow.meet(), { status: 'unavailable' });
  assert.deepEqual(h.flow.state, { phase: 'error', busy: false, speaking: false, error: 'Audio could not start. Try again.' });
  h.voice.activate = () => Promise.resolve();
  const retry = h.flow.meet(); h.advance(3);
  assert.deepEqual(await retry, { status: 'completed' });
});

test('a synchronous activation exception is handled like a rejected activation', async () => {
  const h = setup({ activate() { throw Object.assign(new Error('missing audio'), { code: 'AUDIO_UNAVAILABLE' }); } });
  await h.flow.meet();
  assert.equal(h.flow.state.error, 'Audio could not start. Try again.');
});

test('unavailable voice playback does not claim Seni is present and can be retried', async () => {
  const h = setup({ speak: () => Promise.resolve({ status: 'unavailable', error: { code: 'AUDIO_UNAVAILABLE' } }) });
  const entry = h.flow.meet(); h.advance(3);
  assert.deepEqual(await entry, { status: 'unavailable' });
  assert.equal(h.flow.phase, 'error');
  assert.equal(h.flow.state.speaking, false);
  h.voice.speak = () => Promise.resolve({ status: 'completed' });
  assert.deepEqual(await h.flow.repeatGreeting(), { status: 'completed' });
  assert.equal(h.flow.phase, 'present');
});

test('duplicate entry and repeat clicks share the in-flight greeting', async () => {
  const spoken = deferred();
  const h = setup({ speak() { h.calls.push(['speak', 'intro']); return spoken.promise; } });
  const entry = h.flow.meet();
  assert.equal(h.flow.meet(), entry);
  assert.equal(h.flow.repeatGreeting(), entry);
  h.advance(3); await flush();
  assert.equal(h.flow.phase, 'greeting');
  assert.equal(h.flow.state.speaking, true);
  assert.equal(h.flow.repeatGreeting(), entry);
  assert.equal(h.speaks().length, 1);
  spoken.resolve({ status: 'completed' }); await entry;
});

test('repeating a completed greeting activates from its gesture and skips formation', async () => {
  const h = setup();
  const entry = h.flow.meet(); h.advance(3); await entry;
  const priorActivationCount = h.calls.filter(([type]) => type === 'activate').length;
  const repeat = h.flow.repeatGreeting();
  assert.equal(h.calls.filter(([type]) => type === 'activate').length, priorActivationCount + 1);
  assert.equal(h.flow.phase, 'loading');
  await repeat;
  assert.equal(h.speaks().length, 2);
});

test('returning during formation resolves the flow immediately and invalidates late preparation', async () => {
  const loading = deferred();
  const h = setup({ preload: () => loading.promise });
  const entry = h.flow.meet();
  h.flow.returnToNebula();
  assert.deepEqual(await entry, { status: 'stopped' });
  assert.equal(h.flow.phase, 'arrival');
  loading.resolve(); h.advance(20); await flush();
  assert.equal(h.flow.phase, 'arrival');
  assert.equal(h.speaks().length, 0);
  assert.equal(h.replies.at(-1), null);
});

test('a late failure from an old entry cannot overwrite a newer successful entry', async () => {
  const oldLoading = deferred(); let attempts = 0;
  const h = setup({ preload() { return ++attempts === 1 ? oldLoading.promise : Promise.resolve(); } });
  const first = h.flow.meet();
  h.flow.returnToNebula(); await first;
  const second = h.flow.meet(); h.advance(3); await second;
  oldLoading.reject(new Error('late old failure')); await flush();
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.speaks().length, 1);
  assert.equal(h.states.some(state => state.phase === 'error'), false);
});

test('returning during speech prevents a late completion from restoring the face state', async () => {
  const spoken = deferred();
  const h = setup({ speak: () => spoken.promise });
  const entry = h.flow.meet(); h.advance(3); await flush();
  assert.equal(h.flow.phase, 'greeting');
  h.flow.returnToNebula();
  assert.deepEqual(await entry, { status: 'stopped' });
  spoken.resolve({ status: 'completed' }); await flush();
  assert.equal(h.flow.phase, 'arrival');
  assert.equal(h.flow.state.speaking, false);
  assert.deepEqual(h.calls.filter(([type]) => type === 'mode').at(-1), ['mode', 'nebula']);
});

test('a fresh visit after returning waits for a full new formation', async () => {
  const h = setup();
  const first = h.flow.meet(); h.advance(3); await first;
  h.flow.returnToNebula(); h.advance(20);
  const next = h.flow.meet(); await flush();
  assert.equal(h.speaks().length, 1);
  h.advance(2.99); await flush();
  assert.equal(h.speaks().length, 1);
  h.advance(0.01); await next;
  assert.equal(h.speaks().length, 2);
});

test('face unavailability is recoverable without speaking or an unhandled late load rejection', async () => {
  const loading = deferred();
  const h = setup({ preload: () => loading.promise }, { setMode: () => false });
  assert.deepEqual(await h.flow.meet(), { status: 'unavailable' });
  assert.equal(h.flow.state.error, 'Seni could not form. Try again.');
  loading.reject(new Error('late asset failure')); await flush();
  assert.equal(h.speaks().length, 0);
});

test('dispose resolves pending entry and warmup and prevents future voice or state activity', async () => {
  const loading = deferred();
  const h = setup({ preload: () => loading.promise });
  const warmup = h.flow.prepare();
  const entry = h.flow.meet();
  h.flow.dispose();
  assert.deepEqual(await warmup, { status: 'disposed' });
  assert.deepEqual(await entry, { status: 'stopped' });
  assert.equal(h.flow.state.busy, false);
  const callCount = h.calls.length, stateCount = h.states.length;
  assert.deepEqual(await h.flow.meet(), { status: 'disposed' });
  assert.deepEqual(await h.flow.repeatGreeting(), { status: 'disposed' });
  assert.deepEqual(await h.flow.prepare(), { status: 'disposed' });
  h.flow.returnToNebula(); h.flow.dispose();
  loading.resolve(); h.advance(100); await flush();
  assert.equal(h.calls.length, callCount);
  assert.equal(h.states.length, stateCount);
  assert.equal(h.speaks().length, 0);
});
