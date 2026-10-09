import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const repo = new URL(process.env.NOVA_PAUSE_REPO || '../', import.meta.url);
const read = name => readFile(new URL(`js/${name}`, repo), 'utf8');
const [faceSource, headSource, motionSource] = await Promise.all([
  process.env.NOVA_PAUSE_FACE_SOURCE ? readFile(process.env.NOVA_PAUSE_FACE_SOURCE, 'utf8') : read('face.js'),
  read('facehead.js'), read('facemotion.js')
]);

function fixture() {
  const N = 4, base = new Float32Array([-1, -1, -.1, 1, -1, .1, -1, 1, .1, 1, 1, -.1]);
  const landmarks = { eyeL: [.35, .4], eyeR: [.65, .4], noseBridge: [.5, .45], noseTip: [.5, .6],
    mouthCentre: [.5, .7], mouthLeft: [.4, .7], mouthRight: [.6, .7], upperLipTop: [.5, .68], lowerLipBottom: [.5, .72] };
  for (const side of ['L', 'R']) {
    const [u, v] = landmarks[`eye${side}`];
    Object.assign(landmarks, { [`eye${side}_inner`]: [u + .04, v], [`eye${side}_outer`]: [u - .04, v],
      [`eye${side}_upperLid`]: [u, v - .02], [`eye${side}_lowerLid`]: [u, v + .02] });
  }
  return { N, I: { face: [0, N], filaments: [N, N], halo: [N, N] },
    BASE: base, FACE: new Float32Array(base), BASE_COL: new Float32Array(N * 3).fill(.5),
    FACE_COL: new Float32Array(N * 3), UV: new Float32Array([.25, .75, .75, .75, .25, .25, .75, .25]),
    P1: new Float32Array(N), MAP_DEPTH: new Float32Array(N).fill(.5), RECYCLED: new Uint8Array(N),
    MAP_SCALE: 4, MAPS: { landmarks },
    MOTION: { CORE_LOOP: new Float32Array(N * 6).fill(.01), CORE_GROUP: new Uint8Array(N),
      EDGE_INDEX: [], EDGE_DATA: [], DETACH_INDEX: [], DETACH_DATA: [], FLOW_PATHS: [], FLOW_STEPS: 1,
      FLOW_IDS: new Uint8Array(N), FLOW_PHASE: new Float32Array(N), FLOW_RATE: new Float32Array(N),
      FLOW_OFFSET: new Float32Array(N * 3) } };
}

function createRun() {
  let seed = 17, rebuilds = 0;
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const mapped = { current: null };
  const context = vm.createContext({ Math: math,
    createMappedFace(shapes) {
      return { diagnostics: mapped, applyTuning() {}, update(clock, expression, gaze, blink, envelope, shape) {
        rebuilds++;
        mapped.current = JSON.parse(JSON.stringify({ clock, expression, gaze, blink, envelope, shape }));
        shapes.FACE.set(shapes.BASE);
        shapes.FACE_COL.set(shapes.BASE_COL);
      } };
    }
  });
  // Only image sampling is stubbed: cue, spring, head, gesture and particle-motion
  // controllers execute their real modules over a small synthetic geometry.
  for (const [name, source] of [['createFaceHead', headSource], ['createFaceMotion', motionSource]]) {
    vm.runInContext(`var ${name} = (() => {\n${source.replace(/^export /gm, '')}\nreturn ${name}; })();`, context);
  }
  const createFace = vm.runInContext(`(() => {\n${faceSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')}\nreturn createFace; })();`, context);
  const shapes = fixture(), face = createFace(shapes, false);
  face.applyTuning({ cueMap: { thinking: { kind: 'mood', pose: 'thinking', amount: .75 },
    chuckle: { kind: 'chuckle', pose: 'laugh', amount: .75 } }, listening: { amount: .25, attack: .8, release: 1 } });
  face.setReplyText('Synthetic timing check');
  return { face, shapes, mapped, get rebuilds() { return rebuilds; } };
}

test('particle pause preserves cue/end recovery, head and gesture clocks, then samples the current face', () => {
  const runs = [createRun(), createRun()], dt = 1 / 60;
  const shape = { w: 1, h: 1, round: 0, close: 0, cup: 0, square: 0, tuck: 0, oval: 0 };
  const tags = [{ id: 'm1', type: 'tag', name: 'thinking', start: 0, end: .1 },
    { id: 'e1', type: 'tag', name: 'chuckle', start: .55, end: .65, nextWordStart: .7 }];
  let pauseCount, hiddenPositions, sawChuckle = false;
  for (let frame = 0; frame <= 481; frame++) {
    const clock = frame * dt, speaking = frame < 54, hidden = frame >= 42 && frame < 480;
    const cues = speaking ? { replyId: 1, state: 'speaking', position: clock, cues: tags } : null;
    const ended = speaking ? null : { replyId: 1, reason: 'completed', position: .9 };
    if (frame === 42) { pauseCount = runs[1].rebuilds; hiddenPositions = [...runs[1].shapes.FACE]; }
    runs[0].face.update(dt, clock, cues, speaking ? .4 : 0, shape, speaking, ended, !speaking, null);
    runs[1].face.update(dt, clock, cues, speaking ? .4 : 0, shape, speaking, ended, !speaking, null, !hidden);
    const snapshot = run => JSON.parse(JSON.stringify({ expression: run.face.diagnostics.expression,
      rendered: run.face.diagnostics.rendered, pose: run.face.diagnostics.pose, gaze: run.face.diagnostics.gaze,
      mouth: run.face.diagnostics.mouth, cues: run.face.diagnostics.cues, listening: run.face.diagnostics.listening,
      gesture: run.shapes.headDisplay.diagnostics.gesture }));
    assert.deepEqual(snapshot(runs[1]), snapshot(runs[0]), `controller mismatch at ${clock}`);
    sawChuckle ||= Boolean(runs[1].face.diagnostics.cues.weights.laugh);
    if (hidden) {
      assert.equal(runs[1].rebuilds, pauseCount);
      assert.deepEqual([...runs[1].shapes.FACE], hiddenPositions);
    } else assert.deepEqual(runs[1].mapped.current, runs[0].mapped.current);
    if (frame === 479) {
      assert.ok(Object.values(runs[1].face.diagnostics.cues.weights).every(value => value === 0));
      assert.equal(runs[1].face.diagnostics.listening.phase, 'listening');
      assert.equal(runs[1].shapes.headDisplay.diagnostics.gesture.activeId, null);
    }
  }
  assert.ok(sawChuckle, 'the hidden interval must include a real event and its recovery');
  assert.equal(runs[1].rebuilds, pauseCount + 2, 'the first return frame rebuilds immediately');
  assert.ok([...runs[1].shapes.FACE, ...runs[1].shapes.FACE_COL].every(Number.isFinite));
});
