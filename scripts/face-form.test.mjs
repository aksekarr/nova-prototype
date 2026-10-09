import assert from 'node:assert/strict';
import test from 'node:test';
import { createFaceForm } from '../js/face-form.js';

const base = new Float32Array([-1, 1, .2, 0, 0, 0, 1, -1, -.2, 2, 1, 1]);
const attached = new Float32Array([1, 1, 1, 1]);
function create(reduce = false) {
  return createFaceForm({ base, edge: new Float32Array([1, 0, 1]), end: 3,
    width: 2, height: 2, centreX: 0, centreY: 0 }, reduce);
}
function advance(form, seconds, eligible = true, attention = 0, fps = 60) {
  for (let i = 0; i < seconds * fps; i++) form.update(1 / fps, eligible, attention);
}
test('shape flow protects features, background, detached particles and intrinsic buffers', () => {
  const form = create(), original = base.slice();
  advance(form, 3);
  const output = form.apply(base, attached);
  assert.notDeepEqual(output, base);
  assert.deepEqual(base, original);
  assert.deepEqual(output.slice(3, 6), base.slice(3, 6));
  assert.deepEqual(output.slice(9), base.slice(9));
  for (let i = 2; i < output.length; i += 3) assert.equal(output[i], base[i]);
  assert.deepEqual(form.apply(base, new Float32Array(4)), base);
  assert.strictEqual(form.apply(base, attached, 0), base);
});
test('analytic flow agrees at 30, 60 and 120 fps and stays bounded', () => {
  const outputs = [];
  for (const fps of [30, 60, 120]) {
    const form = create();
    for (let i = 0; i < 30 * fps; i++) {
      form.update(1 / fps, true);
      const output = form.apply(base, attached);
      assert.ok(output.every(Number.isFinite));
      for (let j = 0; j < base.length; j++) assert.ok(Math.abs(output[j] - base[j]) < .25);
    }
    outputs.push(form.apply(base, attached).slice());
  }
  for (const output of outputs.slice(1))
    output.forEach((v, i) => assert.ok(Math.abs(v - outputs[0][i]) < 1e-6));
});
test('listening gathers the silhouette and quiet returns to the same flowing phase', () => {
  const free = create(), focused = create();
  advance(free, 3); advance(focused, 3, true, 1);
  assert.ok(focused.state.width < -.07);
  assert.ok(Math.abs(focused.state.bend) < Math.abs(free.state.bend));
  advance(free, 2); advance(focused, 2);
  assert.deepEqual(focused.state, free.state);
});
test('reply suppression and comparison switch ease out; reduced motion is exact identity', () => {
  const form = create();
  advance(form, 3);
  const before = form.state.weight;
  form.update(1 / 60, false);
  assert.ok(form.state.weight > 0 && form.state.weight < before);
  advance(form, 4, false);
  assert.strictEqual(form.apply(base, attached), base);
  advance(form, 3);
  form.setAmount(0);
  form.update(1 / 60, true);
  assert.ok(form.state.weight > 0);
  advance(form, 4);
  assert.strictEqual(form.apply(base, attached), base);
  const reduced = create(true);
  advance(reduced, 10, true, 1);
  assert.strictEqual(reduced.apply(base, attached), base);
  reduced.update(NaN, true, NaN);
  assert.ok(Object.values(reduced.state).every(Number.isFinite));
});
