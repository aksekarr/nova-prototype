import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createMoodEdgeFlow } from '../js/mood-edge-flow.js';
import { createCueExpressions } from '../js/face-expressions.js';
import { createHeadFollow, createFace } from '../js/face.js';
import { createShapes } from '../js/shapes.js';

const base = new Float32Array([-1, 1, .2, 0, 0, 0, 1, -1, -.2, 1.3, .6, .1, 2, 1, 1]);
const attachment = new Float32Array([1, 1, 1, .1, 0]);
const reply = (position, options = {}) => ({ replyId: 1, position, state: 'speaking', cues: [], ...options });
function create(amount = 1, reduce = false) {
  const flow = createMoodEdgeFlow({ base, edge: new Float32Array([1, 0, 1, 1]), coreEnd: 3, end: 4,
    width: 2, height: 2, centreX: 0, centreY: 0 }, reduce);
  if (amount !== null) flow.applyTuning({ moodEdgeAmount: amount });
  return flow;
}
function advance(flow, weights, seconds = 2, fps = 60, start = 0) {
  if (start === 0) flow.update(0, reply(0), weights);
  for (let frame = 1; frame <= seconds * fps; frame++) flow.update(1 / fps, reply(start + frame / fps), weights);
  return flow.apply(base, attachment).slice();
}
const distance = (a, b) => Math.max(...a.map((value, i) => Math.abs(value - b[i])));
const stageSource = readFileSync(new URL('../js/stage.js', import.meta.url), 'utf8');
const liveMap = vm.runInNewContext('(' + stageSource.match(/  cueMap: (\{[\s\S]*?\n  \}),/)[1] + ')');

test('edge flow is tunable, ignores unknown weights, and reduced motion is exact identity', () => {
  for (const [amount, reduce, weights] of [[null, false, { warm: 1 }], [0, false, { thinking: .75 }],
    [1, true, { warm: 1 }], [1, false, { unknown: 1 }]]) {
    const flow = create(amount, reduce);
    advance(flow, weights);
    assert.strictEqual(flow.apply(base, attachment), base);
    assert.equal(flow.state.time, 0);
  }
  const flow = create();
  flow.update(NaN, reply(0), { thinking: NaN, warm: Infinity });
  assert.ok(Object.values(flow.state).every(Number.isFinite));
});

test('flow protects features, background and source buffers while reaching the filament beyond its root', () => {
  const flow = create(), original = base.slice();
  const output = advance(flow, { warm: 1 });
  assert.ok(distance(output, base) > .02);
  assert.deepEqual(output.slice(3, 6), base.slice(3, 6));
  assert.deepEqual(output.slice(12), base.slice(12));
  assert.ok(distance(output.slice(9, 12), base.slice(9, 12)) > .02);
  assert.deepEqual(base, original);
  for (let i = 2; i < base.length; i += 3) assert.equal(output[i], base[i]);
  assert.strictEqual(flow.apply(base, attachment, 0), base);
});

test('all expression fields have distinct continuous motion at lower strength', () => {
  const outputs = [];
  for (const weights of [{ thinking: .36 }, { warm: .55 }, { focused: .36 }, { confident: .58 },
    { concern: .62 }, { content: .5 }, { delighted: .36 }, { laugh: .75 }, { sigh: .8 }]) {
    const flow = create(), first = advance(flow, weights, 4);
    const next = advance(flow, weights, 1, 60, 4);
    assert.ok(distance(first, next) > .001, JSON.stringify(weights));
    assert.ok(distance(next, base) > .01);
    assert.ok(distance(next, base) < .28);
    outputs.push(next);
  }
  for (let i = 0; i < outputs.length; i++) for (let j = 0; j < i; j++)
    assert.ok(distance(outputs[i], outputs[j]) > .01, `fields ${i} and ${j} should differ`);
});

test('gaps freeze strength and phase; reply replacement and disable release without snapping', () => {
  const flow = create(), held = advance(flow, { thinking: .75 });
  const before = { ...flow.state };
  for (let frame = 0; frame < 120; frame++) {
    flow.update(1, reply(2, { state: 'gap' }), { thinking: .75 });
    assert.deepEqual(flow.apply(base, attachment), held);
    assert.deepEqual(flow.state, before);
  }
  flow.update(0, reply(0, { replyId: 2 }), {});
  assert.deepEqual(flow.apply(base, attachment), held);
  assert.equal(flow.state.time, before.time);
  flow.applyTuning({ moodEdgeAmount: 0 });
  flow.update(1 / 60, reply(1 / 60, { replyId: 2 }), { thinking: .75 });
  assert.ok(distance(flow.apply(base, attachment), held) < .004);
  for (let frame = 0; frame < 240; frame++) flow.update(1 / 60, null, {});
  assert.strictEqual(flow.apply(base, attachment), base);
});

test('analytic waves agree at 30, 60 and 120 fps and stay bounded throughout transitions', () => {
  const names = ['thinking', 'warm', 'focused', 'confident', 'concern', 'content', 'delighted', 'laugh', 'sigh'];
  const outputs = [];
  for (const fps of [30, 60, 120]) {
    const flow = create();
    flow.update(0, reply(0), {});
    let previous = base.slice();
    for (let frame = 1; frame <= 18 * fps; frame++) {
      const time = frame / fps;
      flow.update(1 / fps, reply(time), { [names[Math.min(8, Math.floor((frame - 1) / (2 * fps)))]]: .75 });
      const output = flow.apply(base, attachment).slice();
      assert.ok(output.every(Number.isFinite));
      assert.ok(distance(output, base) < .28);
      assert.ok(distance(output, previous) * fps < 1.2);
      previous = output;
    }
    outputs.push(previous);
  }
  for (const output of outputs.slice(1)) assert.ok(distance(outputs[0], output) < 1e-6);
});

test('cue retirement and early endings remain authoritative over particle response', () => {
  const cues = createCueExpressions(), flow = create();
  cues.applyTuning({ sustainMoods: true, cueMap: {
    thoughtful: { kind: 'mood', pose: 'thinking', amount: .75 }
  } });
  const tags = [{ id: 'current', type: 'tag', name: 'thoughtful', start: 0, end: .5 },
    { id: 'future', type: 'tag', name: 'thoughtful', start: 20, end: 20.5 }];
  for (let frame = 1; frame <= 270; frame++) {
    const input = reply(frame / 60, { cues: tags });
    flow.update(1 / 60, input, cues.update(1 / 60, input).weights);
  }
  const held = flow.apply(base, attachment).slice();
  const release = cues.update(0, null, { replyId: 1, reason: 'interrupted' });
  flow.update(0, null, release.weights);
  assert.deepEqual(flow.apply(base, attachment), held);
  for (let frame = 0; frame < 240; frame++) flow.update(1 / 60, null, cues.update(1 / 60, null).weights);
  assert.strictEqual(flow.apply(base, attachment), base);
  assert.equal(cues.state.retired.includes('future'), false);
});

const landmarks = JSON.parse(readFileSync(new URL('../assets/face/face-landmarks.json', import.meta.url))).landmarks;
test('real display field protects landmark particles, detached stars and clearance points', () => {
  const points = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) points.push([.1 + x * .1, .1 + y * .1]);
  const protectedStart = points.length;
  for (const key of ['eyeL', 'eyeR', 'mouthCentre', 'noseTip']) points.push(landmarks[key]);
  const detached = points.length;
  points.push([.95, .2]);
  const coreEnd = points.length;
  points.push([1.1, .2], [1.2, .7]);
  const end = points.length;
  points.push([1.8, 1.5]);
  const intrinsic = new Float32Array(points.flatMap(([u, v]) => [(u - .5) * 4, (.5 - v) * 4, .2]));
  const follow = createHeadFollow({ BASE: intrinsic, UV: new Float32Array(points.flat()), MAP_SCALE: 4,
    MAPS: { landmarks }, I: { face: [0, coreEnd], filaments: [coreEnd, end] },
    MOTION: { FLOW_PHASE: new Float32Array(points.length).fill(.8), EDGE_INDEX: [], DETACH_INDEX: [detached] } });
  follow.applyTuning({ moodEdgeAmount: 1, swarm: 0 });
  follow.update(0, { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 });
  const source = intrinsic.slice(), output = new Float32Array(source.length);
  source[detached * 3] += 2;
  const poses = [...new Set(Object.values(liveMap).map(mapping => mapping.pose))];
  for (let index = 0; index < poses.length; index++) {
    const pose = poses[index];
    for (let frame = 1; frame <= 120; frame++)
      follow.updateMoodEdges(1 / 60, reply(index * 2 + frame / 60), { [pose]: 1 });
    follow.apply(source, output);
    assert.ok(distance(source, output) > .03, pose);
    assert.deepEqual(output.slice(protectedStart * 3, coreEnd * 3), source.slice(protectedStart * 3, coreEnd * 3), pose);
    assert.deepEqual(output.slice(end * 3), source.slice(end * 3), pose);
  }
  const point = { x: .1, y: .2, z: .3 };
  assert.deepEqual(follow.transformPoint({ ...point }), point);
  assert.ok(follow.diagnostics.moodEdges.maxDisplacement > .03);
});

test('real face driver changes only display positions, preserving mouth, eyes, head and intrinsic particle motion', () => {
  const maps = { colour: { width: 16, height: 16, data: new Float32Array(16 * 16 * 3).fill(.3) },
    mask: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(1) },
    depth: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(.5) }, average: [.3, .3, .3], landmarks };
  function driver(amount) {
    const designs = createShapes(600, maps), shapes = { ...designs, ...designs.FACE_V3 };
    const original = Math.random;
    let seed = 73, face;
    Math.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    try { face = createFace(shapes, false); } finally { Math.random = original; }
    face.applyTuning({ moodEdgeAmount: amount, sustainMoods: true, moodPerformanceAmount: 1,
      cueMap: liveMap });
    return { face, shapes };
  }
  for (const name of ['thoughtful', 'warmly', 'curious', 'confidently', 'concerned', 'chuckles', 'laughing', 'sighs', 'cheerful', 'excited']) {
    const controls = [driver(0), driver(1)];
    let maximumDifference = 0;
    for (let frame = 1; frame <= 300; frame++) {
      const time = frame / 60;
      for (const { face } of controls) face.update(1 / 60, time, reply(time, { cues: [
        { id: name, type: 'tag', name, start: 0, end: .5 }
      ] }), .3 + Math.sin(frame * .2) * .2, { w: .8, h: 1.1, round: .3, close: .2 }, true);
      for (const key of ['mouth', 'eyes', 'pose', 'cues', 'performance', 'rendered'])
        assert.deepEqual(controls[1].face.diagnostics[key], controls[0].face.diagnostics[key]);
      assert.deepEqual(controls[1].shapes.FACE, controls[0].shapes.FACE);
      assert.deepEqual(controls[1].shapes.FACE_COL, controls[0].shapes.FACE_COL);
      const display = controls.map(({ shapes }) => {
        const output = new Float32Array(shapes.FACE.length);
        shapes.headDisplay.apply(shapes.FACE, output);
        return output;
      });
      maximumDifference = Math.max(maximumDifference, distance(display[0], display[1]));
    }
    assert.ok(maximumDifference > .01, name);
  }
});

test('every live alias drives a finite edge response; chuckles stay gentler than laughter', () => {
  const cueMap = liveMap;
  const peaks = {};
  for (const name of Object.keys(cueMap)) {
    const cues = createCueExpressions(), flow = create();
    cues.applyTuning({ cueMap, sustainMoods: true });
    let peak = 0;
    for (let frame = 0; frame <= 12 * 60; frame++) {
      const input = reply(frame / 60, { cues: [{ id: name, type: 'tag', name, start: 0, end: .5 }] });
      flow.update(1 / 60, input, cues.update(1 / 60, input).weights);
      const output = flow.apply(base, attachment);
      peak = Math.max(peak, flow.state.maxDisplacement);
      assert.ok(output.every(Number.isFinite), name);
      assert.deepEqual(output.slice(12), base.slice(12), name);
    }
    assert.ok(peak > .01, name + ' should reach its edges');
    assert.strictEqual(flow.apply(base, attachment), base, name + ' should settle');
    peaks[name] = peak;
  }
  assert.ok(peaks.chuckles < peaks.laughing * .85);
});
