import assert from 'node:assert/strict';
import test from 'node:test';
import { createLotusMorph } from '../js/lotus-morph.js';
import { createOrbital } from '../js/orbital.js';
import { createLotus } from '../js/lotus.js';

function mapped(values, mapping) {
  const output = new Float32Array(values.length);
  for (let i = 0; i < mapping.length; i++) {
    output.set(values.subarray(mapping[i] * 3, mapping[i] * 3 + 3), i * 3);
  }
  return output;
}

function radius(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / (values.length / 3));
}

function sourceFor(orbit, clock) {
  orbit.update(clock);
  const mapping = Uint32Array.from({ length: orbit.positions.length / 3 }, (_, i) => orbit.positions.length / 3 - i - 1);
  return { mapping, positions: mapped(orbit.positions, mapping), colours: mapped(orbit.colours, mapping) };
}

test('48K winding preserves the displayed atom snapshot, reaches a complete fixed mapping and follows the live lotus', () => {
  const orbit = createOrbital(48000), lotus = createLotus(48000);
  const source = sourceFor(orbit, 9.96);
  source.positions[0] += .004;
  source.colours[0] += .003;
  const sourceCopy = source.positions.slice(), colourCopy = source.colours.slice();
  const template = lotus.positions.slice();
  const morph = createLotusMorph(source.positions, lotus.positions);
  const positions = morph.positions, colours = morph.colours, mapping = morph.mapping;
  assert.deepEqual(lotus.positions, template, 'building correspondence preserves the target template');
  assert.equal(new Set(mapping).size, 48000);
  assert.ok(mapping.every(index => index < 48000));
  morph.begin(source.positions, source.colours, 10, { orbit, sourceMapping: source.mapping });
  assert.notDeepEqual(mapped(orbit.positions, source.mapping), source.positions, 'the live atom has advanced beyond its displayed snapshot');
  morph.sample(10, lotus.positions, lotus.colours);
  assert.deepEqual(morph.positions, sourceCopy);
  assert.deepEqual(morph.colours, colourCopy);
  assert.equal(morph.progress, 0);
  morph.sample(12.21, lotus.positions, lotus.colours);
  assert.equal(morph.active, false);
  assert.deepEqual(morph.positions, mapped(lotus.positions, mapping));
  assert.deepEqual(morph.colours, mapped(lotus.colours, mapping));
  assert.deepEqual(lotus.positions, template, 'sampling preserves the target data');
  const bud = morph.positions.slice();
  lotus.update(18);
  morph.sample(18, lotus.positions, lotus.colours);
  assert.deepEqual(morph.positions, mapped(lotus.positions, mapping));
  assert.deepEqual(morph.colours, mapped(lotus.colours, mapping));
  assert.notDeepEqual(morph.positions, bud);
  assert.deepEqual(source.positions, sourceCopy);
  assert.deepEqual(source.colours, colourCopy);
  assert.equal(morph.positions, positions);
  assert.equal(morph.colours, colours);
  assert.equal(morph.mapping, mapping);
});

test('winding visibly turns and contracts, never collapses to a point, and seeks reproducibly', () => {
  const orbit = createOrbital(4000), lotus = createLotus(4000), source = sourceFor(orbit, 0);
  const morph = createLotusMorph(source.positions, lotus.positions);
  morph.begin(source.positions, source.colours, 0, { orbit, sourceMapping: source.mapping });
  morph.sample(.45, lotus.positions, lotus.colours);
  let sideways = 0;
  for (let j = 0; j < source.positions.length; j += 3) {
    const cross = source.positions[j] * morph.positions[j + 2] - source.positions[j + 2] * morph.positions[j];
    if (Math.abs(cross) > .1) sideways++;
  }
  assert.ok(sideways > 4000 * .3, 'a substantial part of the atom takes a curved path');
  assert.ok(radius(morph.positions) < radius(source.positions) * .9, 'orbits already tighten during the first sweep');
  const samples = new Map();
  for (const time of [.2, .45, .8, 1.2, 1.6, 2, 2.2, 8, 1.2, .2]) {
    const targetPositions = lotus.positions.slice(), targetColours = lotus.colours.slice();
    morph.sample(time, lotus.positions, lotus.colours);
    assert.ok(radius(morph.positions) > .3, 'the pool remains spread through the transition');
    for (let j = 0; j < morph.positions.length; j += 3) {
      assert.ok(Math.hypot(...morph.positions.subarray(j, j + 3)) < 4.2);
    }
    assert.ok(morph.colours.every(value => Number.isFinite(value) && value >= 0 && value < .981));
    assert.deepEqual(lotus.positions, targetPositions);
    assert.deepEqual(lotus.colours, targetColours);
    if (samples.has(time)) {
      assert.deepEqual(morph.positions, samples.get(time).positions);
      assert.deepEqual(morph.colours, samples.get(time).colours);
    } else samples.set(time, { positions: morph.positions.slice(), colours: morph.colours.slice() });
  }
  assert.ok(radius(samples.get(1.2).positions) < radius(source.positions) * .6, 'the middle of the winding is much smaller than the atom');
});

test('reduced motion uses a short direct path and never updates the live orbital source', () => {
  const orbit = createOrbital(4000, true), lotus = createLotus(4000, true), source = sourceFor(orbit, 0);
  orbit.update = () => { throw new Error('Reduced motion must not run an orbital sweep.'); };
  const morph = createLotusMorph(source.positions, lotus.positions, { reduce: true });
  morph.begin(source.positions, source.colours, 0, { orbit, sourceMapping: source.mapping });
  assert.equal(morph.duration, .42);
  morph.sample(.21, lotus.positions, lotus.colours);
  const target = mapped(lotus.positions, morph.mapping);
  for (let j = 0; j < target.length; j++) {
    assert.ok(Math.abs(morph.positions[j] - (source.positions[j] + target[j]) * .5) < 3e-7);
  }
  morph.sample(.42, lotus.positions, lotus.colours);
  assert.equal(morph.active, false);
  assert.deepEqual(morph.positions, target);
  assert.deepEqual(morph.colours, mapped(lotus.colours, morph.mapping));
});
