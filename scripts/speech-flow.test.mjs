import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHeadFollow } from '../js/face.js';

// Exercise the real gesture/history/display pipeline using the real landmark
// layout and a small deterministic particle grid. No renderer or audio needed.
const landmarks = JSON.parse(readFileSync(new URL('../assets/face/face-landmarks.json', import.meta.url))).landmarks;
const points = [];
for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) points.push([.1 + x * .1, .1 + y * .1]);
for (const key of ['eyeL', 'eyeR', 'mouthCentre', 'noseTip']) points.push(landmarks[key]);
const coreEnd = points.length;
points.push([1.2, 1.3]); // Unattached background star.
const base = new Float32Array(points.flatMap(([u, v]) => [(u - .5) * 4, (.5 - v) * 4, .2]));
const pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
function create(amount = 1, reduce = false) {
  const count = points.length;
  const follow = createHeadFollow({ BASE: base, UV: new Float32Array(points.flat()),
    MAP_SCALE: 4, MAPS: { landmarks }, I: { face: [0, coreEnd], filaments: [coreEnd, coreEnd] },
    MOTION: { FLOW_PHASE: new Float32Array(count), EDGE_INDEX: [], DETACH_INDEX: [] } }, undefined, reduce);
  follow.applyTuning({ speechFlowAmount: amount, swarm: 0 });
  return follow;
}
const cue = (position, state = 'speaking') => ({ replyId: 1, position, state, cues: [] });
function frame(follow, position, dt = 1 / 60, windows = [], beats = []) {
  follow.updateGesture(dt, position === null ? null : cue(position), true, windows, beats);
  follow.update(dt, pose);
  const output = base.slice();
  follow.apply(base, output);
  return output;
}
function accent(follow, position = 1) {
  frame(follow, position, 0, [], [{ replyId: 1, position, strength: 1 }]);
}
const distance = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

test('travelling accents differ at the edges while protected features and background match baseline', () => {
  const moving = create(), baseline = create(0);
  accent(moving); accent(baseline);
  const a = frame(moving, 1.3), b = frame(baseline, 1.3);
  assert.ok(distance(a, b) > .025);
  for (let i = coreEnd - 4; i < points.length; i++)
    assert.deepEqual(a.slice(i * 3, i * 3 + 3), b.slice(i * 3, i * 3 + 3));
  assert.ok(a.every(Number.isFinite));
  assert.deepEqual(frame(create(), 0), base);
});
test('the travelling field agrees at 30, 60 and 120 fps', () => {
  const output = [];
  for (const fps of [30, 60, 120]) {
    const follow = create();
    accent(follow);
    let sample;
    for (let i = 1; i <= fps * .5; i++) sample = frame(follow, 1 + i / fps, 1 / fps);
    output.push(sample);
    assert.equal(follow.diagnostics.accent.starts, 1);
  }
  assert.ok(distance(output[0], output[1]) < 1e-6);
  assert.ok(distance(output[0], output[2]) < 1e-6);
});
test('audio gaps hold the entire travelling field, and interruption releases without a snap', () => {
  const follow = create();
  accent(follow);
  const held = frame(follow, 1.3);
  for (let i = 0; i < 120; i++) {
    follow.updateGesture(1 / 60, cue(1.3, 'gap'), true);
    const next = base.slice(); follow.apply(base, next);
    assert.deepEqual(next, held);
  }
  assert.deepEqual(frame(follow, null, 0), held);
  const tail = frame(follow, null, 1 / 60);
  assert.ok(distance(tail, held) < .002);
  for (let i = 0; i < 60; i++) frame(follow, null);
  assert.deepEqual(frame(follow, null), base);
});
test('a laugh takes over the visible field continuously and preserves standalone chuckle geometry', () => {
  const follow = create();
  accent(follow);
  const before = frame(follow, 1.3);
  const laugh = [{ id: 'laugh', kind: 'chuckle', start: 1.3, end: 2.5 }];
  assert.deepEqual(frame(follow, 1.3, 0, laugh), before);
  const controls = [create(), create(0)];
  for (let i = 0; i < 120; i++) {
    const position = 1.3 + i / 60;
    assert.deepEqual(frame(controls[0], position, 1 / 60, laugh), frame(controls[1], position, 1 / 60, laugh));
  }
});
test('reduced motion matches the earlier accent and spacing still prevents extra triggers', () => {
  const reduced = create(1, true), baseline = create(0);
  accent(reduced); accent(baseline);
  for (let i = 0; i < 120; i++)
    assert.deepEqual(frame(reduced, 1 + i / 60), frame(baseline, 1 + i / 60));
  const follow = create();
  for (let i = 0; i < 600; i++) {
    const position = 1 + i / 60;
    frame(follow, position, 1 / 60, [], [{ replyId: 1, position, strength: 1 }]);
  }
  assert.equal(follow.diagnostics.accent.starts, 4);
});
