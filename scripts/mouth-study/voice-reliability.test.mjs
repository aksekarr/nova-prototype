import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const voiceURL = new URL('../../js/voice.js', import.meta.url);
const helper = `data:text/javascript;base64,${Buffer.from(await readFile(new URL('../../js/speech-mouth.js', import.meta.url), 'utf8')).toString('base64')}`;
let source = await readFile(voiceURL, 'utf8');
source = source.replace("import { createVoiceEffect, stopReferenceClip } from './flanger.js';",
  'const createVoiceEffect=()=>({input:{},ready:Promise.resolve(),reset(){}}); const stopReferenceClip=()=>{};');
source = source.replace("'./speech-mouth.js'", JSON.stringify(helper));
source = source.replaceAll('import.meta.url', JSON.stringify(voiceURL.href));
const { createVoice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const element = () => ({ textContent: '', className: '', classList: { add() {}, toggle() {} }, appendChild() {} });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup({ state = 'running', resume } = {}) {
  let context, requests = 0;
  const clicks = [];
  globalThis.document = {
    addEventListener(type, handler) { if (type === 'click') clicks.push(handler); },
    createElement: element, createTextNode: text => ({ textContent: text })
  };
  class FakeAudioContext {
    constructor() {
      context = this;
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.state = state;
      this.sources = [];
      this.resumeCalls = 0;
      this.listeners = [];
    }
    createGain() { return { gain: { value: 1, setValueAtTime() {} }, connect() {} }; }
    addEventListener(type, handler) { if (type === 'statechange') this.listeners.push(handler); }
    setState(value) { this.state = value; this.listeners.forEach(handler => handler()); }
    resume() {
      this.resumeCalls++;
      if (resume) return resume(this);
      this.setState('running');
      return Promise.resolve();
    }
    decodeAudioData() {
      return Promise.resolve({ numberOfChannels: 1, sampleRate: 1000, length: 1000, duration: 1,
        getChannelData: () => new Float32Array(1000).fill(0.1) });
    }
    createBufferSource() {
      const node = { starts: 0, stops: 0, disconnects: 0, connect() {},
        start() { this.starts++; }, stop() { this.stops++; }, disconnect() { this.disconnects++; } };
      this.sources.push(node);
      return node;
    }
  }
  globalThis.window = { AudioContext: FakeAudioContext };
  const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8),
    json: async () => ({ text: 'Hi.', alignment: { characters: ['H', 'i', '.'],
      character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.3] } }) });
  let fetchResponse = async () => response();
  globalThis.fetch = async url => { requests++; return fetchResponse(url); };
  const readout = element();
  const voice = createVoice({ caption: element(), readout });
  return { voice, readout, clicks, response,
    get context() { return context; }, get requests() { return requests; },
    setFetch(handler) { fetchResponse = handler; }
  };
}

test('a failed line can be fetched, decoded and spoken on retry; healthy lines stay cached', async () => {
  const env = setup();
  env.setFetch(async () => ({ ok: false }));
  await assert.rejects(env.voice.preload(['hello']), /Could not load/);
  assert.equal(env.requests, 2);
  env.setFetch(async () => env.response());
  await env.voice.preload(['hello']);
  assert.equal(env.requests, 4);
  await env.voice.preload(['hello']);
  assert.equal(env.requests, 4);
  const playing = env.voice.speak('hello');
  await tick();
  assert.equal(env.context.sources[0].starts, 1);
  assert.equal(env.readout.textContent, 'Speaking');
  env.context.sources[0].onended();
  assert.deepEqual(await playing, { status: 'completed' });
  assert.equal(env.readout.textContent, 'Silent');
});

test('simultaneous preloads share one request and can retry together after failure', async () => {
  const env = setup();
  const download = deferred();
  env.setFetch(() => download.promise);
  const a = env.voice.preload(['hello']), b = env.voice.preload(['hello']);
  const results = Promise.allSettled([a, b]);
  assert.equal(env.requests, 2);
  download.resolve({ ok: false });
  assert.ok((await results).every(result => result.status === 'rejected'));
  env.setFetch(async () => env.response());
  await Promise.all([env.voice.preload(['hello']), env.voice.preload(['hello'])]);
  assert.equal(env.requests, 4);
});

test('button activation resumes an interrupted context synchronously and shares the attempt', async () => {
  const resumed = deferred();
  const env = setup({ state: 'interrupted', resume: () => resumed.promise });
  await env.voice.preload(['hello']);
  env.clicks[0]({ target: { closest: () => ({}) } });
  assert.equal(env.context.resumeCalls, 1);
  const activation = env.voice.activate();
  assert.equal(env.context.resumeCalls, 1);
  env.context.setState('running');
  resumed.resolve();
  await activation;
  const playing = env.voice.speak('hello');
  await tick();
  assert.equal(env.context.sources[0].starts, 1);
  env.voice.stop();
  assert.deepEqual(await playing, { status: 'stopped' });
});

test('activation reports rejection, closed contexts and resumes that leave the clock stopped', async () => {
  for (const options of [
    { state: 'suspended', resume: () => Promise.reject(new Error('Denied')) },
    { state: 'interrupted', resume: () => Promise.resolve() },
    { state: 'closed' }
  ]) {
    const env = setup(options);
    await env.voice.preload(['hello']);
    await assert.rejects(env.voice.activate(), { code: 'AUDIO_UNAVAILABLE' });
    const result = await env.voice.speak('hello');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.error.code, 'AUDIO_UNAVAILABLE');
    assert.equal(env.context.sources.length, 0);
    assert.equal(env.voice.currentCues(), null);
    assert.equal(env.readout.textContent, 'Voice unavailable');
  }
});

test('a late resume rejection does not fail speech when another gesture started the clock', async () => {
  const resumed = deferred();
  const env = setup({ state: 'suspended', resume: () => resumed.promise });
  await env.voice.preload(['hello']);
  env.clicks[0]({ target: { closest: () => ({}) } });
  const playing = env.voice.speak('hello');
  assert.equal(env.context.resumeCalls, 1);
  env.context.setState('running');
  resumed.reject(new Error('Stale rejection'));
  await tick();
  assert.equal(env.readout.textContent, 'Speaking');
  assert.equal(env.context.sources[0].starts, 1);
  env.voice.stop();
  assert.deepEqual(await playing, { status: 'stopped' });
});

test('a resume that never settles times out and permits a fresh attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let attempts = 0;
  const env = setup({ state: 'suspended', resume: context => {
    if (++attempts === 1) return new Promise(() => {});
    context.setState('running');
    return Promise.resolve();
  } });
  await env.voice.preload(['hello']);
  const playing = env.voice.speak('hello');
  t.mock.timers.tick(1500);
  const result = await playing;
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error.code, 'AUDIO_UNAVAILABLE');
  assert.equal(env.context.sources.length, 0);
  await env.voice.activate();
  assert.equal(env.context.resumeCalls, 2);
  const retried = env.voice.speak('hello');
  await tick();
  assert.equal(env.readout.textContent, 'Speaking');
  env.context.sources[0].onended();
  assert.deepEqual(await retried, { status: 'completed' });
  assert.equal(env.readout.textContent, 'Silent');
});

test('stopping during activation settles immediately and prevents a late source', async () => {
  const resumed = deferred();
  const env = setup({ state: 'suspended', resume: () => resumed.promise });
  await env.voice.preload(['hello']);
  const playing = env.voice.speak('hello');
  env.voice.stop();
  assert.deepEqual(await playing, { status: 'stopped' });
  env.context.setState('running');
  resumed.resolve();
  await tick();
  assert.equal(env.context.sources.length, 0);
  assert.equal(env.voice.currentCues(), null);
});

test('stopping during activation keeps its stopped result after resume rejects', async () => {
  const resumed = deferred();
  const env = setup({ state: 'suspended', resume: () => resumed.promise });
  await env.voice.preload(['hello']);
  const playing = env.voice.speak('hello');
  env.voice.stop();
  assert.deepEqual(await playing, { status: 'stopped' });
  resumed.reject(new Error('Denied'));
  await tick();
  assert.equal(env.readout.textContent, 'Silent');
  assert.equal(env.context.sources.length, 0);
});

test('a cancelled line load failure cannot overwrite the status of its replacement', async () => {
  const env = setup();
  const download = deferred();
  env.setFetch(url => String(url).includes('/later.') ? download.promise : Promise.resolve(env.response()));
  await env.voice.preload(['hello']);
  const loading = env.voice.preload(['later']).catch(() => {});
  const waiting = env.voice.speak('later');
  const playing = env.voice.speak('hello');
  assert.deepEqual(await waiting, { status: 'stopped' });
  await tick();
  download.resolve({ ok: false });
  await loading;
  await tick();
  assert.equal(env.readout.textContent, 'Speaking');
  assert.equal(env.context.sources.length, 1);
  env.context.sources[0].onended();
  assert.deepEqual(await playing, { status: 'completed' });
  assert.equal(env.readout.textContent, 'Silent');
});

test('stopping a foreground preload retires its late status update', async () => {
  const env = setup();
  const download = deferred();
  env.setFetch(() => download.promise);
  const loading = env.voice.preload(['hello']).catch(() => {});
  assert.equal(env.readout.textContent, 'Loading');
  env.voice.stop();
  assert.equal(env.readout.textContent, 'Silent');
  download.resolve({ ok: false });
  await loading;
  assert.equal(env.readout.textContent, 'Silent');
});

test('an older foreground preload cannot replace the latest readiness status', async () => {
  const env = setup();
  const download = deferred();
  env.setFetch(url => String(url).includes('/later.') ? download.promise : Promise.resolve(env.response()));
  const older = env.voice.preload(['later']).catch(() => {});
  await env.voice.preload(['hello']);
  assert.equal(env.readout.textContent, 'Silent');
  download.resolve({ ok: false });
  await older;
  assert.equal(env.readout.textContent, 'Silent');
});

test('unrelated warming cannot change active or completed speech status', async () => {
  for (const finishFirst of [false, true]) {
    const env = setup();
    const download = deferred();
    env.setFetch(url => String(url).includes('/later.') ? download.promise : Promise.resolve(env.response()));
    await env.voice.preload(['hello']);
    const playing = env.voice.speak('hello');
    await tick();
    const warming = env.voice.preload(['later'], { background: true }).catch(() => {});
    assert.equal(env.readout.textContent, 'Speaking');
    if (finishFirst) env.context.sources[0].onended();
    download.resolve({ ok: false });
    await warming;
    assert.equal(env.readout.textContent, finishFirst ? 'Silent' : 'Speaking');
    if (!finishFirst) env.context.sources[0].onended();
    assert.deepEqual(await playing, { status: 'completed' });
    assert.equal(env.readout.textContent, 'Silent');
  }
});

test('successful background warming cannot clear the current interaction failure', async () => {
  const env = setup();
  const result = await env.voice.speak('missing');
  assert.equal(result.status, 'unavailable');
  await env.voice.preload(['hello'], { background: true });
  assert.equal(env.readout.textContent, 'Voice unavailable');
});

test('audio interruption during a cached line settles playback and disconnects its source', async () => {
  const env = setup();
  await env.voice.preload(['hello']);
  const playing = env.voice.speak('hello');
  await tick();
  env.context.setState('interrupted');
  const result = await playing;
  assert.equal(result.status, 'unavailable');
  assert.equal(result.error.code, 'AUDIO_UNAVAILABLE');
  assert.equal(env.context.sources[0].stops, 1);
  assert.equal(env.context.sources[0].disconnects, 1);
  assert.equal(env.voice.currentCues(), null);
  assert.equal(env.voice.lastReplyEnd().reason, 'interrupted');
  env.voice.stop();
  assert.equal(env.context.sources[0].stops, 1);
});
