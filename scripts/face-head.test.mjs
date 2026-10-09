import assert from 'node:assert/strict';
import test from 'node:test';
import { createFaceHead } from '../js/facehead.js';

function create(reduce = false) {
  let seed = 0x79a71;
  return createFaceHead(reduce, { random() {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  } });
}
function advance(head, seconds, input, fps = 60) {
  let pose;
  for (let frame = 0; frame < seconds * fps; frame++) pose = head.update(1 / fps, input);
  return { ...pose };
}

test('silent input preserves existing idle and speaking decisions exactly', () => {
  const controls = [create(), create()];
  for (let frame = 0; frame < 600; frame++) {
    const speaking = frame >= 120 && frame < 480;
    const input = { speaking, envelope: speaking ? Math.max(0, Math.sin(frame * .2)) * .7 : 0 };
    assert.deepEqual(controls[0].update(1 / 60, input),
      controls[1].update(1 / 60, { ...input, listening: !speaking, inputVolume: 0 }));
    assert.deepEqual(controls[0].consumeBeats(), controls[1].consumeBeats());
    assert.deepEqual(controls[0].consumePhraseEvents(), controls[1].consumePhraseEvents());
  }
  assert.equal(controls[1].diagnostics.listeningNods, 0);
});

test('quiet input, invalid levels and brief noise do not earn an acknowledgement', () => {
  const head = create();
  for (const inputVolume of [.03, NaN, Infinity, -1])
    advance(head, 2, { listening: true, inputVolume });
  advance(head, .1, { listening: true, inputVolume: .3 });
  advance(head, 2, { listening: true, inputVolume: 0 });
  assert.equal(head.diagnostics.listeningNods, 0);
  assert.ok(head.diagnostics.attention < .001);
});

test('a sustained turn earns one small nod without emitting speech accents', () => {
  for (const fps of [30, 60, 120]) {
    const head = create(), rest = create();
    let largestPitchDifference = 0;
    for (let frame = 0; frame < 10 * fps; frame++) {
      const pose = head.update(1 / fps, { listening: true, inputVolume: .18 });
      const neutral = rest.update(1 / fps);
      largestPitchDifference = Math.max(largestPitchDifference, Math.abs(pose.pitch - neutral.pitch));
      assert.ok(Object.values(pose).every(value => typeof value !== 'number' || Number.isFinite(value)));
    }
    assert.equal(head.diagnostics.listeningNods, 1);
    assert.ok(head.diagnostics.attention > .99);
    assert.ok(largestPitchDifference > .4 && largestPitchDifference < 1.1);
    assert.deepEqual(head.consumeBeats(), []);
    assert.deepEqual(head.consumePhraseEvents(), []);
  }
});

test('quiet rearms the response but short pauses and the cooldown prevent repeated nods', () => {
  const head = create();
  advance(head, 1.2, { listening: true, inputVolume: .18 });
  advance(head, .5, { listening: true, inputVolume: 0 });
  advance(head, 1.2, { listening: true, inputVolume: .18 });
  assert.equal(head.diagnostics.listeningNods, 1);
  advance(head, 1.5, { listening: true, inputVolume: 0 });
  advance(head, 1.2, { listening: true, inputVolume: .18 });
  assert.equal(head.diagnostics.listeningNods, 1);
  advance(head, 1.5, { listening: true, inputVolume: 0 });
  advance(head, 1.2, { listening: true, inputVolume: .18 });
  assert.equal(head.diagnostics.listeningNods, 2);
});

test('leaving listening releases attention smoothly; speech and reduced motion cannot start a listening nod', () => {
  const head = create();
  advance(head, 2, { listening: true, inputVolume: .18 });
  const held = head.diagnostics.attention;
  head.update(1 / 60, { listening: false, inputVolume: .18 });
  assert.ok(head.diagnostics.attention > 0 && head.diagnostics.attention < held);
  advance(head, 3, { listening: false, inputVolume: .18 });
  assert.ok(head.diagnostics.attention < .001);
  const speaking = create();
  advance(speaking, 5, { speaking: true, listening: true, inputVolume: .18 });
  assert.equal(speaking.diagnostics.listeningNods, 0);
  const reduced = create(true);
  advance(reduced, 10, { listening: true, inputVolume: .18 });
  assert.equal(reduced.diagnostics.listeningNods, 0);
});
