import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual cue controller without loading unrelated geometry modules.
// Optional source override lets the same check validate an isolated draft.
const source = await readFile(process.env.NOVA_CUE_FACE_SOURCE
  || new URL('../js/face.js', import.meta.url), 'utf8');
const { createCueExpressions } = await import(`data:text/javascript;base64,${Buffer.from(
  source.replace(/^import .*;\n/gm, '')).toString('base64')}`);
const cueMap = {
  thinking: { kind: 'mood', pose: 'thinking', amount: .75 },
  warm: { kind: 'mood', pose: 'content', amount: 1 },
  excited: { kind: 'mood', pose: 'delighted', amount: .9 },
  laugh: { kind: 'laugh', pose: 'laugh', amount: 1 },
  chuckle: { kind: 'chuckle', pose: 'laugh', amount: .75 },
  sigh: { kind: 'sigh', pose: 'concern', amount: .8 }
};
const cueTiming = {
  moodAttack: .5, moodHold: .7, moodRelease: 1, moodMicroSuppression: .4,
  thinkingGaze: .8, thinkingGazeRelease: .3,
  eventAttack: .15, eventRelease: .5, laughMinimum: 1,
  laughExtension: 1, followingWordGap: .3, sighRelease: .8,
  questionAttack: .15, questionRelease: .3, questionPitch: 1.5,
  interruptRelease: .4, replyBlend: .4
};
function create() {
  const control = createCueExpressions();
  // Keep a short custom hold to exercise overlaps and corrected timing.
  control.applyTuning({ cueMap, cueTiming, laughAmount: 1, moodAmount: 1 });
  return control;
}
const tag = (id, name, start = 0, end = start + .1) => ({ id, type: 'tag', name, start, end });
const at = (control, position, cues, options = {}) => control.update(options.dt ?? 1 / 60,
  { replyId: options.replyId ?? 1, state: options.state ?? 'speaking', position, cues });
const weight = (output, pose) => output.weights[pose] || 0;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9,
  `${actual} should equal ${expected}`);
const neutral = output => {
  assert.ok(Object.values(output.weights).every(value => value === 0));
  assert.ok(Object.values(output.gazeWeights).every(value => value === 0));
  assert.equal(output.questionPitch, 0);
  assert.equal(output.microSuppression, 0);
};

test('a mood forms, holds, releases and restores micro motion during a long reply', () => {
  const control = create(), cues = [tag('m1', 'thinking')];
  close(weight(at(control, .25, cues), 'thinking'), .375);
  close(weight(at(control, .5, cues), 'thinking'), .75);
  close(weight(at(control, 1.2, cues), 'thinking'), .75);
  const release = at(control, 1.7, cues);
  close(weight(release, 'thinking'), .375);
  close(release.microSuppression, .15);
  neutral(at(control, 2.2, cues));
  neutral(at(control, 12, cues));
  assert.ok(control.state.retired.includes('m1'));
});

test('later different moods blend from the decaying pose without reviving the old pose', () => {
  const control = create(), first = tag('m1', 'thinking'), next = tag('m2', 'warm', 1.7);
  at(control, .5, [first]);
  const before = at(control, 1.7, [first]);
  assert.deepEqual(at(control, 1.7, [first, next]), before);
  const mixed = at(control, 1.95, [first, next]);
  close(weight(mixed, 'thinking'), .1875);
  close(weight(mixed, 'content'), .5);
  const formed = at(control, 2.2, [first, next]);
  close(weight(formed, 'thinking'), 0);
  close(weight(formed, 'content'), 1);
  neutral(at(control, 3.9, [first, next]));
  neutral(at(control, 6, [first, next]));
});

test('a new same-mood occurrence forms a fresh beat from its current release value', () => {
  const control = create(), first = tag('m1', 'warm'), next = tag('m2', 'warm', 1.7);
  close(weight(at(control, 1.7, [first]), 'content'), .5);
  close(weight(at(control, 1.7, [first, next]), 'content'), .5);
  close(weight(at(control, 1.95, [first, next]), 'content'), .75);
  close(weight(at(control, 2.2, [first, next]), 'content'), 1);
  neutral(at(control, 3.9, [first, next]));
});

test('a correction on the first frame beyond the previous end cannot replay that occurrence', () => {
  const control = create(), first = tag('m1', 'thinking');
  at(control, .5, [first]);
  at(control, 2.1, [first]);
  const corrected = { ...first, start: 5, end: 5.1 };
  neutral(at(control, 2.3, [corrected]));
  neutral(at(control, 5.5, [corrected]));
  const next = tag('m2', 'thinking', 6);
  close(weight(at(control, 6.5, [corrected, next]), 'thinking'), .75);
  assert.ok(control.state.retired.includes('m1'));
});

test('retiring corrected history does not erase an overlapping beat\'s blend source', () => {
  const controls = [create(), create()];
  const first = tag('m1', 'thinking'), next = tag('m2', 'warm', 1.9);
  for (const control of controls) {
    at(control, .5, [first, next]);
    at(control, 1.9, [first, next]);
    at(control, 2.19, [first, next]);
  }
  const corrected = { ...first, start: 5, end: 5.1 };
  assert.deepEqual(at(controls[0], 2.21, [first, next]), at(controls[1], 2.21, [corrected, next]));
  neutral(at(controls[1], 5.5, [corrected, next]));
});

test('stream gaps hold the playback-time mood envelope', () => {
  const control = create(), cues = [tag('m1', 'warm')];
  const held = at(control, 1.6, cues);
  assert.deepEqual(at(control, 1.6, cues, { dt: 5, state: 'gap' }), held);
  neutral(at(control, 2.2, cues));
});

test('interruption releases continuously and natural completion does not restart an existing tail', () => {
  const interrupted = create(), cues = [tag('m1', 'warm')];
  const before = at(interrupted, .7, cues);
  assert.deepEqual(interrupted.update(0, null, { replyId: 1, reason: 'interrupted' }), before);
  close(weight(interrupted.update(.2, null), 'content'), .5);
  neutral(interrupted.update(.2, null));
  const completed = create();
  const tail = at(completed, 1.8, cues);
  assert.deepEqual(completed.update(0, null, { replyId: 1, reason: 'completed' }), tail);
  close(weight(completed.update(.2, null), 'content'), weight(tail, 'content') / 2);
  neutral(completed.update(.201, null));
  assert.equal(completed.state.releasing, false);
});

test('new replies bridge from the visible pose, pause in gaps and clear occurrence history', () => {
  const control = create(), cues = [tag('m1', 'warm')];
  const before = at(control, .7, cues);
  assert.deepEqual(at(control, 0, [], { dt: 0, replyId: 2 }), before);
  assert.deepEqual(at(control, 0, [], { dt: 2, replyId: 2, state: 'gap' }), before);
  close(weight(at(control, .2, [], { dt: .2, replyId: 2 }), 'content'), .5);
  neutral(at(control, .4, [], { dt: .2, replyId: 2 }));
  // Reusing an occurrence ID in a different reply is a fresh cue.
  close(weight(at(control, .5, cues, { replyId: 3 }), 'content'), 1);
});

test('untagged and event-only replies retain the original settling delay, independent of prior bridges', () => {
  for (const cues of [[], [tag('e1', 'chuckle')]]) {
    const control = create();
    at(control, .5, cues);
    control.update(0, null, { replyId: 1, reason: 'completed' });
    neutral(control.update(.6, null));
    assert.equal(control.state.releasing, true);
    neutral(control.update(.4, null));
    assert.equal(control.state.releasing, false);
  }
  // A new untagged reply has its own classification whether the old mood was
  // still being bridged or had already expired before that reply began.
  for (const previousPosition of [.7, 2.3]) {
    const control = create();
    at(control, previousPosition, [tag('m1', 'warm')]);
    at(control, 0, [], { dt: 0, replyId: 2 });
    control.update(0, null, { replyId: 2, reason: 'completed' });
    control.update(.6, null);
    assert.equal(control.state.releasing, true);
    neutral(control.update(.4, null));
    assert.equal(control.state.releasing, false);
  }
});

test('laugh extension, chuckle recovery, sigh recovery and question timing stay unchanged', () => {
  const laugh = create(), laughCue = { ...tag('e1', 'laugh'), nextWordStart: .15 };
  close(weight(at(laugh, .075, [laughCue]), 'laugh'), .5);
  close(weight(at(laugh, 1.6, [laughCue]), 'laugh'), 1);
  close(weight(at(laugh, 2.25, [laughCue]), 'laugh'), .5);
  neutral(at(laugh, 2.5, [laughCue]));

  const chuckle = create(), chuckleCue = { ...tag('e1', 'chuckle'), nextWordStart: .15 };
  close(weight(at(chuckle, 1.25, [chuckleCue]), 'laugh'), .375);
  assert.equal(chuckle.state.gestureWindows[0].kind, 'chuckle');
  close(chuckle.state.gestureWindows[0].end, 1.5);
  neutral(at(chuckle, 1.5, [chuckleCue]));

  const sigh = create(), sighCue = tag('e1', 'sigh', 0, .2);
  close(weight(at(sigh, .15, [sighCue]), 'concern'), .8);
  close(weight(at(sigh, .6, [sighCue]), 'concern'), .4);
  neutral(at(sigh, 1, [sighCue]));

  const question = create(), questionCue = { id: 'q1', type: 'question', start: 0, end: .6 };
  close(at(question, .15, [questionCue]).questionPitch, 1.5);
  close(at(question, .45, [questionCue]).questionPitch, .75);
  neutral(at(question, .6, [questionCue]));
});

test('events still take precedence over moods and an expired mood never returns after a laugh', () => {
  const control = create();
  const cues = [tag('m1', 'warm'), tag('e1', 'laugh', .6, .7)];
  at(control, .5, cues);
  const laughing = at(control, .9, cues);
  close(weight(laughing, 'laugh'), 1);
  close(weight(laughing, 'content'), 0);
  close(laughing.microSuppression, 1);
  assert.equal(control.state.blockingEvent, true);
  neutral(at(control, 2.3, cues));
  assert.equal(control.state.blockingEvent, false);
});

// Read the actual live timing so a stage-only change cannot silently escape this check.
const stageSource = await readFile(new URL('../js/stage.js', import.meta.url), 'utf8');
const liveTiming = vm.runInNewContext('(' + stageSource.match(/  cueTiming: (\{[\s\S]*?\n  \}),/)[1] + ')');
test('live and missing-key mood defaults hold for two full seconds, then release', () => {
  assert.equal(liveTiming.moodAttack, .5);
  assert.equal(liveTiming.moodHold, 2);
  assert.equal(liveTiming.moodRelease, 1);
  for (const fallback of [false, true]) {
    const timing = { ...liveTiming };
    if (fallback) delete timing.moodHold;
    const control = createCueExpressions();
    control.applyTuning({ cueMap, cueTiming: timing });
    const cues = [tag('m1', 'thinking')];
    close(weight(at(control, .25, cues), 'thinking'), .375);
    for (const position of [.5, 1.2, 2, 2.5]) {
      close(weight(at(control, position, cues), 'thinking'), .75);
    }
    close(weight(at(control, 3, cues), 'thinking'), .375);
    neutral(at(control, 3.5, cues));
  }
  // All event timing still matches the pre-existing regression fixture.
  for (const key of ['eventAttack', 'eventRelease', 'laughMinimum', 'laughExtension',
    'followingWordGap', 'sighRelease']) assert.equal(liveTiming[key], cueTiming[key]);
});
