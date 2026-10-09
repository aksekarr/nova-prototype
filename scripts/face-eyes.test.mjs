import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createEyeAttitudes, EYE_FOUNDATIONS } from '../js/face-eyes.js';
import { createFace } from '../js/face.js';
import { createShapes } from '../js/shapes.js';

const reply = (position, state = 'speaking', replyId = 1) => ({ replyId, position, state, cues: [] });
const start = position => ({ replyId: 1, position, type: 'start' });
function make(style = 'relaxed', reduce = false, moments = true) {
  const eyes = createEyeAttitudes(reduce);
  eyes.applyTuning({ eyeStyle: style, eyeMoments: moments });
  return eyes;
}
const advance = (eyes, duration, options = {}, fps = 60) => {
  for (let i = 0; i < Math.round(duration * fps); i++) eyes.update(1 / fps, options);
  return structuredClone(eyes.state);
};

test('Current eyes stays an exact bypass and both foundations work without global randomness', () => {
  const oldRandom = Math.random;
  Math.random = () => { throw new Error('Eye attitudes used global randomness'); };
  try {
    const current = createEyeAttitudes();
    for (let i = 0; i < 900; i++) assert.equal(current.update(1 / 60).weight, 0);
    for (const style of ['relaxed', 'attentive']) {
      const eyes = make(style, false, false);
      const state = advance(eyes, 3);
      assert.equal(state.weight, 1);
      for (const [key, value] of Object.entries(EYE_FOUNDATIONS[style]))
        assert.ok(Math.abs(state.pose[key] - value) < 1e-9);
      assert.ok(Object.values(state.pose).every(Number.isFinite));
    }
  } finally { Math.random = oldRandom; }
});

test('neutral eyes soften together, hold a readable shape, and return to their foundation', () => {
  const eyes = make();
  advance(eyes, 3);
  const formed = advance(eyes, 1.2);
  assert.equal(formed.moment, 'soften');
  assert.ok(formed.pose.upperLid > EYE_FOUNDATIONS.relaxed.upperLid + .10);
  assert.ok(formed.pose.lowerLid > EYE_FOUNDATIONS.relaxed.lowerLid + .12);
  assert.equal(formed.pose.browL, formed.pose.browR);
  const held = advance(eyes, .5);
  assert.equal(held.strength, 1);
  assert.ok(Math.abs(held.pose.lowerLid - formed.pose.lowerLid) < .02);
  const rested = advance(eyes, 2.8);
  assert.equal(rested.moment, 'rest');
  assert.ok(Math.abs(rested.pose.lowerLid - EYE_FOUNDATIONS.relaxed.lowerLid) < .001);
});

test('sustained attention engages both eyes and quiet releases smoothly', () => {
  const eyes = make();
  advance(eyes, 1);
  const focused = advance(eyes, 1, { listening: 1, attention: 1 });
  assert.equal(focused.moment, 'attentive');
  assert.ok(focused.pose.upperLid < EYE_FOUNDATIONS.relaxed.upperLid - .15);
  assert.ok(focused.pose.browL > EYE_FOUNDATIONS.relaxed.browL + .08);
  assert.equal(focused.pose.browL, focused.pose.browR);
  const before = structuredClone(eyes.state.pose);
  eyes.update(0, { listening: 1, attention: 0 });
  assert.deepEqual(eyes.state.pose, before);
  eyes.update(1 / 60, { listening: 1, attention: 0 });
  assert.ok(Math.abs(eyes.state.pose.upperLid - before.upperLid) < .005);
});

test('speech moments use spaced phrase starts, freeze in gaps, and cannot leak into a new reply', () => {
  const eyes = make();
  advance(eyes, 1, { cues: reply(0) });
  eyes.update(0, { cues: reply(1), phraseEvents: [start(1)] });
  for (let i = 1; i <= 60; i++) eyes.update(1 / 60, { cues: reply(1 + i / 60) });
  assert.equal(eyes.state.moment, 'engage');
  const held = structuredClone(eyes.state);
  for (let i = 0; i < 90; i++) {
    eyes.update(1 / 30, { cues: reply(2, 'gap'), phraseEvents: [start(2)] });
    assert.deepEqual(eyes.state, held);
  }
  eyes.update(0, { cues: reply(2.5), phraseEvents: [start(2.5)] });
  assert.equal(eyes.state.moment, 'engage', 'closely spaced start must not replace the current moment');
  const visible = structuredClone(eyes.state.pose);
  eyes.update(0, { cues: reply(0, 'speaking', 2) });
  assert.deepEqual(eyes.state.pose, visible, 'new reply must not reset the visible pose');
  assert.equal(eyes.state.moment, 'rest');
  advance(eyes, 1, { cues: reply(0, 'speaking', 2) });
  assert.ok(Math.abs(eyes.state.pose.upperLid - EYE_FOUNDATIONS.relaxed.upperLid) < .001);
});

test('tags and manual poses take priority; style switches release continuously', () => {
  const eyes = make();
  advance(eyes, 2);
  for (const name of ['focused', 'thinking', 'warm', 'laugh', 'sigh']) {
    assert.equal(eyes.update(0, { cues: reply(1), weights: { [name]: .75 } }).weight, 0);
  }
  assert.equal(eyes.update(0, { enabled: false }).weight, 0,
    'a manual handover must not reveal a foundation hidden by a tag');
  advance(eyes, 2);
  const beforeManual = structuredClone(eyes.state);
  assert.equal(eyes.update(0, { enabled: false }).weight, beforeManual.weight);
  const manualTail = eyes.update(1 / 60, { enabled: false }).weight;
  assert.ok(manualTail > 0 && manualTail < beforeManual.weight);
  assert.equal(advance(eyes, 3, { enabled: false }).weight, 0);
  advance(eyes, 1);
  const before = structuredClone(eyes.state);
  eyes.applyTuning({ eyeStyle: 'current' });
  eyes.update(0);
  assert.deepEqual(eyes.state.pose, before.pose);
  assert.equal(eyes.state.weight, before.weight);
  const fading = eyes.update(1 / 60).weight;
  assert.ok(fading > 0 && fading < 1);
  assert.equal(advance(eyes, 3).weight, 0);
});

test('reduced motion and Eye moments off keep a static foundation across listening and speech', () => {
  for (const eyes of [make('relaxed', true), make('relaxed', false, false)]) {
    const baseline = advance(eyes, 3);
    const listening = advance(eyes, 8, { listening: 1, attention: 1 });
    for (const key of Object.keys(baseline.pose)) assert.ok(Math.abs(listening.pose[key] - baseline.pose[key]) < 1e-9);
    const speaking = eyes.update(0, { cues: reply(1), phraseEvents: [start(1)] });
    assert.equal(speaking.moment, 'rest');
    assert.equal(speaking.strength, 0);
  }
});

test('foundation transitions agree at 30, 60 and 120 fps', () => {
  const states = [30, 60, 120].map(fps => advance(make('attentive', false, false), .5, {}, fps));
  for (const state of states.slice(1)) {
    assert.ok(Math.abs(state.weight - states[0].weight) < 1e-12);
    for (const key of Object.keys(state.pose)) assert.ok(Math.abs(state.pose[key] - states[0].pose[key]) < 1e-12);
  }
});

// Real face driver and shape generator, using synthetic pixels with the actual
// landmark layout. No renderer, microphone, paid generation or conversation data.
const landmarks = JSON.parse(readFileSync(new URL('../assets/face/face-landmarks.json', import.meta.url))).landmarks;
const maps = {
  colour: { width: 16, height: 16, data: Float32Array.from({ length: 16 * 16 * 3 }, (_, i) => .2 + (i % 41) / 100) },
  mask: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(1) },
  depth: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(.5) },
  average: [.3, .3, .3], landmarks
};
function driver(style) {
  const designs = createShapes(600, maps), shapes = { ...designs, ...designs.FACE_V3 };
  // Head captures its RNG at construction. Give each driver an independent,
  // identical stream so equality compares the change, not two idle performances.
  const previousRandom = Math.random;
  let seed = 73, face;
  Math.random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
  try { face = createFace(shapes, false); } finally { Math.random = previousRandom; }
  face.applyTuning({ eyeStyle: style, listening: { pose: 'content', amount: .25 },
    cueMap: {
      curious: { kind: 'mood', pose: 'focused', amount: .85 },
      thoughtful: { kind: 'mood', pose: 'thinking', amount: .75 },
      warmly: { kind: 'mood', pose: 'warm', amount: 1 },
      confidently: { kind: 'mood', pose: 'confident', amount: 1 },
      chuckles: { kind: 'chuckle', pose: 'laugh', amount: .75 },
      laughing: { kind: 'laugh', pose: 'laugh', amount: 1 },
      sighs: { kind: 'sigh', pose: 'sigh', amount: .8 }
    } });
  face.setReplyText('Synthetic eye expression regression.');
  return { face, shapes };
}

test('the real eye layer leaves expression state, articulation, gaze/blinks, head and particle motion identical', () => {
  const controls = [driver('current'), driver('relaxed'), driver('auto')];
  const baseline = controls[0];
  let differentEyes = false;
  const mouth = { w: 1, h: 1, round: 0, close: 0 };
  for (let i = 0; i < 480; i++) {
    const time = i / 60, speaking = time >= 2 && time < 6;
    const cues = speaking ? reply(time - 2) : null;
    const envelope = speaking ? .3 + Math.sin(time * 8) * .15 : 0;
    for (const { face } of controls) face.update(1 / 60, time, cues, envelope,
      mouth, speaking, null, !speaking, null, !speaking ? .18 : 0);
    for (const softer of controls.slice(1)) {
      assert.deepEqual(softer.face.diagnostics.expression, baseline.face.diagnostics.expression);
      assert.deepEqual(softer.face.diagnostics.mouth, baseline.face.diagnostics.mouth);
      assert.deepEqual(softer.face.diagnostics.pose, baseline.face.diagnostics.pose);
      assert.deepEqual(softer.shapes.FACE, baseline.shapes.FACE);
      assert.deepEqual(softer.shapes.UV, baseline.shapes.UV);
      differentEyes ||= softer.face.diagnostics.rendered.lowerLid !== baseline.face.diagnostics.rendered.lowerLid;
    }
  }
  assert.ok(differentEyes, 'comparison must actually change the displayed eyes');
});

test('the real conversation mix and fixed alternatives preserve every approved tag at its peak', () => {
  const mouth = { w: 1, h: 1, round: 0, close: 0 };
  for (const name of ['curious', 'thoughtful', 'warmly', 'confidently', 'chuckles', 'laughing', 'sighs']) {
    for (const style of ['attentive', 'auto']) {
      const baseline = driver('current'), softer = driver(style);
      for (let i = 1; i <= 30; i++) {
        const cues = { ...reply(i / 60), cues: [{ id: 't1', type: 'tag', name, start: 0, end: .5 }] };
        for (const { face } of [baseline, softer]) face.update(1 / 60, i / 60, cues, 0, mouth);
      }
      assert.equal(softer.face.diagnostics.eyes.weight, 0, name + ' must keep priority');
      assert.deepEqual(softer.face.diagnostics.rendered, baseline.face.diagnostics.rendered);
      assert.deepEqual(softer.shapes.FACE_COL, baseline.shapes.FACE_COL);
    }
  }
});

test('conversation mix keeps Current eyes between occasional soft neutral moments', () => {
  const eyes = make('auto');
  assert.equal(advance(eyes, 3).weight, 0);
  assert.equal(eyes.state.foundation, 'current');
  const softened = advance(eyes, 1.5);
  assert.equal(softened.foundation, 'relaxed');
  assert.equal(softened.moment, 'soften');
  assert.ok(softened.weight > .95);
  assert.ok(Math.abs(softened.pose.lowerLid - EYE_FOUNDATIONS.relaxed.lowerLid) < .001);
  const home = advance(eyes, 4.5);
  assert.equal(home.foundation, 'current');
  assert.equal(home.weight, 0, 'quiet periods must restore the exact original eyes');
});

test('conversation mix holds Open and attentive for sustained input and eases out in quiet', () => {
  const eyes = make('auto');
  const attentive = advance(eyes, 1.5, { listening: 1, attention: 1 });
  assert.equal(attentive.foundation, 'attentive');
  assert.equal(attentive.moment, 'attentive');
  assert.ok(attentive.weight > .99);
  for (const [key, value] of Object.entries(EYE_FOUNDATIONS.attentive))
    assert.ok(Math.abs(attentive.pose[key] - value) < .0001);
  eyes.update(0, { listening: 1, attention: 0 });
  assert.deepEqual(eyes.state.pose, attentive.pose);
  assert.equal(eyes.state.weight, attentive.weight);
  eyes.update(1 / 60, { listening: 1, attention: 0 });
  assert.ok(eyes.state.weight < attentive.weight && eyes.state.weight > .95);
});

test('conversation mix uses both approved shapes for spaced speech moments and holds gaps exactly', () => {
  const eyes = make('auto');
  advance(eyes, 1, { cues: reply(0) });
  assert.equal(eyes.state.weight, 0);
  eyes.update(0, { cues: reply(1), phraseEvents: [start(1)] });
  for (let i = 1; i <= 60; i++) eyes.update(1 / 60, { cues: reply(1 + i / 60) });
  assert.equal(eyes.state.foundation, 'attentive');
  assert.ok(eyes.state.weight > .95);
  const held = structuredClone(eyes.state);
  for (let i = 0; i < 90; i++) {
    eyes.update(1 / 30, { cues: reply(2, 'gap'), phraseEvents: [start(2)] });
    assert.deepEqual(eyes.state, held);
  }
  advance(eyes, 3, { cues: reply(3.2) });
  assert.equal(eyes.state.foundation, 'current');
  assert.equal(eyes.state.weight, 0);
  eyes.update(0, { cues: reply(5), phraseEvents: [start(5)] });
  for (let i = 1; i <= 60; i++) eyes.update(1 / 60, { cues: reply(5 + i / 60) });
  assert.equal(eyes.state.foundation, 'relaxed');
  assert.ok(eyes.state.weight > .95);
  const visible = structuredClone(eyes.state);
  eyes.update(0, { cues: reply(0, 'speaking', 2) });
  assert.deepEqual(eyes.state.pose, visible.pose);
  assert.equal(eyes.state.weight, visible.weight);
  advance(eyes, 3, { cues: reply(0, 'speaking', 2) });
  assert.equal(eyes.state.weight, 0, 'a new reply must not replay the outgoing eye moment');
});

test('reduced motion and Eye moments off keep Current eyes throughout conversation mix', () => {
  for (const eyes of [make('auto', true), make('auto', false, false)]) {
    assert.equal(advance(eyes, 8, { listening: 1, attention: 1 }).weight, 0);
    eyes.update(0, { cues: reply(1), phraseEvents: [start(1)] });
    assert.equal(advance(eyes, 2, { cues: reply(2) }).weight, 0);
    assert.equal(eyes.state.foundation, 'current');
  }
});
