import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/stream-morph.js', import.meta.url), 'utf8');
const { createStreamMorph } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const COUNT = 48000, DURATION = 2.35;
const outlet = [.95, 1.25, .2], inlet = [2.5, 1.8, 0];
function pools(count = COUNT) {
  const face = new Float32Array(count * 3), jelly = new Float32Array(count * 3);
  const faceColours = new Float32Array(count * 3), jellyColours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const j = i * 3, angle = i * 2.399963229728653, fraction = (i + .5) / count;
    const radius = Math.sqrt(fraction);
    face[j] = Math.cos(angle) * radius * 1.6;
    face[j + 1] = Math.sin(angle) * radius * 2.2;
    face[j + 2] = .2 + .5 * (1 - radius);
    jelly[j] = 3 + Math.cos(angle) * (fraction < .65 ? Math.sin(fraction / .65 * Math.PI * .5) * 1.6 : .55);
    jelly[j + 1] = fraction < .65 ? 1.5 + Math.cos(fraction / .65 * Math.PI * .5) * 1.4 : 1.5 - (fraction - .65) * 9;
    jelly[j + 2] = Math.sin(angle) * .7;
    faceColours[j] = .2; faceColours[j + 1] = .3; faceColours[j + 2] = .5;
    jellyColours[j] = .6; jellyColours[j + 1] = .4; jellyColours[j + 2] = .25;
  }
  return { face, jelly, faceColours, jellyColours };
}
const pool = pools();
const dark = new Float32Array(COUNT * 3), light = new Float32Array(COUNT * 3).fill(1);
function checkMapped(morph, positions, colours) {
  for (let i = 0; i < morph.mapping.length; i++) {
    const j = i * 3, k = morph.mapping[i] * 3;
    for (let c = 0; c < 3; c++) {
      assert.equal(morph.positions[j + c], positions[k + c]);
      assert.equal(morph.colours[j + c], colours[k + c]);
    }
  }
}

test('48,000 persistent identities map bijectively and deterministically without global random state', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('Global RNG was used.'); };
  try {
    const a = createStreamMorph(pool.face, pool.jelly), b = createStreamMorph(pool.face, pool.jelly);
    assert.deepEqual(a.mapping, b.mapping);
    const seen = new Uint8Array(COUNT);
    for (const destination of a.mapping) {
      assert.ok(destination < COUNT);
      assert.equal(seen[destination], 0);
      seen[destination] = 1;
    }
    assert.ok(seen.every(value => value === 1));
    a.begin(pool.face, pool.faceColours, 4, { outlet, inlet });
    b.begin(pool.face, pool.faceColours, 4, { outlet, inlet });
    a.sample(5.05, pool.jelly, pool.jellyColours); b.sample(5.05, pool.jelly, pool.jellyColours);
    assert.deepEqual(a.positions, b.positions);
    assert.deepEqual(a.colours, b.colours);
  } finally { Math.random = original; }
});

test('release and arrival overlap: the bell builds while lower face particles still wait', () => {
  const morph = createStreamMorph(pool.face, pool.jelly);
  morph.begin(pool.face, dark, 0, { outlet, inlet });
  morph.sample(1 / 60, pool.jelly, light);
  assert.notDeepEqual(morph.positions, pool.face, 'pull starts on the first frame');
  morph.sample(1.02, pool.jelly, light);
  let waiting = 0, arrived = 0, travelling = 0, arrivedHeight = 0;
  for (let i = 0; i < COUNT; i++) {
    const weight = morph.colours[i * 3];
    if (weight === 0) waiting++;
    else if (weight === 1) { arrived++; arrivedHeight += pool.jelly[morph.mapping[i] * 3 + 1]; }
    else travelling++;
  }
  assert.ok(waiting > COUNT * .15, `${waiting} still describe the face`);
  assert.ok(arrived > COUNT * .01, `${arrived} already describe the jellyfish`);
  assert.ok(travelling > COUNT * .35, `${travelling} connect the two bodies`);
  assert.ok(arrivedHeight / arrived > 2.5, 'leading particles build the upper bell first');
  morph.sample(1.85, pool.jelly, light);
  arrived = 0;
  for (let i = 0; i < COUNT; i++) if (morph.colours[i * 3] === 1) arrived++;
  assert.ok(arrived > COUNT * .55, 'the body becomes readable before the last grains arrive');
});

test('travelling grains pass through one narrow diagonal stream, not a simultaneous diffuse interpolation', () => {
  const morph = createStreamMorph(pool.face, pool.jelly);
  const sourceColour = new Float32Array(COUNT * 3), targetColour = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    sourceColour[i * 3 + 1] = 1;
    targetColour[i * 3] = targetColour[i * 3 + 1] = 1;
  }
  morph.begin(pool.face, sourceColour, 0, { outlet, inlet });
  const dx = inlet[0] - outlet[0], dy = inlet[1] - outlet[1], dz = inlet[2] - outlet[2];
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  let observed = 0;
  for (const time of [.45, .8, 1.15, 1.5]) {
    morph.sample(time, pool.jelly, targetColour);
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3, weight = morph.colours[j] / morph.colours[j + 1];
      // Chroma records travel while cancelling local density compensation.
      // This interior range is
      // well inside the shared stream rather than either gathering fan.
      if (weight < .43 || weight > .7) continue;
      const x = morph.positions[j] - outlet[0], y = morph.positions[j + 1] - outlet[1], z = morph.positions[j + 2] - outlet[2];
      const along = (x * dx + y * dy + z * dz) / lengthSquared;
      const radius = Math.hypot(x - along * dx, y - along * dy, z - along * dz);
      assert.ok(along > 0 && along < 1, 'grain is between the gates');
      assert.ok(radius <= .14001, `stream radius ${radius}`);
      observed++;
    }
  }
  assert.ok(observed > COUNT * .3, 'the visible stream carries a substantial share of the pool');
});


test('packed stream light stays positive and keeps colour while avoiding additive whiteout', () => {
  const morph = createStreamMorph(pool.face, pool.jelly);
  const colours = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) { colours[i * 3] = .3; colours[i * 3 + 1] = .6; colours[i * 3 + 2] = .9; }
  morph.begin(pool.face, colours, 0, { outlet, inlet });
  morph.sample(1.02, pool.jelly, colours);
  let compensated = 0, fullStrength = 0;
  for (let i = 0; i < COUNT; i++) {
    const j = i * 3, gain = morph.colours[j + 1] / colours[j + 1];
    assert.ok(gain >= .18 - 1e-7 && gain <= 1 + 1e-7, 'no grain goes dark or becomes brighter');
    assert.ok(Math.abs(morph.colours[j] / morph.colours[j + 1] - .5) < 1e-7, 'colour balance is preserved');
    if (Math.abs(gain - .18) < 1e-6) compensated++;
    if (Math.abs(gain - 1) < 1e-6) fullStrength++;
  }
  assert.ok(compensated > COUNT * .1, 'packed transit receives density compensation');
  assert.ok(fullStrength > COUNT * .15, 'waiting and settled body grains keep full light');
  morph.sample(0, pool.jelly, colours);
  assert.deepEqual(morph.colours, colours, 'source is exact at the first instant');
  morph.sample(DURATION, pool.jelly, colours);
  assert.deepEqual(morph.colours, colours, 'settled body restores every grain to full light');
});

test('the captured source is exact, settled live targets stay mapped, and output buffers are reused', () => {
  const morph = createStreamMorph(pool.face, pool.jelly);
  const positions = morph.positions, colours = morph.colours, mapping = morph.mapping;
  morph.begin(pool.face, pool.faceColours, 0, { outlet, inlet });
  morph.sample(0, pool.jelly, pool.jellyColours);
  assert.deepEqual(morph.positions, pool.face);
  assert.deepEqual(morph.colours, pool.faceColours);
  morph.sample(DURATION, pool.jelly, pool.jellyColours);
  checkMapped(morph, pool.jelly, pool.jellyColours);
  assert.equal(morph.active, false); assert.equal(morph.progress, 1); assert.equal(morph.blend, 1);
  const moved = pool.jelly.slice();
  for (let j = 0; j < moved.length; j += 3) moved[j] += .2;
  morph.sample(7, moved, pool.jellyColours);
  checkMapped(morph, moved, pool.jellyColours);
  assert.equal(morph.positions, positions); assert.equal(morph.colours, colours); assert.equal(morph.mapping, mapping);
});

test('absolute-time seeking stays deterministic, finite and lit without modifying caller data or gates', () => {
  const morph = createStreamMorph(pool.face, pool.jelly);
  const sourceCopy = pool.face.slice(), targetCopy = pool.jelly.slice();
  const mutableOutlet = [...outlet], mutableInlet = [...inlet];
  morph.begin(pool.face, pool.faceColours, 0, { outlet: mutableOutlet, inlet: mutableInlet });
  mutableOutlet[0] = 999; mutableInlet[0] = 999;
  let earlier;
  for (const time of [.1, .75, 1.5, 2.3, 4, .75]) {
    morph.sample(time, pool.jelly, pool.jellyColours);
    assert.ok(morph.positions.every(Number.isFinite));
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3, k = morph.mapping[i] * 3;
      for (let c = 0; c < 3; c++) {
        const colour = morph.colours[j + c];
        assert.ok(colour >= Math.min(pool.faceColours[j + c], pool.jellyColours[k + c]) * .18 - 1e-7);
        assert.ok(colour <= Math.max(pool.faceColours[j + c], pool.jellyColours[k + c]) + 1e-7);
      }
      assert.ok(Math.abs(morph.positions[j]) < 10, 'gates are captured, not retained by reference');
    }
    if (time === .75) {
      if (earlier) assert.deepEqual(morph.positions, earlier);
      else earlier = morph.positions.slice();
    }
  }
  assert.deepEqual(pool.face, sourceCopy); assert.deepEqual(pool.jelly, targetCopy);
});

test('midstream reversals recapture the displayed pool and return original face identities without a jump', () => {
  const morph = createStreamMorph(pool.face, pool.jelly);
  morph.begin(pool.face, pool.faceColours, 0, { outlet, inlet });
  morph.sample(.9, pool.jelly, pool.jellyColours);
  const captured = morph.positions.slice(), capturedColours = morph.colours.slice();
  morph.begin(morph.positions, morph.colours, .9, { reverse: true });
  morph.sample(.9, pool.face, pool.faceColours);
  assert.deepEqual(morph.positions, captured); assert.deepEqual(morph.colours, capturedColours);
  morph.sample(4, pool.face, pool.faceColours);
  assert.deepEqual(morph.positions, pool.face); assert.deepEqual(morph.colours, pool.faceColours);
  morph.begin(morph.positions, morph.colours, 4, { outlet, inlet });
  morph.sample(4, pool.jelly, pool.jellyColours);
  assert.deepEqual(morph.positions, pool.face);
  morph.sample(7, pool.jelly, pool.jellyColours);
  checkMapped(morph, pool.jelly, pool.jellyColours);
});

test('reduced motion takes a short direct path without stream or release delay', () => {
  const morph = createStreamMorph(pool.face, pool.jelly, { reduce: true });
  morph.begin(pool.face, pool.faceColours, 0, { outlet, inlet });
  morph.sample(.21, pool.jelly, pool.jellyColours);
  for (let i = 0; i < COUNT; i++) {
    const j = i * 3, k = morph.mapping[i] * 3;
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(morph.positions[j + c] - (pool.face[j + c] + pool.jelly[k + c]) * .5) < 3e-7);
  }
  morph.sample(.42, pool.jelly, pool.jellyColours);
  assert.equal(morph.active, false);
  checkMapped(morph, pool.jelly, pool.jellyColours);
});

test('empty pools and coincident gates work; malformed templates, durations and gates fail clearly', () => {
  const empty = new Float32Array(), point = new Float32Array([0, 0, 0]);
  const morph = createStreamMorph(empty, empty);
  morph.begin(empty, empty, 0).sample(3, empty, empty);
  assert.equal(morph.active, false);
  const single = createStreamMorph(point, point);
  single.begin(point, point, 0, { outlet: [0, 0, 0], inlet: [0, 0, 0] }).sample(.5, point, point);
  assert.ok(single.positions.every(Number.isFinite));
  assert.throws(() => createStreamMorph(new Float32Array(2), empty), RangeError);
  assert.throws(() => createStreamMorph(point, empty), RangeError);
  assert.throws(() => createStreamMorph(point, new Float32Array([NaN, 0, 0])), RangeError);
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => createStreamMorph(point, point, { duration }), RangeError);
  assert.throws(() => single.begin(point, point, 0, { outlet: [1, NaN, 0] }), RangeError);
  assert.throws(() => single.begin(point, empty, 0), RangeError);
});
