import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudyFlow } from '../js/study-flow.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(overrides = {}) {
  const calls = [], captions = [], locks = [];
  const state = { mode: 'nebula', modeT: 0, clock: 0, speaking: false };
  const el = { wake: { disabled: true }, line: { disabled: true } };
  const voice = {
    activate() { calls.push(['activate']); return Promise.resolve(); },
    preload(ids) { calls.push(['preload', ...ids]); return Promise.resolve(); },
    getLabLine(id) { return Promise.resolve({ text: id }); },
    speak(id) { calls.push(['speak', id]); return Promise.resolve({ status: 'completed' }); },
    stop() { calls.push(['stop']); },
    stream: { interrupt() {}, isAudible: () => false, isActive: () => false },
    ...overrides
  };
  const flow = createStudyFlow({ voice, state, el, face: { setReplyText() {} },
    setMode(mode) { state.mode = mode; state.modeT = state.clock; calls.push(['mode', mode]); return true; },
    restCaption(text) { captions.push(text); },
    sleep(ms) { calls.push(['sleep', ms]); return Promise.resolve(); }
  });
  flow.connectMouthLab({ setPlaybackActive(value) { locks.push(value); } });
  return { flow, voice, state, el, calls, captions, locks };
}

test('greeting and test readiness do not depend on unrelated demo audio', async () => {
  const hello = deferred(), standalone = deferred();
  const h = setup({ preload(ids) {
    if (ids[0] === 'hello') return hello.promise;
    if (ids[0] === 'test') return standalone.promise;
    return new Promise(() => {}); // optional warmup never resolves
  } });
  const ready = h.flow.prepare();
  hello.resolve(); await ready.greeting;
  assert.equal(h.el.wake.disabled, false);
  assert.equal(h.el.line.disabled, true);
  standalone.reject(new Error('temporary fetch failure')); await ready.test;
  assert.equal(h.el.line.disabled, false, 'a failed request exposes the same control for retry');
});

test('failed greeting preload can be retried by the entry control', async () => {
  let attempts = 0;
  const h = setup({ preload(ids) {
    if (ids[0] === 'hello' && ++attempts === 1) return Promise.reject(new Error('offline'));
    return Promise.resolve();
  } });
  await h.flow.prepare().greeting;
  assert.equal(h.el.wake.disabled, false);
  await h.flow.runSequence();
  assert.ok(h.calls.some(([type, line]) => type === 'speak' && line === 'hello'));
  assert.equal(h.captions.at(-1), 'Listening.');
});

test('the extracted successful demo preserves its line order, formations and waits', async () => {
  const h = setup();
  await h.flow.runSequence();
  assert.deepEqual(h.calls.filter(([type]) => type === 'speak').map(([, value]) => value),
    ['hello', 'intro', 'trees', 'tree', 'back']);
  assert.deepEqual(h.calls.filter(([type]) => type === 'mode').map(([, value]) => value),
    ['face', 'tree', 'face']);
  assert.deepEqual(h.calls.filter(([type]) => type === 'sleep').map(([, value]) => value),
    [3000, 350, 1400, 1600, 2600, 1800]);
  assert.equal(h.state.speaking, false);
  assert.equal(h.locks.at(-1), false);
});

test('audio activation starts in the click and a failed activation remains retryable', async () => {
  const activation = deferred(); let activated = false;
  const h = setup({ activate() { activated = true; return activation.promise; } });
  const first = h.flow.runSequence();
  assert.equal(activated, true, 'resume must start before yielding the user gesture');
  activation.reject(Object.assign(new Error('private platform details'), { code: 'AUDIO_UNAVAILABLE' }));
  await first;
  assert.equal(h.state.mode, 'nebula');
  assert.equal(h.state.speaking, false);
  assert.equal(h.locks.at(-1), false);
  assert.match(h.captions.at(-1), /^Audio could not start\./);
  assert.ok(!h.captions.at(-1).includes('private'));
  h.voice.activate = () => Promise.resolve();
  await h.flow.runSequence();
  assert.equal(h.captions.at(-1), 'Listening.');
});

test('a failed later line restores retry without continuing the old sequence', async () => {
  let fail = true;
  const h = setup({ preload(ids) {
    return fail && ids[0] === 'trees' ? Promise.reject(new Error('offline')) : Promise.resolve();
  } });
  await h.flow.runSequence();
  assert.deepEqual(h.calls.filter(([type]) => type === 'speak').map(([, id]) => id), ['hello', 'intro']);
  assert.equal(h.state.mode, 'nebula');
  assert.equal(h.state.speaking, false);
  assert.match(h.captions.at(-1), /^Voice unavailable\./);
  fail = false;
  await h.flow.runSequence();
  assert.equal(h.captions.at(-1), 'Listening.');
});

test('stale activation failures cannot overwrite a newer interaction', async () => {
  const activation = deferred();
  const h = setup({ activate: () => activation.promise });
  const first = h.flow.runSequence();
  h.flow.stopAll();
  h.state.mode = 'tree';
  activation.reject(new Error('cancelled activation'));
  await first;
  assert.equal(h.state.mode, 'tree');
  assert.deepEqual(h.captions, []);
  assert.equal(h.locks.at(-1), false);
});

test('audio unavailable during playback stops the demo and preserves retry', async () => {
  const h = setup({ speak: () => Promise.resolve({ status: 'unavailable',
    error: Object.assign(new Error('unavailable'), { code: 'AUDIO_UNAVAILABLE' }) }) });
  await h.flow.runSequence();
  assert.equal(h.state.mode, 'nebula');
  assert.equal(h.state.speaking, false);
  assert.equal(h.locks.at(-1), false);
  assert.match(h.captions.at(-1), /^Audio could not start\./);
  assert.equal(h.calls.filter(([type]) => type === 'sleep').length, 1);
});
