import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/jellyfish.js', import.meta.url), 'utf8');
const { createJellyfish } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function inspect(form, count) {
  assert.ok(form.positions instanceof Float32Array);
  assert.ok(form.colours instanceof Float32Array);
  assert.equal(form.positions.length, count * 3);
  assert.equal(form.colours.length, count * 3);
  let warm = 0, cool = 0, bell = 0, trailing = 0;
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (let j = 0; j < form.positions.length; j += 3) {
    const x = form.positions[j], y = form.positions[j + 1], z = form.positions[j + 2];
    const radius = Math.hypot(x, y, z);
    assert.ok(Number.isFinite(radius) && radius <= form.bounds.radius, `bounded particle ${j / 3}: ${radius}`);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    if (y > .8) bell++;
    if (y < -.3) trailing++;
    const red = form.colours[j], green = form.colours[j + 1], blue = form.colours[j + 2];
    if (red > blue * 1.2 && red > .03) warm++;
    if (blue > red * 1.2 && blue > .03) cool++;
    for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(form.colours[j + c])
      && form.colours[j + c] > 0 && form.colours[j + c] < 1);
  }
  if (count >= 9000) {
    assert.ok(bell > count * .25, 'a substantial bell remains above its filaments');
    assert.ok(trailing > count * .15, 'a substantial trailing body remains visible below');
    assert.ok(warm > count * .15 && cool > count * .25, 'warm organs and cool membrane/tendrils both contribute');
    assert.ok(maxY - minY > 4.5 && maxY - minY < 6, 'tall coherent silhouette');
    assert.ok(maxX - minX > 3 && maxX - minX < 4.9, 'bell and sway stay framed');
  }
}

for (const count of [48000, 9000]) {
  test(`${count} particles form finite bounded deterministic jellyfish targets`, () => {
    const a = createJellyfish(count), b = createJellyfish(count);
    for (const clock of [0, .25, 2, 8, 31, 10000, -1, NaN, Infinity]) {
      a.update(clock); b.update(clock);
      inspect(a, count);
      assert.deepEqual(a.positions, b.positions);
      assert.deepEqual(a.colours, b.colours);
    }
  });
}

test('one stable pool deforms continuously, changes light, and seeks without accumulated state', () => {
  const form = createJellyfish(48000);
  const positions = form.positions, colours = form.colours;
  const initialPositions = positions.slice(), initialColours = colours.slice();
  form.update(1.8);
  assert.equal(form.positions, positions);
  assert.equal(form.colours, colours);
  let moving = 0, relit = 0;
  for (let j = 0; j < positions.length; j += 3) {
    if (Math.hypot(positions[j] - initialPositions[j], positions[j + 1] - initialPositions[j + 1], positions[j + 2] - initialPositions[j + 2]) > .03) moving++;
    if (Math.abs(colours[j] - initialColours[j]) > .0001) relit++;
  }
  assert.ok(moving > 48000 * .7, `${moving} particles deform`);
  assert.ok(relit > 48000 * .7, `${relit} particles relight`);
  const before = positions.slice();
  form.update(1.801);
  let largestStep = 0;
  for (let j = 0; j < positions.length; j += 3) {
    largestStep = Math.max(largestStep, Math.hypot(positions[j] - before[j], positions[j + 1] - before[j + 1], positions[j + 2] - before[j + 2]));
  }
  assert.ok(largestStep < .002, `no branch jumps: ${largestStep}`);
  form.update(0);
  assert.deepEqual(positions, initialPositions);
  assert.deepEqual(colours, initialColours);
});

test('reduced motion freezes both form and light at the initial composition', () => {
  const form = createJellyfish(9000, true);
  const positions = form.positions.slice(), colours = form.colours.slice();
  form.update(40);
  assert.deepEqual(form.positions, positions);
  assert.deepEqual(form.colours, colours);
  inspect(form, 9000);
});

test('construction and animation do not advance the global random generator', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Global RNG was used'); };
  try {
    const form = createJellyfish(9000);
    form.update(9.8);
    inspect(form, 9000);
  } finally { Math.random = original; }
});

test('empty pools are valid and invalid counts are rejected', () => {
  inspect(createJellyfish(0), 0);
  for (const count of [-1, .5, NaN, Infinity]) assert.throws(() => createJellyfish(count), RangeError);
});
