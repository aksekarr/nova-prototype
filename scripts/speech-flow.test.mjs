import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHeadFollow } from '../js/face.js';
import { createCueExpressions, EXPR, POSE_CONTROLS } from '../js/face-expressions.js';
import vm from 'node:vm';

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

const stageSource = readFileSync(new URL('../js/stage.js', import.meta.url), 'utf8');
const liveObject = name => JSON.parse(JSON.stringify(vm.runInNewContext(
  '(' + stageSource.match(new RegExp('  ' + name + ': (\\{[\\s\\S]*?\\n  \\}),'))[1] + ')')));
const liveMap = liveObject('cueMap'), livePoses = liveObject('eyePoses');
const sighWindow = [{ id: 'sigh', kind: 'sigh', start: 1, end: 2.1 }];
const extent = (buffer, axis) => {
  const values = Array.from({ length: coreEnd }, (_, i) => buffer[i * 3 + axis]);
  return Math.max(...values) - Math.min(...values);
};

test('Sighs routes through one aligned gesture occurrence and corrected retired cues cannot replay it', () => {
  const control = createCueExpressions();
  control.applyTuning({ cueMap: liveMap });
  const tag = { id: 's1', type: 'tag', name: 'sighs', start: 1, end: 1.3 };
  const sample = (position, cue = tag) => control.update(1 / 60, { ...cueAt(position), cues: [cue] });
  function cueAt(position) { return { replyId: 1, state: 'speaking', position }; }
  const pose = sample(1.2);
  assert.ok(pose.weights.sigh > 0);
  assert.equal(pose.weights.concern, undefined);
  assert.deepEqual(control.gestureWindows, [{ id: 's1', kind: 'sigh', start: 1, end: 2.1 }]);
  assert.equal(control.blockingEvent, true);
  sample(2.2);
  assert.deepEqual(control.gestureWindows, []);
  sample(3.2, { ...tag, start: 3, end: 3.3 });
  assert.deepEqual(control.gestureWindows, []);
});
test('sigh gathers, widens more strongly, then reforms without moving background particles', () => {
  const follow = create();
  frame(follow, 1, 0, sighWindow);
  const gathered = frame(follow, 1.2, .2, sighWindow);
  const released = frame(follow, 1.7, .5, sighWindow);
  assert.ok(extent(gathered, 0) < extent(base, 0));
  assert.ok(extent(gathered, 1) > extent(base, 1));
  assert.ok(extent(released, 0) > extent(base, 0));
  assert.ok(extent(released, 1) < extent(base, 1));
  assert.ok(extent(released, 0) - extent(base, 0) > extent(base, 0) - extent(gathered, 0));
  assert.deepEqual(released.slice(coreEnd * 3), base.slice(coreEnd * 3));
  assert.ok(released.every(Number.isFinite));
  assert.deepEqual(frame(follow, 2.2, .5, sighWindow), base);
  for (let i = 0; i < 10; i++) frame(follow, 2.2, 0, sighWindow);
  assert.equal(follow.diagnostics.gesture.starts, 1);
});
test('sigh geometry agrees at 30, 60 and 120 fps across gather, release and reform', () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const follow = create(), snapshots = [];
    frame(follow, 1, 0, sighWindow);
    for (let i = 1; i <= fps; i++) {
      const positions = frame(follow, 1 + i / fps, 1 / fps, sighWindow);
      if ([.2, .5, .7, 1].some(t => Math.abs(i / fps - t) < 1e-9)) snapshots.push(positions);
    }
    results.push(snapshots);
  }
  for (const result of results.slice(1)) result.forEach((positions, i) =>
    assert.ok(distance(positions, results[0][i]) < 1e-6));
});
test('sigh pauses through gaps, alignment corrections do not jump or restart it, and interruption releases it', () => {
  const follow = create();
  frame(follow, 1, 0, sighWindow);
  const held = frame(follow, 1.6, .6, sighWindow);
  for (let i = 0; i < 30; i++) {
    follow.updateGesture(1 / 60, cue(1.6, 'gap'), true, sighWindow);
    const output = base.slice(); follow.apply(base, output);
    assert.deepEqual(output, held);
  }
  const corrected = [{ ...sighWindow[0], start: 1.15 }];
  assert.deepEqual(frame(follow, 1.6, 0, corrected), held);
  assert.equal(follow.diagnostics.gesture.starts, 1);
  assert.deepEqual(frame(follow, null, 0), held);
  assert.ok(distance(frame(follow, null), held) < .005);
  for (let i = 0; i < 60; i++) frame(follow, null);
  assert.deepEqual(frame(follow, null), base);
});
test('sigh handovers preserve the visible field and ordinary beats cannot pile on top', () => {
  const follow = create(); accent(follow);
  const before = frame(follow, 1.3);
  const sigh = [{ ...sighWindow[0], start: 1.3, end: 2.4 }];
  assert.deepEqual(frame(follow, 1.3, 0, sigh), before);
  const released = frame(follow, 1.9, .6, sigh,
    [{ replyId: 1, position: 1.9, strength: 1 }]);
  assert.equal(follow.diagnostics.accent.starts, 1);
  const laugh = [{ id: 'laugh', kind: 'chuckle', start: 1.9, end: 3 }];
  assert.deepEqual(frame(follow, 1.9, 0, laugh), released);
});
test('reduced motion and disabled sigh gestures retain the facial-only path', () => {
  for (const setting of [{ sighAmount: 0 }, { gestureAmount: 0 }]) {
    const follow = create();
    follow.applyTuning(setting);
    for (let i = 0; i < 90; i++) assert.deepEqual(frame(follow, 1 + i / 60, 1 / 60, sighWindow), base);
    assert.equal(follow.diagnostics.gesture.starts, 0);
  }
  // Reduced motion must ignore an enabled setting too.
  const reduced = create(1, true);
  reduced.applyTuning({ sighAmount: 1 });
  assert.deepEqual(frame(reduced, 1.5, .5, sighWindow), base);
  assert.equal(reduced.diagnostics.gesture.starts, 0);
});
test('new live tag poses are complete and keep silent mouth aperture and body squash neutral', () => {
  for (const name of ['confident', 'warm', 'sigh']) {
    assert.deepEqual(livePoses[name], EXPR[name]);
    for (const [key, , low, high] of POSE_CONTROLS)
      assert.ok(Number.isFinite(livePoses[name][key]) && livePoses[name][key] >= low && livePoses[name][key] <= high);
    for (const key of ['mouthOpen', 'mouthRound', 'mouthPress', 'squashStretch', 'gazeX', 'gazeY'])
      assert.equal(livePoses[name][key], 0);
  }
  assert.equal(liveMap.confidently.pose, 'confident');
  assert.equal(liveMap.warmly.pose, 'warm');
  assert.equal(liveMap.curious.pose, 'focused');
  assert.equal(liveMap.thoughtful.pose, 'thinking');
  assert.equal(liveMap.chuckles.pose, 'laugh');
});
