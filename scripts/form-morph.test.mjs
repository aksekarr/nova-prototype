import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function loadModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const { createFormMorph } = await loadModule('../js/form-morph.js');
const { createOrbital } = await loadModule('../js/orbital.js');
const { createJellyfish } = await loadModule('../js/jellyfish.js');
const { createJellyMotion } = await loadModule('../js/jelly-motion.js');
const COUNT = 48000;

function facePool(count = COUNT) {
  const positions = new Float32Array(count * 3), colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const j = i * 3, angle = i * 2.399963229728653;
    const radius = Math.sqrt((i + .5) / count), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    positions[j] = x * 1.8;
    positions[j + 1] = y * 2.5;
    positions[j + 2] = .2 + .8 * Math.exp(-x * x * 7 - y * y * 5);
    colours[j] = .06 + radius * .2;
    colours[j + 1] = .1 + (1 - radius) * .3;
    colours[j + 2] = .32 + radius * .25;
  }
  return { positions, colours };
}

function checkMapped(morph, orbital) {
  for (let i = 0; i < morph.mapping.length; i++) {
    const j = i * 3, target = morph.mapping[i] * 3;
    for (let c = 0; c < 3; c++) {
      assert.equal(morph.positions[j + c], orbital.positions[target + c]);
      assert.equal(morph.colours[j + c], orbital.colours[target + c]);
    }
  }
}

const face = facePool();

test('48,000 fixed identities form a deterministic spatial bijection without touching global RNG', () => {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Global RNG was used.'); };
  try {
    const orbital = createOrbital(COUNT);
    const a = createFormMorph(face.positions, orbital.positions);
    const b = createFormMorph(face.positions, orbital.positions);
    assert.ok(a.mapping instanceof Uint32Array);
    assert.equal(a.mapping.length, COUNT);
    assert.deepEqual(a.mapping, b.mapping);
    const seen = new Uint8Array(COUNT);
    let pairedDistance = 0, shuffledDistance = 0;
    for (let i = 0; i < COUNT; i++) {
      const destination = a.mapping[i];
      assert.ok(destination < COUNT);
      assert.equal(seen[destination], 0, 'no duplicate destination');
      seen[destination] = 1;
      const j = i * 3, k = destination * 3;
      for (let c = 0; c < 3; c++) {
        pairedDistance += (face.positions[j + c] - orbital.positions[k + c]) ** 2;
        shuffledDistance += (face.positions[j + c] - orbital.positions[j + c]) ** 2;
      }
    }
    assert.ok(seen.every(value => value === 1), 'no missing destination');
    assert.ok(pairedDistance < shuffledDistance * .65, 'spatial pairing avoids shuffled cross-face travel');
    a.begin(face.positions, face.colours, 9); b.begin(face.positions, face.colours, 9);
    a.sample(10.4, orbital.positions, orbital.colours); b.sample(10.4, orbital.positions, orbital.colours);
    assert.deepEqual(a.positions, b.positions);
    assert.deepEqual(a.colours, b.colours);
  } finally { Math.random = originalRandom; }
});

test('source is exact at release, target is exact at completion, and the settled mapped orbit stays alive', () => {
  const orbital = createOrbital(COUNT), initialTarget = orbital.positions.slice();
  const morph = createFormMorph(face.positions, orbital.positions);
  const positions = morph.positions, colours = morph.colours, mapping = morph.mapping;
  assert.equal(morph.active, false);
  morph.begin(face.positions, face.colours, 10);
  orbital.update(10);
  morph.sample(10, orbital.positions, orbital.colours);
  assert.deepEqual(morph.positions, face.positions);
  assert.deepEqual(morph.colours, face.colours);
  assert.equal(morph.progress, 0);
  assert.equal(morph.active, true);
  morph.sample(10 + 1 / 60, orbital.positions, orbital.colours);
  assert.notDeepEqual(morph.positions, face.positions, 'movement starts on the first frame');
  orbital.update(12);
  morph.sample(12, orbital.positions, orbital.colours);
  checkMapped(morph, orbital);
  assert.equal(morph.progress, 1);
  assert.equal(morph.active, false);
  orbital.update(17);
  morph.sample(17, orbital.positions, orbital.colours);
  checkMapped(morph, orbital);
  assert.notDeepEqual(orbital.positions, initialTarget, 'destinations really move');
  assert.equal(morph.positions, positions);
  assert.equal(morph.colours, colours);
  assert.equal(morph.mapping, mapping);
});

test('all 48,000 particles stay finite and continuously lit through absolute-time seeking', () => {
  const orbital = createOrbital(COUNT), morph = createFormMorph(face.positions, orbital.positions);
  morph.begin(face.positions, face.colours, 0);
  let midpoint;
  for (const time of [0, .2, .7, 1.6, 2.4, 3.1, 6, 1.6]) {
    orbital.update(time);
    morph.sample(time, orbital.positions, orbital.colours);
    for (let i = 0; i < COUNT; i++) {
      const j = i * 3, k = morph.mapping[i] * 3;
      let light = 0;
      for (let c = 0; c < 3; c++) {
        assert.ok(Number.isFinite(morph.positions[j + c]));
        const colour = morph.colours[j + c];
        assert.ok(Number.isFinite(colour));
        assert.ok(colour >= Math.min(face.colours[j + c], orbital.colours[k + c]) - 1e-7);
        assert.ok(colour <= Math.max(face.colours[j + c], orbital.colours[k + c]) + 1e-7);
        light += colour;
      }
      assert.ok(light > 0, 'no blank particle or fade-out replacement');
    }
    if (time === 1.6) {
      if (midpoint) {
        assert.deepEqual(morph.positions, midpoint.positions);
        assert.deepEqual(morph.colours, midpoint.colours);
      } else midpoint = { positions: morph.positions.slice(), colours: morph.colours.slice() };
    }
  }
});

test('restrained paths keep about four fifths close to direct travel and cap the outward flare', () => {
  // Equal constant colour deltas expose the per-particle interpolation weight,
  // so the actual extra travel can be measured without repeating its formula.
  const orbital = createOrbital(COUNT), morph = createFormMorph(face.positions, orbital.positions);
  const sourceColour = new Float32Array(COUNT * 3).fill(.2);
  const targetColour = new Float32Array(COUNT * 3).fill(.8);
  morph.begin(face.positions, sourceColour, 0);
  morph.sample(.3, orbital.positions, targetColour);
  let flaring = 0;
  for (let i = 0; i < COUNT; i++) {
    const j = i * 3, k = morph.mapping[i] * 3;
    const weight = (morph.colours[j] - sourceColour[j]) / (targetColour[k] - sourceColour[j]);
    let distanceSquared = 0;
    for (let c = 0; c < 3; c++) {
      const direct = face.positions[j + c] + (orbital.positions[k + c] - face.positions[j + c]) * weight;
      distanceSquared += (morph.positions[j + c] - direct) ** 2;
    }
    const excursion = Math.sqrt(distanceSquared);
    assert.ok(excursion <= .681, 'no large intermediate explosion');
    if (excursion > .3) flaring++;
    else assert.ok(excursion <= .231, 'main flow stays restrained');
  }
  assert.ok(flaring > COUNT * .15 && flaring < COUNT * .25, `${flaring} flare particles`);
});

test('interrupting with the current displayed buffers is continuous and snapshots the source', () => {
  const orbital = createOrbital(COUNT), morph = createFormMorph(face.positions, orbital.positions);
  morph.begin(face.positions, face.colours, 0);
  orbital.update(1.2); morph.sample(1.2, orbital.positions, orbital.colours);
  const interruptedPositions = morph.positions.slice(), interruptedColours = morph.colours.slice();
  morph.begin(morph.positions, morph.colours, 1.2);
  orbital.update(5); morph.sample(1.2, orbital.positions, orbital.colours);
  assert.deepEqual(morph.positions, interruptedPositions);
  assert.deepEqual(morph.colours, interruptedColours);
  morph.sample(2, orbital.positions, orbital.colours);
  morph.sample(1.2, orbital.positions, orbital.colours);
  assert.deepEqual(morph.positions, interruptedPositions, 'later samples do not mutate the source snapshot');
  assert.deepEqual(morph.colours, interruptedColours);
});

test('reduced motion has a short direct interpolation with no delay or flare', () => {
  const orbital = createOrbital(COUNT, true);
  const morph = createFormMorph(face.positions, orbital.positions, { reduce: true });
  morph.begin(face.positions, face.colours, 0);
  morph.sample(.21, orbital.positions, orbital.colours);
  for (let i = 0; i < COUNT; i++) {
    const j = i * 3, k = morph.mapping[i] * 3;
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(morph.positions[j + c] - (face.positions[j + c] + orbital.positions[k + c]) * .5) < 3e-7);
      assert.ok(Math.abs(morph.colours[j + c] - (face.colours[j + c] + orbital.colours[k + c]) * .5) < 1e-7);
    }
  }
  morph.sample(.42, orbital.positions, orbital.colours);
  assert.equal(morph.active, false);
  checkMapped(morph, orbital);
});

test('empty pools and coincident templates are valid; malformed pools are rejected', () => {
  const empty = new Float32Array();
  const morph = createFormMorph(empty, empty);
  morph.begin(empty, empty, 0).sample(4, empty, empty);
  assert.equal(morph.positions.length, 0);
  assert.equal(morph.active, false);
  const point = new Float32Array([0, 0, 0]);
  const single = createFormMorph(point, point);
  single.begin(point, point, 0).sample(1.6, point, point);
  assert.ok(single.positions.every(Number.isFinite));
  assert.throws(() => createFormMorph(new Float32Array(2), empty), RangeError);
  assert.throws(() => createFormMorph(point, empty), RangeError);
  assert.throws(() => createFormMorph(point, new Float32Array([NaN, 0, 0])), RangeError);
  for (const duration of [0, -1, NaN, Infinity]) assert.throws(() => createFormMorph(point, point, { duration }), RangeError);
});


test('reverse returns each particle to its original face identity and recaptures an interrupted forward move', () => {
  const orbital = createOrbital(COUNT), morph = createFormMorph(face.positions, orbital.positions);
  morph.begin(face.positions, face.colours, 0);
  orbital.update(1.1); morph.sample(1.1, orbital.positions, orbital.colours);
  const currentPositions = morph.positions.slice(), currentColours = morph.colours.slice();
  morph.begin(morph.positions, morph.colours, 1.1, { reverse: true });
  morph.sample(1.1, face.positions, face.colours);
  assert.deepEqual(morph.positions, currentPositions);
  assert.deepEqual(morph.colours, currentColours);
  morph.sample(4.4, face.positions, face.colours);
  assert.deepEqual(morph.positions, face.positions, 'face targets use original indices');
  assert.deepEqual(morph.colours, face.colours);
  assert.equal(morph.active, false);
  const movedFace = new Float32Array(face.positions);
  for (let j = 0; j < movedFace.length; j += 3) movedFace[j] += .07;
  morph.sample(5, movedFace, face.colours);
  assert.deepEqual(morph.positions, movedFace, 'completed reverse keeps following live face targets');
  morph.begin(morph.positions, morph.colours, 5);
  morph.sample(5, orbital.positions, orbital.colours);
  assert.deepEqual(morph.positions, movedFace);
  morph.sample(8.3, orbital.positions, orbital.colours);
  checkMapped(morph, orbital);
});


test('gathering moves immediately, varies particle arrivals and resolves most travel before the settling tail', () => {
  const orbital = createOrbital(COUNT), morph = createFormMorph(face.positions, orbital.positions);
  const dark = new Float32Array(COUNT * 3), light = new Float32Array(COUNT * 3).fill(1);
  morph.begin(face.positions, dark, 0);
  const weightsAt = time => {
    morph.sample(time, orbital.positions, light);
    return Array.from({ length: COUNT }, (_, i) => morph.colours[i * 3]).sort((a, b) => a - b);
  };
  const first = weightsAt(1 / 60);
  assert.ok(first[0] > .01, 'every particle begins without a release hold');
  const rush = weightsAt(.5);
  assert.ok(rush[COUNT / 2] > .6, 'most travel happens early');
  assert.ok(rush[COUNT * .9] - rush[COUNT * .1] > .1, 'grains arrive at visibly different speeds');
  const oneSecond = weightsAt(1);
  assert.ok(oneSecond[COUNT / 2] > .9, 'typical particle has mostly arrived in one second');
  assert.ok(morph.blend > .9, 'framing and appearance do not lag behind the particles');
  const readable = weightsAt(1.4);
  assert.ok(readable[0] > .95 && readable[COUNT / 2] > .98, 'form resolves before the last settling grains');
  assert.equal(morph.active, true, 'soft tail remains after the main gathering');
  weightsAt(2);
  assert.equal(morph.active, false);
  assert.equal(morph.blend, 1);
});


test('reduced motion bypasses centre gathering for a short direct move', () => {
  const orbital = createOrbital(COUNT, true);
  const direct = createFormMorph(face.positions, orbital.positions, { reduce: true });
  const gather = createFormMorph(face.positions, orbital.positions, { reduce: true });
  direct.begin(face.positions, face.colours, 0);
  gather.begin(face.positions, face.colours, 0, { gather: true });
  for (const time of [0, .21, .42]) {
    direct.sample(time, orbital.positions, orbital.colours);
    gather.sample(time, orbital.positions, orbital.colours);
    assert.deepEqual(gather.positions, direct.positions);
    assert.deepEqual(gather.colours, direct.colours);
  }
});


test('electric release leaves gathering and settling exact, with a brief sparse blue-white expansion', () => {
  const orbit = createOrbital(COUNT);
  const ordinary = createFormMorph(face.positions, orbit.positions);
  const electric = createFormMorph(face.positions, orbit.positions);
  ordinary.begin(face.positions, face.colours, 0, { gather: true });
  electric.begin(face.positions, face.colours, 0, { gather: true, electric: true });
  for (const time of [0, .3, .9, .96, 1.64, 1.8, 2, 6]) {
    orbit.update(time);
    ordinary.sample(time, orbit.positions, orbit.colours);
    electric.sample(time, orbit.positions, orbit.colours);
    assert.deepEqual(electric.positions, ordinary.positions, `original path outside the discharge at ${time}s`);
    assert.deepEqual(electric.colours, ordinary.colours, `original light outside the discharge at ${time}s`);
  }
  orbit.update(1.3);
  ordinary.sample(1.3, orbit.positions, orbit.colours);
  electric.sample(1.3, orbit.positions, orbit.colours);
  let lit = 0, redGain = 0, blueGain = 0, originalRadius = 0, dischargeRadius = 0;
  for (let i = 0; i < COUNT; i++) {
    const j = i * 3;
    const red = electric.colours[j] - ordinary.colours[j];
    const blue = electric.colours[j + 2] - ordinary.colours[j + 2];
    if (blue > .01) {
      lit++;
      redGain += red; blueGain += blue;
    }
    for (let c = 0; c < 3; c++) {
      originalRadius += ordinary.positions[j + c] ** 2;
      dischargeRadius += electric.positions[j + c] ** 2;
      assert.ok(electric.colours[j + c] >= 0 && electric.colours[j + c] <= .980001);
    }
  }
  assert.ok(lit > COUNT * .04 && lit < COUNT * .08, `${lit} bright grains keep the flash local`);
  assert.ok(blueGain > redGain * 1.3, 'the added light is predominantly cool, allowing saturated grains');
  assert.ok(dischargeRadius > originalRadius * 1.3, 'outward formation has a visible extra kick');
});

test('electric release is opt-in and bypassed for direct, reverse and reduced motion', () => {
  const source = facePool(4000), orbit = createOrbital(4000);
  for (const [reduce, options] of [
    [false, {}], [false, { reverse: true, gather: true }], [true, { gather: true }]
  ]) {
    const ordinary = createFormMorph(source.positions, orbit.positions, { reduce });
    const electric = createFormMorph(source.positions, orbit.positions, { reduce });
    ordinary.begin(source.positions, source.colours, 0, options);
    electric.begin(source.positions, source.colours, 0, { ...options, electric: true });
    for (const time of [0, .21, .3, .42, 1.3, 2]) {
      ordinary.sample(time, orbit.positions, orbit.colours);
      electric.sample(time, orbit.positions, orbit.colours);
      assert.deepEqual(electric.positions, ordinary.positions);
      assert.deepEqual(electric.colours, ordinary.colours);
    }
  }
});

test('48K electric jellyfish release stays bounded, deterministic and live without replacing buffers', () => {
  const jelly = createJellyfish(COUNT), motion = createJellyMotion(), orbit = createOrbital(COUNT);
  jelly.update(8); motion.apply(jelly.positions, 8, 16 / 9);
  const morph = createFormMorph(face.positions, orbit.positions);
  const positions = morph.positions, colours = morph.colours, mapping = morph.mapping;
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Discharge used global RNG.'); };
  try {
    morph.begin(jelly.positions, jelly.colours, 0, { gather: true, electric: true });
    let peak;
    for (const time of [.9, .97, 1.05, 1.2, 1.3, 1.45, 1.6, 1.64, 2, 5, 1.3]) {
      orbit.update(time); morph.sample(time, orbit.positions, orbit.colours);
      for (let j = 0; j < positions.length; j += 3) {
        assert.ok(Number.isFinite(positions[j]) && Number.isFinite(positions[j + 1]) && Number.isFinite(positions[j + 2]));
        assert.ok(Math.hypot(positions[j], positions[j + 1], positions[j + 2]) <= orbit.bounds.radius,
          'gathered release stays inside the existing atom framing');
        for (let c = 0; c < 3; c++) assert.ok(Number.isFinite(colours[j + c]) && colours[j + c] >= 0 && colours[j + c] <= .980001);
      }
      if (time >= 2) checkMapped(morph, orbit);
      if (time === 1.3) {
        if (peak) {
          assert.deepEqual(positions, peak.positions, 'absolute-time seek returns to the same discharge');
          assert.deepEqual(colours, peak.colours);
        } else peak = { positions: positions.slice(), colours: colours.slice() };
      }
    }
  } finally { Math.random = originalRandom; }
  assert.equal(morph.positions, positions);
  assert.equal(morph.colours, colours);
  assert.equal(morph.mapping, mapping);
});

test('interrupting a discharge preserves the visible frame and the next begin clears its effect', () => {
  const source = facePool(4000), orbit = createOrbital(4000);
  const morph = createFormMorph(source.positions, orbit.positions);
  morph.begin(source.positions, source.colours, 0, { gather: true, electric: true });
  morph.sample(1.3, orbit.positions, orbit.colours);
  const before = { positions: morph.positions.slice(), colours: morph.colours.slice() };
  morph.begin(morph.positions, morph.colours, 1.3, { reverse: true });
  morph.sample(1.3, source.positions, source.colours);
  assert.deepEqual(morph.positions, before.positions);
  assert.deepEqual(morph.colours, before.colours);
  morph.sample(3.3, source.positions, source.colours);
  assert.deepEqual(morph.positions, source.positions);
  assert.deepEqual(morph.colours, source.colours);
  const ordinary = createFormMorph(source.positions, orbit.positions);
  morph.begin(source.positions, source.colours, 10, { gather: true });
  ordinary.begin(source.positions, source.colours, 10, { gather: true });
  morph.sample(11.3, orbit.positions, orbit.colours);
  ordinary.sample(11.3, orbit.positions, orbit.colours);
  assert.deepEqual(morph.positions, ordinary.positions, 'previous electric opt-in cannot leak into another move');
  assert.deepEqual(morph.colours, ordinary.colours);
});
