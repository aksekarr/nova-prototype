import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(process.env.NOVA_IDLE_SOURCE
  || new URL('../js/idle-forms.js', import.meta.url), 'utf8');
const { createIdleForms } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const quiet = { mode: 'face', monitorInput: true, inputReady: true, inputLevel: 0 };
function sample(control, start, end, observation = quiet) {
  const actions = [];
  for (let tick = start; tick <= end; tick++) {
    const action = control.update(tick / 10, observation);
    if (action) actions.push({ time: tick / 10, action });
  }
  return actions;
}

test('Orbit starts only after 25 continuously observed quiet seconds', () => {
  const control = createIdleForms();
  assert.deepEqual(sample(control, 0, 249), []);
  assert.equal(control.update(25, quiet), 'orbit');
  assert.deepEqual(sample(control, 251, 600, { ...quiet, mode: 'orbit' }), []);
});

test('audio, pending replies, scripts and tuning each restart the quiet interval', () => {
  for (const flag of ['audioActive', 'replyPending', 'scriptActive', 'tuningActive']) {
    const control = createIdleForms();
    sample(control, 0, 249);
    assert.deepEqual(sample(control, 250, 500, { ...quiet, [flag]: true }), [], flag);
    assert.deepEqual(sample(control, 501, 749), [], flag);
    assert.equal(control.update(75, quiet), 'orbit', flag);
  }
});

test('real microphone activity wakes Orbit and hysteresis prevents false quiet between words', () => {
  const control = createIdleForms();
  sample(control, 0, 249);
  assert.equal(control.update(25, { ...quiet, mode: 'orbit', inputLevel: .04 }), 'face');
  assert.deepEqual(sample(control, 251, 600, { ...quiet, inputLevel: .015 }), []);
  assert.deepEqual(sample(control, 601, 849), []);
  assert.equal(control.update(85, quiet), 'orbit');
});

test('unavailable input and unconfirmed noise never qualify as observed silence', () => {
  for (const observation of [{ inputReady: false }, { inputLevel: NaN },
    { inputLevel: null }, { inputLevel: .015 }, { liveReady: false }]) {
    const control = createIdleForms();
    assert.deepEqual(sample(control, 0, 400, { ...quiet, ...observation }), []);
  }
  const control = createIdleForms();
  sample(control, 0, 249);
  assert.deepEqual(sample(control, 250, 600, { ...quiet, inputLevel: .015 }), []);
});

test('backgrounding and long observation gaps do not count as quiet time', () => {
  const control = createIdleForms();
  sample(control, 0, 100);
  assert.equal(control.update(40, quiet), null);
  assert.deepEqual(sample(control, 401, 649), []);
  assert.equal(control.update(65, quiet), 'orbit');
  assert.deepEqual(sample(control, 651, 1000, { ...quiet, visible: false }), []);
  assert.deepEqual(sample(control, 1001, 1249), []);
  assert.equal(control.update(125, quiet), 'orbit');
});

test('new activity cancels idle synchronously and manual return starts a fresh interval', () => {
  const control = createIdleForms();
  sample(control, 0, 250);
  assert.equal(control.activity(25.1, 'orbit'), 'face');
  assert.equal(control.activity(25.2, 'face'), null);
  assert.deepEqual(sample(control, 253, 501), []);
  assert.equal(control.update(50.2, quiet), 'orbit');
  control.reset(50.3);
  assert.deepEqual(sample(control, 504, 752), []);
});

test('the toggle and other forms prevent automatic entry without disabling activity wake-up', () => {
  for (const mode of ['nebula', 'tree', 'orbit']) {
    const control = createIdleForms();
    assert.deepEqual(sample(control, 0, 400, { mode }), []);
  }
  const control = createIdleForms();
  control.setEnabled(false, 0);
  assert.deepEqual(sample(control, 0, 400), []);
  assert.equal(control.activity(40, 'orbit'), 'face');
  control.setEnabled(true, 40);
  assert.deepEqual(sample(control, 401, 649), []);
  assert.equal(control.update(65, quiet), 'orbit');
});

test('standalone quiet can idle without requesting microphone access', () => {
  const control = createIdleForms();
  assert.deepEqual(sample(control, 0, 250, { mode: 'face' }), [{ time: 25, action: 'orbit' }]);
});
