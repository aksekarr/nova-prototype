import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { EXPR, createCueExpressions, createMoodPerformance } from '../js/face-expressions.js';
import { createMoodEdgeFlow } from '../js/mood-edge-flow.js';

const source = readFileSync(new URL('../js/stage.js', import.meta.url), 'utf8');
const cueMap = vm.runInNewContext('(' + source.match(/  cueMap: (\{[\s\S]*?\n  \}),/)[1] + ')');
const eyePoses = vm.runInNewContext('(' + source.match(/  eyePoses: (\{[\s\S]*?\n  \}),/)[1] + ')');
const tag = (name, start = 0) => ({ id: name, type: 'tag', name, start, end: start + .5 });
const reply = (position, cues, options = {}) => ({ replyId: 1, state: 'speaking', position, cues, ...options });
function create(reduce = false) {
  const cues = createCueExpressions(), body = createMoodPerformance(reduce);
  cues.applyTuning({ cueMap, sustainMoods: true });
  body.applyTuning({ moodPerformanceAmount: 1 });
  return { cues, body };
}

test('sculpting and live defaults agree for all authored poses; concern aliases resolve identically', () => {
  for (const name of Object.keys(EXPR)) for (const [key, value] of Object.entries(EXPR[name]))
    // The surprised smile is an older explicit stage override.
    if (!(name === 'surprised' && key === 'smile')) assert.equal(eyePoses[name][key], value, name + ':' + key);
  assert.equal(cueMap.concerned.pose, 'concern');
  assert.deepEqual(cueMap.concerned, cueMap.concern);
});

test('mood arrival prepares once, settles without rocking, and outer form follows the head', () => {
  for (const fps of [30, 60, 120]) {
    const { cues, body } = create();
    let dip = 0, headArrived = null, formArrived = null;
    for (let frame = 1; frame <= 2.4 * fps; frame++) {
      const time = frame / fps, blend = cues.update(1 / fps, reply(time, [tag('confidently')]));
      const pose = body.update(1 / fps, blend.weights);
      dip = Math.min(dip, pose.pitch);
      if (pose.pitch >= 2.6 * .9 && headArrived === null) headArrived = time;
      if (pose.height >= .19 * .9 && formArrived === null) formArrived = time;
    }
    assert.ok(dip < -.3, 'clear but brief preparatory dip');
    assert.ok(headArrived > .5 && headArrived < 1.2);
    assert.ok(formArrived > headArrived, 'silhouette finishes after head');
    assert.ok(Math.abs(body.state.pitch - 2.6) < .001, 'no ongoing preparatory rocking');
  }
});

test('body and filament tails preserve smooth gap, interruption and replacement behaviour', () => {
  const { cues, body } = create();
  const edges = createMoodEdgeFlow({ base: new Float32Array([-1, 1, 0]), edge: new Float32Array([1]),
    coreEnd: 0, end: 1, width: 2, height: 2, centreX: 0, centreY: 0 });
  edges.applyTuning({ moodEdgeAmount: 1 });
  for (let frame = 1; frame <= 144; frame++) {
    const input = reply(frame / 60, [tag('concerned')]);
    const blend = cues.update(1 / 60, input);
    body.update(1 / 60, blend.weights); edges.update(1 / 60, input, blend.weights);
  }
  const held = structuredClone(body.state), edgeHeld = structuredClone(edges.state);
  for (let frame = 0; frame < 60; frame++) {
    const input = reply(2.4, [tag('concerned')], { state: 'gap' });
    const blend = cues.update(.1, input);
    assert.deepEqual(body.update(.1, blend.weights, true, true), held);
    assert.deepEqual(edges.update(.1, input, blend.weights), edgeHeld);
  }
  const replacement = reply(0, [tag('curious')], { replyId: 2 });
  const mixed = cues.update(0, replacement);
  assert.deepEqual(body.update(0, mixed.weights), held);
  assert.deepEqual(edges.update(0, replacement, mixed.weights), edgeHeld);
  for (let frame = 0; frame < 360; frame++) {
    const blend = cues.update(1 / 60, null, frame === 0 ? { replyId: 2, reason: 'interrupted' } : null);
    const pose = body.update(1 / 60, blend.weights);
    edges.update(1 / 60, null, blend.weights);
    assert.ok(Object.values(pose).every(Number.isFinite));
  }
  assert.ok(Object.values(body.state).every(value => value === 0));
  assert.equal(edges.state.concern, 0);
});

test('distinct mood signatures survive the held attitude, and concern retires without reviving', () => {
  const signatures = [];
  for (const name of ['thoughtful', 'warmly', 'curious', 'confidently', 'concerned']) {
    const { cues, body } = create();
    for (let frame = 1; frame <= 270; frame++) {
      const blend = cues.update(1 / 60, reply(frame / 60, [tag(name)]));
      body.update(1 / 60, blend.weights);
    }
    signatures.push({ name, ...body.state });
  }
  const byName = Object.fromEntries(signatures.map(item => [item.name, item]));
  assert.ok(byName.thoughtful.roll > 4);
  assert.ok(byName.warmly.width > .07 && byName.warmly.height < 0);
  assert.ok(byName.curious.width < -.04 && byName.curious.height > .07);
  assert.ok(byName.confidently.pitch > 1.5 && byName.confidently.width > .04);
  assert.ok(byName.concerned.pitch < -1 && byName.concerned.width < -.06 && byName.concerned.height < 0);
  const { cues } = create();
  cues.update(1 / 60, reply(1, [tag('concerned')]));
  cues.update(1 / 60, reply(9, [tag('concerned')]));
  const corrected = cues.update(1 / 60, reply(9.1, [{ ...tag('concerned'), start: 8 }]));
  assert.equal(corrected.weights.concern || 0, 0);
});
