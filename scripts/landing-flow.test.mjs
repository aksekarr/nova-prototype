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
  assert.deepEqual(h.flow.state, { phase: 'arrival', form: 'nebula', busy: false, speaking: false, error: null });
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
  assert.deepEqual(h.flow.state, { phase: 'error', form: 'face', busy: false, speaking: false, error: 'Audio could not start. Try again.' });
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

async function meet(h) {
  const entry = h.flow.meet();
  h.advance(3);
  assert.deepEqual(await entry, { status: 'completed' });
}

test('Surprise Me is unavailable before meeting or during a greeting', async () => {
  const speech = deferred();
  const h = setup({ speak: () => speech.promise });
  assert.deepEqual(await h.flow.surprise(), { status: 'ignored' });
  assert.deepEqual(await h.flow.showFace(), { status: 'ignored' });
  const entry = h.flow.meet();
  assert.deepEqual(await h.flow.surprise(), { status: 'ignored' });
  h.advance(3); await flush();
  assert.deepEqual(await h.flow.surprise(), { status: 'ignored' });
  assert.equal(h.flow.state.form, 'face');
  speech.resolve({ status: 'completed' }); await entry;
});

test('Surprise Me cycles face to jellyfish to atom to lotus to face and settles only after the renderer completes', async () => {
  let transitioning = false;
  const h = setup({}, { isTransitioning: () => transitioning });
  await meet(h);
  const callCount = h.calls.length;
  for (const expected of ['jelly', 'orbit', 'lotus', 'face', 'jelly']) {
    transitioning = true;
    const change = h.flow.surprise();
    assert.deepEqual(h.flow.state, { phase: 'changing-form', form: expected, busy: true, speaking: false, error: null });
    assert.deepEqual(await h.flow.surprise(), { status: 'ignored' });
    h.advance(10); await flush();
    assert.equal(h.flow.phase, 'changing-form', 'elapsed time cannot end a renderer transition');
    transitioning = false;
    h.advance(0);
    assert.deepEqual(await change, { status: 'completed' });
    assert.equal(h.flow.phase, 'present');
    assert.equal(h.flow.state.form, expected);
  }
  assert.equal(h.calls.slice(callCount).some(([type]) => ['activate', 'preload', 'speak'].includes(type)), false);
  assert.equal(h.replies.at(-1), null);
});

test('form changes with an immediate renderer still wait for a rendered frame', async () => {
  const h = setup();
  await meet(h);
  const change = h.flow.surprise();
  await flush();
  assert.equal(h.flow.phase, 'changing-form');
  h.advance(0); await change;
  assert.equal(h.flow.phase, 'present');
});

test('Show Seni reverses an in-flight change silently and invalidates its late completion', async () => {
  let transitioning = false;
  const h = setup({}, { isTransitioning: () => transitioning });
  await meet(h);
  const spokenCount = h.speaks().length;
  transitioning = true;
  const surprise = h.flow.surprise();
  const face = h.flow.showFace();
  assert.deepEqual(await surprise, { status: 'stopped' });
  assert.equal(h.flow.state.form, 'face');
  h.advance(3); await flush();
  assert.equal(h.flow.phase, 'changing-form');
  transitioning = false;
  h.advance(0); await face;
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.speaks().length, spokenCount);
  assert.deepEqual(await h.flow.showFace(), { status: 'completed' });
  const next = h.flow.surprise(); h.advance(0); await next;
  assert.equal(h.flow.state.form, 'jelly', 'every return to the face starts with jellyfish');
});

for (const target of ['jelly', 'orbit', 'lotus']) {
  test(`replay from ${target} activates immediately and waits for the face morph`, async () => {
    let transitioning = false;
    const h = setup({}, { isTransitioning: () => transitioning });
    await meet(h);
    for (const expected of ['jelly', 'orbit', 'lotus']) {
      const surprise = h.flow.surprise(); h.advance(0); await surprise;
      assert.equal(h.flow.state.form, expected);
      if (expected === target) break;
    }
    transitioning = true;
    const callsBefore = h.calls.length;
    const replay = h.flow.repeatGreeting();
    assert.equal(h.calls[callsBefore][0], 'activate');
    assert.equal(h.flow.state.form, 'face');
    assert.equal(h.flow.phase, 'changing-form');
    h.advance(20); await flush();
    assert.equal(h.speaks().length, 1);
    transitioning = false;
    h.advance(0); await replay;
    assert.equal(h.speaks().length, 2);
    assert.equal(h.flow.phase, 'present');
  });
}

test('replay can replace an in-flight form change without its old completion winning', async () => {
  let transitioning = false;
  const h = setup({}, { isTransitioning: () => transitioning });
  await meet(h);
  transitioning = true;
  const surprise = h.flow.surprise();
  const replay = h.flow.repeatGreeting();
  assert.deepEqual(await surprise, { status: 'stopped' });
  h.advance(2); await flush();
  assert.equal(h.flow.phase, 'changing-form');
  transitioning = false;
  h.advance(0); await replay;
  assert.equal(h.flow.state.form, 'face');
  assert.equal(h.speaks().length, 2);
});

test('returning to the nebula cancels an in-flight form change and resets the cycle', async () => {
  let transitioning = false;
  const h = setup({}, { isTransitioning: () => transitioning });
  await meet(h);
  transitioning = true;
  const surprise = h.flow.surprise();
  h.flow.returnToNebula();
  assert.deepEqual(await surprise, { status: 'stopped' });
  assert.equal(h.flow.state.form, 'nebula');
  assert.equal(h.flow.phase, 'arrival');
  transitioning = false;
  h.advance(20); await flush();
  assert.equal(h.flow.phase, 'arrival');
  await meet(h);
  const next = h.flow.surprise(); h.advance(0); await next;
  assert.equal(h.flow.state.form, 'jelly');
});

test('a failed form selection retains the current presence and retries the same form', async () => {
  let failJelly = true;
  const selected = [];
  const h = setup({}, { setMode(mode) {
    selected.push(mode);
    if (mode === 'jelly' && failJelly) throw new Error('private asset path');
    return true;
  } });
  await meet(h);
  assert.deepEqual(await h.flow.surprise(), { status: 'unavailable' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.form, 'face');
  assert.equal(h.flow.state.busy, false);
  assert.match(h.flow.state.error, /try again/i);
  assert.ok(!h.flow.state.error.includes('private'));
  failJelly = false;
  const next = h.flow.surprise(); h.advance(0); await next;
  assert.equal(h.flow.state.form, 'jelly');
  assert.equal(h.flow.state.error, null);
  assert.deepEqual(selected, ['face', 'jelly', 'jelly']);
});

test('a failed Show Seni selection leaves the active form transition owned and able to settle', async () => {
  let transitioning = false, failFace = false;
  const h = setup({}, { isTransitioning: () => transitioning,
    setMode: mode => !(failFace && mode === 'face') });
  await meet(h);
  transitioning = true;
  const surprise = h.flow.surprise();
  failFace = true;
  assert.deepEqual(await h.flow.showFace(), { status: 'unavailable' });
  assert.equal(h.flow.state.form, 'jelly');
  assert.equal(h.flow.phase, 'changing-form');
  transitioning = false;
  h.advance(0);
  assert.deepEqual(await surprise, { status: 'completed' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.form, 'jelly');
});

test('failed replay audio keeps a known presence and finishes its face transition safely', async () => {
  let transitioning = false;
  const h = setup({}, { isTransitioning: () => transitioning });
  await meet(h);
  const surprise = h.flow.surprise(); h.advance(0); await surprise;
  h.voice.activate = () => Promise.reject(Object.assign(new Error('suspended'), { code: 'AUDIO_UNAVAILABLE' }));
  transitioning = true;
  const replay = h.flow.repeatGreeting();
  await flush();
  assert.equal(h.flow.phase, 'changing-form');
  assert.equal(h.flow.state.error, 'Audio could not start. Try again.');
  transitioning = false;
  h.advance(0);
  assert.deepEqual(await replay, { status: 'unavailable' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.form, 'face');
  assert.equal(h.speaks().length, 1);
});

test('dispose cancels changing forms and rejects further form activity', async () => {
  const h = setup();
  await meet(h);
  const change = h.flow.surprise();
  h.flow.dispose();
  assert.deepEqual(await change, { status: 'stopped' });
  const count = h.calls.length;
  assert.deepEqual(await h.flow.surprise(), { status: 'disposed' });
  assert.deepEqual(await h.flow.showFace(), { status: 'disposed' });
  h.advance(50); await flush();
  assert.equal(h.calls.length, count);
  assert.equal(h.flow.phase, 'arrival');
});


for (const target of ['orbit', 'lotus']) {
  test(`Back to Seni from ${target} restarts Surprise Me with jellyfish`, async () => {
    const h = setup();
    await meet(h);
    for (const expected of ['jelly', 'orbit', 'lotus']) {
      const change = h.flow.surprise(); h.advance(0); await change;
      assert.equal(h.flow.state.form, expected);
      if (expected === target) break;
    }
    const back = h.flow.showFace(); h.advance(0); await back;
    const next = h.flow.surprise(); h.advance(0); await next;
    assert.equal(h.flow.state.form, 'jelly');
    assert.equal(h.speaks().length, 1, 'exploring and returning never replay the introduction');
  });
}

test('Back to Seni interrupts the lotus bloom and never allows its old wait to settle the return', async () => {
  let transitioning = false;
  const h = setup({}, { isTransitioning: () => transitioning });
  await meet(h);
  for (const form of ['jelly', 'orbit']) {
    const change = h.flow.surprise(); h.advance(0); await change;
    assert.equal(h.flow.state.form, form);
  }
  transitioning = true;
  const lotus = h.flow.surprise();
  h.advance(5); await flush();
  assert.equal(h.flow.state.form, 'lotus');
  assert.equal(h.flow.state.busy, true, 'the bloom remains part of the visual transition');
  const back = h.flow.showFace();
  assert.deepEqual(await lotus, { status: 'stopped' });
  h.advance(5); await flush();
  assert.equal(h.flow.state.form, 'face');
  assert.equal(h.flow.phase, 'changing-form', 'only the new face transition can release its wait');
  transitioning = false;
  h.advance(0);
  assert.deepEqual(await back, { status: 'completed' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.speaks().length, 1);
});

function setupLive({ startResult = null, voice = {}, options = {} } = {}) {
  let h;
  let state = { status: 'idle', speaking: false, micMuted: false, error: null };
  const agentCalls = [];
  const update = next => { state = { ...state, ...next }; h?.flow.agentChanged(); };
  const agent = {
    get state() { return { ...state }; },
    prepare() { agentCalls.push(['prepare']); return Promise.resolve(); },
    start(config) {
      agentCalls.push(['start', config]);
      update({ status: 'connecting', speaking: false, error: null });
      if (startResult) return startResult();
      update({ status: 'connected' });
      return Promise.resolve({ status: 'connected' });
    },
    stop() { agentCalls.push(['stop']); update({ status: 'idle', speaking: false, micMuted: false, error: null }); },
    setMicMuted(micMuted) { agentCalls.push(['mute', micMuted]); update({ micMuted }); }
  };
  h = setup(voice, { agent, agentConfig: { agentId: 'synthetic-agent' }, ...options });
  return { ...h, agent, agentCalls, update,
    starts: () => agentCalls.filter(([kind]) => kind === 'start') };
}

test('live entry activates output in the click, forms the face, then lets the agent own its greeting', async () => {
  const h = setupLive();
  assert.equal(h.flow.state.live, true);
  assert.deepEqual(await h.flow.prepare(), { status: 'prepared' });
  assert.deepEqual(h.agentCalls, [['prepare']]);
  assert.equal(h.calls.length, 0, 'warmup only prepares the local agent adapter');
  const entry = h.flow.meet();
  assert.equal(h.calls[0][0], 'activate');
  assert.equal(h.flow.phase, 'forming');
  assert.equal(h.flow.meet(), entry, 'duplicate clicks share the session start');
  h.advance(2.99); await flush();
  assert.equal(h.starts().length, 0);
  h.advance(.01);
  assert.deepEqual(await entry, { status: 'connected' });
  assert.deepEqual(h.starts(), [['start', { agentId: 'synthetic-agent' }]]);
  assert.equal(h.flow.phase, 'listening');
  assert.equal(h.flow.state.speaking, false);
  h.update({ speaking: true });
  assert.equal(h.flow.phase, 'speaking');
  assert.equal(h.flow.state.speaking, true);
  h.update({ speaking: false });
  assert.equal(h.flow.phase, 'listening');
  assert.equal(h.calls.some(([kind]) => ['preload', 'line', 'speak'].includes(kind)), false, 'live entry never queues a cached greeting');
  assert.ok(h.replies.every(text => text === null), 'no cached greeting is sent to facial expression text analysis');
});

test('live microphone control is independent, ending stays on the face, and Talk starts a fresh session', async () => {
  const h = setupLive();
  const entry = h.flow.meet(); h.advance(3); await entry;
  h.flow.setMicMuted(true);
  assert.equal(h.flow.state.micMuted, true);
  assert.equal(h.flow.phase, 'listening');
  assert.deepEqual(h.agentCalls.at(-1), ['mute', true]);
  h.flow.setMicMuted(false);
  assert.equal(h.flow.state.micMuted, false);
  h.flow.endConversation();
  assert.equal(h.agent.state.status, 'idle');
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.form, 'face');
  const callsAfterEnd = h.agentCalls.length;
  h.flow.setMicMuted(true);
  assert.equal(h.agentCalls.length, callsAfterEnd, 'a stopped session cannot acquire or mute a microphone');
  assert.deepEqual(await h.flow.meet(), { status: 'connected' });
  assert.equal(h.starts().length, 2);
  const stops = h.agentCalls.filter(([kind]) => kind === 'stop').length;
  assert.deepEqual(await h.flow.repeatGreeting(), { status: 'connected' });
  assert.ok(h.agentCalls.filter(([kind]) => kind === 'stop').length > stops, 'a new greeting stops the existing live session');
  assert.equal(h.starts().length, 3);
  assert.equal(h.speaks().length, 0);
});

test('return before formation completes never connects after a late activation', async () => {
  const activation = deferred();
  const h = setupLive({ voice: { activate: () => activation.promise } });
  const entry = h.flow.meet();
  h.flow.returnToNebula();
  assert.deepEqual(await entry, { status: 'stopped' });
  activation.resolve(); h.advance(20); await flush();
  assert.equal(h.starts().length, 0);
  assert.equal(h.flow.phase, 'arrival');
  assert.equal(h.agent.state.status, 'idle');
});

for (const action of ['returnToNebula', 'endConversation', 'dispose']) {
  test(`${action} cancels a pending agent connection and rejects its late completion`, async () => {
    const connection = deferred();
    const h = setupLive({ startResult: () => connection.promise });
    const entry = h.flow.meet(); h.advance(3); await flush();
    assert.equal(h.flow.phase, 'connecting');
    h.flow.setMicMuted(true);
    assert.equal(h.flow.state.micMuted, true);
    h.flow[action]();
    assert.equal(h.agent.state.status, 'idle');
    assert.deepEqual(await entry, { status: 'stopped' });
    const states = h.states.length;
    h.update({ status: 'connected', speaking: true });
    connection.resolve({ status: 'connected' }); await flush();
    assert.equal(h.states.length, states, 'old provider events cannot restore the conversation');
    assert.equal(h.flow.state.speaking, false);
    assert.equal(h.flow.phase, action === 'endConversation' ? 'present' : 'arrival');
    if (action === 'dispose') assert.deepEqual(await h.flow.meet(), { status: 'disposed' });
  });
}

for (const duringConnection of [false, true]) {
  test(`Surprise Me ends ${duringConnection ? 'connecting' : 'speaking'} and exploring stays silent until Talk`, async () => {
    const connection = deferred();
    const h = setupLive({ startResult: duringConnection ? () => connection.promise : null });
    const entry = h.flow.meet(); h.advance(3); await flush();
    if (!duringConnection) { await entry; h.update({ speaking: true }); }
    const change = h.flow.surprise();
    assert.equal(h.agent.state.status, 'idle', 'the microphone/session is stopped immediately');
    assert.equal(h.flow.state.form, 'jelly');
    assert.equal(h.flow.phase, 'changing-form');
    assert.equal(h.flow.state.speaking, false);
    if (duringConnection) {
      assert.deepEqual(await entry, { status: 'stopped' });
      connection.resolve({ status: 'connected' });
    }
    h.advance(0); await change;
    const back = h.flow.showFace(); h.advance(0); await back;
    assert.equal(h.flow.phase, 'present');
    assert.equal(h.starts().length, 1, 'returning to the face does not reacquire the microphone');
    assert.equal(h.speaks().length, 0);
  });
}

test('agent connection errors show a fixed recoverable failure and a disconnected face can talk again', async () => {
  const connection = deferred();
  const h = setupLive({ startResult: () => connection.promise });
  const entry = h.flow.meet(); h.advance(3); await flush();
  h.update({ status: 'error', error: 'Microphone access is blocked. Allow it and try again.' });
  connection.resolve({ status: 'unavailable' });
  assert.deepEqual(await entry, { status: 'unavailable' });
  assert.equal(h.flow.phase, 'present');
  assert.match(h.flow.state.error, /Microphone access/);
  h.agent.start = () => { h.update({ status: 'connected', error: null }); return Promise.resolve({ status: 'connected' }); };
  assert.deepEqual(await h.flow.meet(), { status: 'connected' });
  assert.equal(h.flow.phase, 'listening');
  h.update({ status: 'idle' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.error, null);
  assert.equal(h.flow.state.speaking, false);
});

test('live preparation and synchronous connection failures do not expose provider details or play fallback speech', async () => {
  const h = setupLive({ startResult() { throw new Error('private provider details'); } });
  h.agent.prepare = () => Promise.reject(new Error('local adapter unavailable'));
  assert.deepEqual(await h.flow.prepare(), { status: 'unavailable' });
  assert.equal(h.flow.phase, 'arrival');
  const entry = h.flow.meet(); h.advance(3);
  assert.deepEqual(await entry, { status: 'unavailable' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.error, 'The conversation could not connect. Try again.');
  assert.equal(h.speaks().length, 0);
  assert.equal(h.agent.state.status, 'idle');
});

test('without runtime configuration the original cached greeting remains available', async () => {
  const h = setupLive({ options: { agentConfig: null } });
  assert.equal(h.flow.state.live, undefined);
  await h.flow.prepare();
  const entry = h.flow.meet(); h.advance(3);
  assert.deepEqual(await entry, { status: 'completed' });
  assert.equal(h.agentCalls.length, 0);
  assert.equal(h.speaks().length, 1);
  assert.equal(h.flow.phase, 'present');
});


test('a resolved agent warmup failure stays silent and remains retryable', async () => {
  const h = setupLive();
  h.agent.prepare = () => Promise.resolve({ status: 'unavailable' });
  assert.deepEqual(await h.flow.prepare(), { status: 'unavailable' });
  assert.equal(h.flow.phase, 'arrival');
  assert.equal(h.flow.state.error, null);
  const entry = h.flow.meet(); h.advance(3);
  assert.deepEqual(await entry, { status: 'connected' });
});

test('a failed Surprise Me selection still closes the microphone and leaves Talk available', async () => {
  const h = setupLive({ options: { setMode: mode => mode !== 'jelly' } });
  const entry = h.flow.meet(); h.advance(3); await entry;
  h.update({ speaking: true });
  assert.deepEqual(await h.flow.surprise(), { status: 'unavailable' });
  assert.equal(h.agent.state.status, 'idle');
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.form, 'face');
  assert.equal(h.flow.state.speaking, false);
  assert.match(h.flow.state.error, /form could not appear/);
});

test('reconnecting from a form waits for its return even when output activation fails', async () => {
  let transitioning = false;
  const h = setupLive({ options: { isTransitioning: () => transitioning } });
  const entry = h.flow.meet(); h.advance(3); await entry;
  const change = h.flow.surprise(); h.advance(0); await change;
  transitioning = true;
  h.voice.activate = () => Promise.reject(Object.assign(new Error('suspended'), { code: 'AUDIO_UNAVAILABLE' }));
  const reconnect = h.flow.meet(); await flush();
  assert.equal(h.flow.phase, 'changing-form');
  assert.equal(h.starts().length, 1);
  transitioning = false;
  h.advance(3);
  assert.deepEqual(await reconnect, { status: 'unavailable' });
  assert.equal(h.flow.phase, 'present');
  assert.equal(h.flow.state.form, 'face');
  assert.equal(h.flow.state.error, 'Audio could not start. Try again.');
});
