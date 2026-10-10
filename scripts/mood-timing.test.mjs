import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCueExpressions, createMoodPerformance } from '../js/face-expressions.js';

const cueMap = {
  thoughtful: { kind: 'mood', pose: 'thinking', amount: .75 },
  warmly: { kind: 'mood', pose: 'warm', amount: 1 },
  curious: { kind: 'mood', pose: 'focused', amount: .85 },
  confidently: { kind: 'mood', pose: 'confident', amount: 1 },
  chuckles: { kind: 'chuckle', pose: 'laugh', amount: .75 },
  laughing: { kind: 'laugh', pose: 'laugh', amount: 1 },
  sighs: { kind: 'sigh', pose: 'sigh', amount: .8 },
  cheerful: { kind: 'mood', pose: 'content', amount: 1 },
  excited: { kind: 'mood', pose: 'delighted', amount: .9 }
};
const tag = (name, start = 0, id = name) => ({ id, type: 'tag', name, start, end: start + .5 });
const reply = (position, cues, options = {}) => ({ replyId: 1, state: 'speaking', position, cues, ...options });
function create(sustained) {
  const control = createCueExpressions();
  control.applyTuning({ cueMap, ...(sustained === undefined ? {} : { sustainMoods: sustained }) });
  return control;
}
const at = (control, position, cues, dt = 1 / 60, options) => control.update(dt, reply(position, cues, options));
const weight = (output, pose) => output.weights[pose] || 0;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} vs ${expected}`);
const neutral = output => assert.ok(Object.values(output.weights).every(value => value === 0));

test('sustained moods are selectable; reactions and questions retain their exact timing', () => {
  const questions = [{ id: 'q1', type: 'question', start: 1, end: 1.6 }];
  for (const cues of [[], ...Object.keys(cueMap).map(name => [tag(name)]), questions]) {
    const normal = create(), disabled = create(false);
    const selected = cues.some(cue => cueMap[cue.name]?.kind === 'mood');
    const sustained = create(true);
    for (let frame = 0; frame <= 720; frame++) {
      const position = frame / 60, current = at(normal, position, cues);
      assert.deepEqual(at(disabled, position, cues), current);
      if (!selected) assert.deepEqual(at(sustained, position, cues), current);
    }
  }
});

test('every mapped mood keeps its opening, softens to a lower attitude and retires finitely', () => {
  for (const [name, pose, amount, level, until] of [
    ['thoughtful', 'thinking', .75, .48, 8.1], ['warmly', 'warm', 1, .55, 8.7],
    ['curious', 'focused', .85, .42, 7], ['confidently', 'confident', 1, .58, 7.8],
    ['cheerful', 'content', 1, .5, 7.8], ['excited', 'delighted', .9, .4, 6.7]
  ]) {
    const baseline = create(false), sustained = create(true), cues = [tag(name)];
    for (let frame = 0; frame <= 150; frame++) {
      assert.deepEqual(at(sustained, frame / 60, cues), at(baseline, frame / 60, cues));
    }
    let previous = amount;
    for (let frame = 151; frame <= 240; frame++) {
      const value = weight(at(sustained, frame / 60, cues), pose);
      assert.ok(value <= previous + 1e-9 && value >= amount * level - 1e-9);
      previous = value;
    }
    close(weight(at(sustained, 4.5, cues), pose), amount * level);
    neutral(at(baseline, 4.5, cues));
    assert.ok(weight(at(sustained, until - .7, cues), pose) > 0);
    neutral(at(sustained, until + .001, cues));
    neutral(at(sustained, 30, cues));
    assert.ok(sustained.state.retired.includes(name));
  }
});

test('gaps hold the attitude and body exactly; interruption and early completion release without replay', () => {
  for (const name of Object.keys(cueMap).filter(name => cueMap[name].kind === 'mood')) for (const reason of ['interrupted', 'complete']) {
    const control = create(true), body = createMoodPerformance();
    body.applyTuning({ moodPerformanceAmount: 1 });
    const cues = [tag(name), tag('thoughtful', 20, 'future')];
    let held;
    for (let frame = 1; frame <= 270; frame++) {
      held = at(control, frame / 60, cues);
      body.update(1 / 60, held.weights);
    }
    const bodyBefore = { ...body.state };
    for (let frame = 0; frame < 20; frame++) {
      const gap = at(control, 4.5, cues, 1, { state: 'gap' });
      assert.deepEqual(gap, held);
      assert.deepEqual(body.update(1, gap.weights, true, true), bodyBefore);
    }
    assert.deepEqual(control.update(0, null, { replyId: 1, reason }), held);
    const first = control.update(.01, null);
    for (const pose of Object.values(cueMap).map(mapping => mapping.pose)) {
      assert.ok(weight(first, pose) <= weight(held, pose));
      assert.ok(weight(first, pose) >= weight(held, pose) - .01);
    }
    neutral(control.update(2, null));
    assert.equal(control.releasing, false);
    assert.equal(control.state.retired.includes('future'), false);
  }
});

test('corrected alignment cannot revive a retired mood or restart its lower attitude', () => {
  const control = create(true), cue = tag('thoughtful');
  at(control, 2, [cue]);
  close(weight(at(control, 4.5, [{ ...cue, end: 1 }]), 'thinking'), .36);
  close(weight(at(control, 5, [{ ...cue, end: .1 }]), 'thinking'), .36);
  // First correction arrives beyond the previous known end, but before the
  // revised future start. Retirement must use the old end, not the correction.
  const corrected = { ...cue, start: 12, end: 12.5 };
  neutral(at(control, 8.2, [corrected]));
  neutral(at(control, 13, [corrected]));
});

test('later moods blend from the current lower attitude; new replies bridge and clear its history', () => {
  const control = create(true), first = tag('thoughtful'), next = tag('warmly', 4.5);
  const before = at(control, 4.5, [first]);
  assert.deepEqual(at(control, 4.5, [first, next], 0), before);
  const mixed = at(control, 4.75, [first, next]);
  close(weight(mixed, 'thinking'), .18);
  close(weight(mixed, 'warm'), .5);
  const peak = at(control, 5, [first, next]);
  close(weight(peak, 'thinking'), 0);
  close(weight(peak, 'warm'), 1);
  assert.deepEqual(at(control, 0, [], 0, { replyId: 2 }), peak);
  assert.deepEqual(at(control, 0, [], 2, { replyId: 2, state: 'gap' }), peak);
  neutral(at(control, .4, [], .4, { replyId: 2 }));
  close(weight(at(control, .5, [first], .5, { replyId: 3 }), 'thinking'), .75);
});

test('laughs and sighs retain priority over a sustained attitude without retriggering it', () => {
  for (const event of ['laughing', 'sighs']) {
    const control = create(true), cues = [tag('thoughtful'), tag(event, 4.5)];
    at(control, 4.5, cues);
    const active = at(control, 4.8, cues);
    close(weight(active, 'thinking'), 0);
    assert.ok(weight(active, cueMap[event].pose) > .5);
    assert.equal(control.blockingEvent, true);
    const after = at(control, 6.2, cues);
    assert.ok(weight(after, 'thinking') > 0 && weight(after, 'thinking') <= .36);
    neutral(at(control, 9, cues));
  }
});

test('sustained body motion is finite and speed bounded across frame rates; reduced motion omits it', () => {
  const settled = [];
  for (const fps of [30, 60, 120]) {
    const control = create(true), body = createMoodPerformance();
    body.applyTuning({ moodPerformanceAmount: 1 });
    let previous = 0;
    for (let frame = 1; frame <= 10 * fps; frame++) {
      const output = at(control, frame / fps, [tag('thoughtful')], 1 / fps);
      const state = body.update(1 / fps, output.weights);
      assert.ok(Math.abs(state.roll - previous) * fps <= 24.001);
      assert.ok(Object.values(state).every(Number.isFinite));
      previous = state.roll;
      if (frame === 5 * fps) settled.push(previous);
    }
    assert.ok(Math.abs(previous) < 1e-6);
  }
  assert.ok(Math.max(...settled) - Math.min(...settled) < .001);
  assert.ok(settled.every(roll => roll > 4 && roll < 5));
  const control = create(true), reduced = createMoodPerformance(true);
  reduced.applyTuning({ moodPerformanceAmount: 1 });
  const state = reduced.update(1, at(control, 4.5, [tag('thoughtful')]).weights);
  assert.ok(state.priority > 0);
  for (const [key, value] of Object.entries(state)) if (key !== 'priority') assert.equal(value, 0);
});

test('live stage enables approved timing and edge response for every mapped alias', () => {
  const source = readFileSync(new URL('../js/stage.js', import.meta.url), 'utf8');
  const liveMap = vm.runInNewContext('(' + source.match(/  cueMap: (\{[\s\S]*?\n  \}),/)[1] + ')');
  const sustainMoods = source.match(/  sustainMoods: (true|false),/)[1] === 'true';
  assert.equal(sustainMoods, true);
  assert.equal(Number(source.match(/  moodEdgeAmount: ([0-9.]+),/)[1]), 1);
  for (const [name, mapping] of Object.entries(liveMap)) {
    const control = createCueExpressions();
    control.applyTuning({ cueMap: liveMap, sustainMoods });
    const cues = [tag(name)];
    if (mapping.kind === 'mood') assert.ok(weight(at(control, 4.5, cues), mapping.pose) > 0, name);
    else {
      assert.ok(weight(at(control, .3, cues), mapping.pose) > 0, name);
      neutral(at(control, 3, cues));
    }
    neutral(at(control, 12, cues));
  }
});
