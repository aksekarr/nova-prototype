import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createCueExpressions, createMoodPerformance } from '../js/face-expressions.js';
import { createFaceHead } from '../js/facehead.js';
import { createFaceForm } from '../js/face-form.js';
import { createFace } from '../js/face.js';
import { createShapes } from '../js/shapes.js';

const cueMap = {
  thoughtful: { kind: 'mood', pose: 'thinking', amount: .75 },
  curious: { kind: 'mood', pose: 'focused', amount: .85 },
  warmly: { kind: 'mood', pose: 'warm', amount: 1 },
  laughing: { kind: 'laugh', pose: 'laugh', amount: 1 },
  sighs: { kind: 'sigh', pose: 'sigh', amount: .8 }
};
const tag = (name, start = 0) => ({ id: name, type: 'tag', name, start, end: start + .5 });
const reply = (position, cues = [], state = 'speaking') => ({ replyId: 1, position, state, cues });
function make(reduce = false) {
  const cues = createCueExpressions(), body = createMoodPerformance(reduce);
  cues.applyTuning({ cueMap });
  body.applyTuning({ moodPerformanceAmount: 1 });
  return { cues, body };
}
function advance(pair, time, input, fps = 60, start = 0) {
  for (let frame = 1; frame <= time * fps; frame++) {
    const blend = pair.cues.update(1 / fps, reply(start + frame / fps, input));
    pair.body.update(1 / fps, blend.weights);
  }
  return structuredClone(pair.body.state);
}

test('authored tilt is visible, speed bounded, and consistent across display rates', () => {
  const held = [];
  for (const fps of [30, 60, 120]) {
    const pair = make();
    let previous = 0;
    for (let frame = 1; frame <= 2 * fps; frame++) {
      const blend = pair.cues.update(1 / fps, reply(frame / fps, [tag('thoughtful')]));
      const state = pair.body.update(1 / fps, blend.weights);
      assert.ok(Math.abs(state.roll - previous) * fps < 24.001);
      assert.ok(Object.values(state).every(Number.isFinite));
      previous = state.roll;
    }
    held.push(previous);
    assert.ok(previous > 5 && previous < 15, 'deliberate tilt must exceed incidental roll');
  }
  assert.ok(Math.max(...held) - Math.min(...held) < .01);
});

test('playback gaps freeze acting; interruption fades from the visible value', () => {
  const pair = make();
  const held = advance(pair, 1.2, [tag('thoughtful')]);
  for (let i = 0; i < 30; i++) {
    const blend = pair.cues.update(.05, reply(1.2, [tag('thoughtful')], 'gap'));
    assert.deepEqual(pair.body.update(.05, blend.weights, true, true), held);
  }
  const blend = pair.cues.update(1 / 60, null, { replyId: 1, reason: 'interrupted' });
  const first = pair.body.update(1 / 60, blend.weights);
  assert.ok(first.roll > held.roll - .4 && first.roll <= held.roll + .01);
  for (let i = 0; i < 240; i++) {
    const release = pair.cues.update(1 / 60, null);
    pair.body.update(1 / 60, release.weights);
  }
  assert.ok(Object.values(pair.body.state).every(value => value === 0));
});

test('natural completion cannot start a future performance; events hand over smoothly', () => {
  const unseen = make();
  advance(unseen, .2, [tag('thoughtful', 4)]);
  for (let i = 0; i < 120; i++) {
    const blend = unseen.cues.update(1 / 60, null, { replyId: 1, reason: 'complete' });
    unseen.body.update(1 / 60, blend.weights);
  }
  assert.ok(Object.values(unseen.body.state).every(value => value === 0));
  const pair = make();
  advance(pair, 1, [tag('thoughtful')]);
  const before = pair.body.state.roll;
  const blend = pair.cues.update(.01, reply(1.01, [tag('thoughtful'), tag('laughing', 1)]));
  assert.ok(Math.abs(pair.body.update(.01, blend.weights).roll - before) < .24);
  advance(pair, 6, [tag('thoughtful'), tag('laughing', 1)], 60, 1.01);
  assert.ok(Math.abs(pair.body.state.roll) < 1e-7);
});

test('reduced motion keeps expression priority and omits the new body/gaze contribution', () => {
  const pair = make(true);
  const state = advance(pair, 2, [tag('thoughtful')]);
  assert.ok(state.priority > .9);
  for (const [key, value] of Object.entries(state)) if (key !== 'priority') assert.equal(value, 0);
});

test('foreground gaze does not change scheduled blinks, speech beats or random draws', () => {
  const controls = [0, 0];
  const heads = controls.map((_, index) => createFaceHead(false, { random() { controls[index]++; return .2; } }));
  for (let frame = 0; frame < 240; frame++) {
    const input = { speaking: true, envelope: .3 + Math.sin(frame * .2) * .2 };
    const normal = { ...heads[0].update(1 / 60, input) };
    const focused = heads[1].update(1 / 60, { ...input, performance: { focus: 1 } });
    assert.equal(Math.abs(focused.yaw), 0);
    assert.equal(Math.abs(focused.gazeX), 0);
    assert.equal(Math.abs(focused.gazeY), 0);
    assert.equal(focused.blink, normal.blink);
    assert.deepEqual(heads[1].consumeBeats(), heads[0].consumeBeats());
    assert.deepEqual(heads[1].consumePhraseEvents(), heads[0].consumePhraseEvents());
    assert.equal(controls[1], controls[0]);
  }
});

test('mood silhouette works with idle flow off and protects features and detached particles', () => {
  const base = new Float32Array([-1, 1, 0, 0, 0, 0, 1, -1, 0, 2, 1, 1]);
  for (const reduce of [false, true]) {
    const form = createFaceForm({ base, edge: new Float32Array([1, 0, 1]), end: 3,
      width: 2, height: 2, centreX: 0, centreY: 0 }, reduce);
    form.setAmount(0);
    form.update(1 / 60, false, 0, { width: -.15, height: .12, bend: .05, asymmetry: .04 });
    const result = form.apply(base, new Float32Array([1, 1, 0, 1]));
    if (reduce) assert.strictEqual(result, base);
    else {
      assert.notDeepEqual(result.slice(0, 3), base.slice(0, 3));
      assert.deepEqual(result.slice(3), base.slice(3));
    }
  }
});

const landmarks = JSON.parse(readFileSync(new URL('../assets/face/face-landmarks.json', import.meta.url))).landmarks;
const maps = {
  colour: { width: 16, height: 16, data: new Float32Array(16 * 16 * 3).fill(.3) },
  mask: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(1) },
  depth: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(.5) },
  average: [.3, .3, .3], landmarks
};
function driver(amount) {
  const designs = createShapes(600, maps), shapes = { ...designs, ...designs.FACE_V3 };
  const original = Math.random;
  let seed = 73, face;
  Math.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  try { face = createFace(shapes, false); } finally { Math.random = original; }
  face.applyTuning({ cueMap, moodPerformanceAmount: amount });
  face.setReplyText('Synthetic mood performance regression.');
  return { face, shapes };
}

test('real driver preserves untagged replies and existing laugh/sigh performances exactly', () => {
  for (const cues of [[], [tag('laughing')], [tag('sighs')]]) {
    const controls = [driver(0), driver(1)];
    for (let frame = 1; frame <= 240; frame++) {
      const time = frame / 60;
      for (const { face } of controls) face.update(1 / 60, time, reply(time, cues),
        .3 + Math.sin(frame * .2) * .2, { w: 1, h: 1, round: 0, close: .2 }, true);
      assert.deepEqual(controls[1].face.diagnostics.pose, controls[0].face.diagnostics.pose);
      assert.deepEqual(controls[1].face.diagnostics.mouth, controls[0].face.diagnostics.mouth);
      assert.deepEqual(controls[1].shapes.FACE, controls[0].shapes.FACE);
      assert.deepEqual(controls[1].shapes.FACE_COL, controls[0].shapes.FACE_COL);
    }
  }
});

test('real mood priority suppresses competing movement without altering articulation or cue timing', () => {
  const controls = [driver(0), driver(1)];
  for (let frame = 1; frame <= 120; frame++) {
    const time = frame / 60;
    for (const { face } of controls) face.update(1 / 60, time, reply(time, [tag('thoughtful')]),
      .3 + Math.sin(frame * .2) * .2, { w: .8, h: 1.1, round: .3, close: .2 }, true);
    assert.deepEqual(controls[1].face.diagnostics.cues, controls[0].face.diagnostics.cues);
    assert.deepEqual(controls[1].face.diagnostics.mouth.shape, controls[0].face.diagnostics.mouth.shape);
    assert.equal(controls[1].face.diagnostics.mouth.envelope, controls[0].face.diagnostics.mouth.envelope);
  }
  assert.ok(controls[1].face.diagnostics.micro.suppression > .9);
  assert.ok(controls[0].face.diagnostics.micro.suppression < .8);
  assert.ok(controls[1].face.diagnostics.pose.roll > 5);
});
