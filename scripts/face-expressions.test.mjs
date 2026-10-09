import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowFlashes, createMicroExpressions } from '../js/face-expressions.js';

const reply = (position, state = 'speaking') => ({ replyId: 1, position, state, cues: [] });

test('brow flashes wait for text and repeat their choices without global randomness', () => {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Expression controller touched global randomness'); };
  try {
    const controls = [createBrowFlashes(), createBrowFlashes()];
    for (const control of controls) {
      control.applyTuning({ browFlash: { minInterval: 0, chance: .5 } });
      control.update(1 / 60, reply(1), false, true,
        [{ replyId: 1, position: 1, time: 1, strength: .8 }]);
      assert.equal(control.state.decisions[0].reason, 'awaiting-text');
      control.setReplyText('Synthetic expression regression.');
    }
    const choices = [];
    for (let frame = 0; frame < 120; frame++) {
      const position = 1 + frame / 60;
      const beats = [{ replyId: 1, position, time: position, strength: .8 }];
      controls.forEach(control => control.update(1 / 60, reply(position), false, true, beats));
      assert.deepEqual(controls[0].state, controls[1].state);
      choices.push(controls[0].state.decisions[0].selected);
    }
    assert.ok(choices.some(Boolean));
    assert.ok(choices.some(choice => !choice));
  } finally {
    Math.random = originalRandom;
  }
});

test('brow flashes suppress blocked beats and smoothly release when disabled', () => {
  const control = createBrowFlashes();
  control.setReplyText('Synthetic expression regression.');
  control.applyTuning({ browFlash: { chance: 1, minInterval: 0 } });
  control.update(.02, reply(1), true, true,
    [{ replyId: 1, position: 1, time: 1, strength: .8 }]);
  assert.equal(control.state.decisions[0].reason, 'event-window');
  control.update(.02, reply(1.1), false, true,
    [{ replyId: 1, position: 1.1, time: 1.1, strength: .8 }]);
  for (let i = 0; i < 4; i++) control.update(.02, reply(1.1 + i * .02), false, true, []);
  const before = control.state.contribution.browL;
  assert.ok(before > 0);
  control.update(.002, reply(1.2), false, false, []);
  assert.ok(control.state.contribution.browL > 0, 'disable must not snap to zero');
  for (let i = 0; i < 60; i++) control.update(1 / 60, null, false, false, []);
  assert.ok(Object.values(control.state.contribution).every(value => value === 0));
});

test('micro motion holds at the audio position during a gap and ignores gap phrase events', () => {
  const control = createMicroExpressions();
  control.setReplyText('Synthetic expression regression.');
  for (let i = 0; i <= 90; i++) control.update(1 / 60, reply(i / 60), 0, true, 0, []);
  const held = structuredClone(control.state.contribution);
  for (let i = 0; i < 30; i++) {
    control.update(.05, reply(1.5, 'gap'), 0, true, 0,
      [{ replyId: 1, position: 1.5, type: 'start' }]);
    assert.deepEqual(control.state.contribution, held);
    assert.deepEqual(control.state.phraseEvents, []);
  }
  control.update(1 / 60, reply(1.5 + 1 / 60), 0, true, 0, []);
  assert.notDeepEqual(control.state.contribution, held);
});
