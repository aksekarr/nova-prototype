import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/orbital.js', import.meta.url), 'utf8');
const { createOrbital } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function checkTargets(form, count) {
  assert.ok(form.positions instanceof Float32Array);
  assert.ok(form.colours instanceof Float32Array);
  assert.equal(form.positions.length, count * 3);
  assert.equal(form.colours.length, count * 3);
  let outer = 0, nucleus = 0, star = 0, luminous = 0;
  for (let j = 0; j < form.positions.length; j += 3) {
    const radius = Math.hypot(form.positions[j], form.positions[j + 1], form.positions[j + 2]);
    assert.ok(Number.isFinite(radius) && radius <= form.bounds.radius, `bounded particle at ${j / 3}: ${radius}`);
    if (radius < .4) nucleus++;
    if (radius < 1.2) star++;
    if (form.colours[j + 2] > .05) luminous++;
    if (radius > 2) outer++;
    assert.ok(form.colours[j + 2] >= form.colours[j] && form.colours[j + 2] >= form.colours[j + 1], 'cool stellar palette');
    for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(form.colours[j + c])
      && form.colours[j + c] > 0 && form.colours[j + c] < 1);
  }
  if (count >= 9000) {
    assert.ok(nucleus > count * .065 && nucleus < count * .13, 'tight nucleus remains distinct from its corona');
    assert.ok(star > count * .20 && star < count * .25, 'substantial star, corona and radial filaments');
    assert.ok(luminous > count * .7, 'most of the pool contributes visible light');
    assert.ok(outer > count * .5, 'most particles articulate the orbital form');
  }
}

for (const count of [48000, 32000, 9000]) {
  test(`${count} particles fill deterministic, finite bounded targets over time`, () => {
    const a = createOrbital(count), b = createOrbital(count);
    assert.deepEqual(a.positions, b.positions);
    assert.deepEqual(a.colours, b.colours);
    for (const time of [0, .25, 6, 31, 10000, -1, NaN, Infinity]) {
      a.update(time); b.update(time);
      checkTargets(a, count);
      assert.deepEqual(a.positions, b.positions);
      assert.deepEqual(a.colours, b.colours);
    }
  });
}

test('settled orbits and their light keep moving; seeking has no accumulated state', () => {
  const form = createOrbital(9000);
  const positions = form.positions, colours = form.colours;
  const start = positions.slice(), initialColour = colours.slice();
  form.update(2);
  assert.equal(form.positions, positions);
  assert.equal(form.colours, colours);
  let moving = 0, relit = 0;
  for (let i = 0; i < 9000; i++) {
    const j = i * 3;
    if (Math.hypot(positions[j] - start[j], positions[j + 1] - start[j + 1], positions[j + 2] - start[j + 2]) > .03) moving++;
    if (Math.abs(colours[j + 2] - initialColour[j + 2]) > .0001) relit++;
  }
  assert.ok(moving > 6000, `${moving} moving particles`);
  assert.ok(relit > 5000, `${relit} relit particles`);
  form.update(0);
  assert.deepEqual(positions, start);
  assert.deepEqual(colours, initialColour);
});

test('reduced motion holds both geometry and light at the initial composition', () => {
  const form = createOrbital(9000, true);
  const positions = form.positions.slice(), colours = form.colours.slice();
  form.update(40);
  assert.deepEqual(form.positions, positions);
  assert.deepEqual(form.colours, colours);
  checkTargets(form, 9000);
});

test('construction and animation do not use the global random generator', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Global RNG was used'); };
  try {
    const form = createOrbital(9000);
    form.update(9.8);
    checkTargets(form, 9000);
  } finally { Math.random = original; }
});

test('empty pools are valid and invalid counts are rejected', () => {
  checkTargets(createOrbital(0), 0);
  for (const count of [-1, .5, NaN, Infinity]) assert.throws(() => createOrbital(count), RangeError);
});
