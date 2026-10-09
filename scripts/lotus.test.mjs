import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/lotus.js', import.meta.url), 'utf8');
const { createLotus } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function inspect(form, count) {
  assert.ok(form.positions instanceof Float32Array);
  assert.ok(form.colours instanceof Float32Array);
  assert.equal(form.positions.length, count * 3);
  assert.equal(form.colours.length, count * 3);
  assert.ok(form.openness >= 0 && form.openness <= 1);
  for (let j = 0; j < form.positions.length; j += 3) {
    const radius = Math.hypot(form.positions[j], form.positions[j + 1], form.positions[j + 2]);
    assert.ok(Number.isFinite(radius) && radius <= form.bounds.radius, `bounded particle ${j / 3}: ${radius}`);
    for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(form.colours[j + c])
      && form.colours[j + c] >= 0 && form.colours[j + c] < 1);
  }
}
function visibleWidth(form) {
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < form.positions.length; j += 3) {
    if (form.colours[j + 2] < .08) continue;
    lo = Math.min(lo, form.positions[j]); hi = Math.max(hi, form.positions[j]);
  }
  return hi - lo;
}

for (const count of [4000, 48000, 64000]) {
  test(`${count} particles remain deterministic, finite and bounded from bud through long seeks`, () => {
    const a = createLotus(count), b = createLotus(count);
    for (const clock of [0, .25, 2.8, 5.4, 7.2, 31, 10000, 1e9, -1, NaN, Infinity]) {
      a.update(clock); b.update(clock);
      inspect(a, count);
      assert.deepEqual(a.positions, b.positions);
      assert.deepEqual(a.colours, b.colours);
    }
  });
}

test('opening unfolds a narrow bud into a broad dimensional flower over seven seconds', () => {
  const form = createLotus(48000);
  const bud = visibleWidth(form);
  assert.equal(form.openness, 0);
  let last = 0;
  for (const clock of [.5, 1, 2, 3, 4, 5, 6, 7.2]) {
    form.update(clock);
    assert.ok(form.openness >= last, 'opening progresses monotonically');
    last = form.openness;
  }
  assert.equal(form.openness, 1);
  assert.ok(bud < 1.6, `narrow tapered bud: ${bud}`);
  assert.ok(visibleWidth(form) > 5.9, 'outer petals establish a broad lotus silhouette');
  let above = 0, below = 0, warm = 0, dim = 0;
  for (let j = 0; j < form.positions.length; j += 3) {
    if (form.positions[j + 1] > .5) above++;
    if (form.positions[j + 1] < -.5) below++;
    if (form.colours[j] > form.colours[j + 2] * 1.8 && form.colours[j] > .03) warm++;
    if (form.colours[j + 2] < .22) dim++;
  }
  assert.ok(above > 48000 * .15 && below > 48000 * .15, 'raised back tiers and low foreground petals');
  assert.ok(warm > 48000 * .015 && warm < 48000 * .04, 'small, restrained gold stamen cluster');
  assert.ok(dim > 48000 * .5, 'translucent interiors leave contrast for brighter edge filaments');
});

test('stable buffers seek without accumulated state; open petals and light stay alive', () => {
  const form = createLotus(9000), positions = form.positions, colours = form.colours;
  form.update(10);
  const initial = positions.slice(), initialColours = colours.slice();
  form.update(12);
  assert.equal(form.positions, positions); assert.equal(form.colours, colours);
  let moving = 0, relit = 0;
  for (let j = 0; j < positions.length; j += 3) {
    if (Math.hypot(positions[j] - initial[j], positions[j + 1] - initial[j + 1], positions[j + 2] - initial[j + 2]) > .008) moving++;
    if (Math.abs(colours[j + 2] - initialColours[j + 2]) > .001) relit++;
  }
  assert.ok(moving > 9000 * .65, 'independent petal motion continues');
  assert.ok(relit > 9000 * .3, 'travelling light continues');
  form.update(10);
  assert.deepEqual(positions, initial); assert.deepEqual(colours, initialColours);
});

test('replay restarts the bud at an arbitrary absolute clock and repeats the full opening', () => {
  const form = createLotus(9000), original = createLotus(9000);
  form.update(24); form.replay(40);
  assert.equal(form.openness, 0);
  assert.deepEqual(form.positions, original.positions);
  assert.deepEqual(form.colours, original.colours);
  for (const age of [.5, 2, 5, 8, 20]) {
    original.update(age); form.update(40 + age);
    assert.deepEqual(form.positions, original.positions);
    assert.deepEqual(form.colours, original.colours);
    assert.equal(form.openness, original.openness);
  }
});

test('reduced motion starts fully open and freezes geometry and colour including replay', () => {
  const form = createLotus(9000, true);
  assert.equal(form.openness, 1);
  assert.ok(visibleWidth(form) > 5.9);
  const positions = form.positions.slice(), colours = form.colours.slice();
  for (const clock of [3, 100, Infinity]) {
    form.update(clock); form.replay(clock);
    assert.equal(form.openness, 1);
    assert.deepEqual(form.positions, positions); assert.deepEqual(form.colours, colours);
  }
});

test('the generator never uses global randomness; empty and invalid counts are handled', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Global RNG was used'); };
  try {
    const form = createLotus(4000); form.update(9); inspect(form, 4000);
    inspect(createLotus(0), 0);
    for (const count of [-1, .5, NaN, Infinity]) assert.throws(() => createLotus(count), RangeError);
  } finally { Math.random = original; }
});


test('the centre releases a visible upward stream as the lotus opens', () => {
  const form = createLotus(48000);
  const highGrains = () => {
    const indices = [];
    for (let j = 0; j < form.positions.length; j += 3) {
      if (form.positions[j + 1] > 1.9 && form.positions[j + 1] < 2.4
        && Math.abs(form.positions[j]) < .7 && form.colours[j + 2] > .06) indices.push(j);
    }
    return indices;
  };
  assert.equal(highGrains().length, 0, 'the closed bud has no premature stream');
  form.update(8);
  const rising = highGrains(), before = form.positions.slice();
  assert.ok(rising.length > 100, 'the open flower has a substantial centre stream');
  form.update(8.05);
  assert.ok(rising.filter(j => form.positions[j + 1] > before[j + 1]).length > rising.length * .95,
    'the stream actually travels upward');
});

test('fast bright traces have quiet gaps and stay confined to a small part of the flower', () => {
  const form = createLotus(48000);
  let quiet = 0, peak = 0, samples = 0;
  for (let step = 0; step < 100; step++) {
    form.update(4 + step * .1);
    let bright = 0;
    for (let j = 0; j < form.colours.length; j += 3) {
      if (form.colours[j] > .55 && form.colours[j + 1] > .65 && form.colours[j + 2] > .93) bright++;
    }
    peak = Math.max(peak, bright);
    if (bright === 0) quiet++;
    samples++;
  }
  assert.ok(peak > 10, 'a clear bright moving head appears');
  assert.ok(peak < 480, 'the flower never flashes as a whole');
  assert.ok(quiet > samples * .65, 'most time is quiet rather than continuously chasing light');
  for (const age of [4.41, 4.7, 5.55, 11.7, 12.5, 17.8, 4.7]) {
    const fresh = createLotus(48000); fresh.update(age); form.update(age);
    assert.deepEqual(form.positions, fresh.positions);
    assert.deepEqual(form.colours, fresh.colours, 'flash seeks have no residual event state');
  }
});
