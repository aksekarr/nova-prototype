import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandingForms } from '../js/landing-forms.js';
import { createOrbital } from '../js/orbital.js';
import { createShapes } from '../js/shapes.js';
import { createJellyfish } from '../js/jellyfish.js';
import { createJellyMotion } from '../js/jelly-motion.js';

function facePool(count) {
  const positions = new Float32Array(count * 3), colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const j = i * 3, a = i * 2.399963229728653, r = Math.sqrt((i + .5) / count);
    positions[j] = Math.cos(a) * r * 1.8;
    positions[j + 1] = Math.sin(a) * r * 2.5;
    positions[j + 2] = .8 * (1 - r);
    colours[j] = .2; colours[j + 1] = .3; colours[j + 2] = .5;
  }
  return { N: count, BASE: positions, positions, colours };
}

function sameParticles(actual, expected) {
  const sort = pool => {
    const triples = [];
    for (let j = 0; j < pool.length; j += 3) triples.push([pool[j], pool[j + 1], pool[j + 2]]);
    triples.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return triples;
  };
  assert.deepEqual(sort(actual), sort(expected));
}

test('normal landing modes do not allocate an idle pool or start a separate transition', () => {
  const forms = createLandingForms({ shapes: facePool(32000) });
  assert.equal(forms.ready, false);
  assert.equal(forms.positions, undefined);
  forms.select('face', 3);
  assert.equal(forms.transitioning, false);
  assert.equal(forms.settledMode, 'face');
  forms.select('nebula', 8);
  assert.equal(forms.active, false);
  assert.equal(forms.ready, false);
});

test('32K face grows into the complete live 48K atom and returns to the exact original identities', () => {
  const face = facePool(32000), before = face.positions.slice();
  const forms = createLandingForms({ shapes: face });
  forms.select('face', 0);
  forms.select('orbit', 4);
  assert.equal(forms.count, 48000);
  assert.equal(forms.transitioning, true, 'pending before the renderer consumes its first frame');
  forms.begin(face.positions, face.colours, 4, 16 / 9);
  forms.sample(4, 16 / 9);
  assert.deepEqual(forms.positions.slice(0, 32000 * 3), face.positions);
  assert.deepEqual(forms.colours.slice(0, 32000 * 3), face.colours);
  assert.ok(forms.colours.subarray(32000 * 3).every(value => value === 0), 'new grains begin dark');
  const positions = forms.positions, colours = forms.colours;
  forms.sample(6, 16 / 9);
  assert.equal(forms.transitioning, false);
  assert.equal(forms.settledMode, 'orbit');
  const orbit = createOrbital(48000); orbit.update(6);
  sameParticles(forms.positions, orbit.positions);
  sameParticles(forms.colours, orbit.colours);
  assert.deepEqual(forms.sizes, createShapes(48000).SIZE, 'study size distribution stays unchanged');
  const atSix = forms.positions.slice();
  forms.sample(8, 16 / 9);
  assert.notDeepEqual(forms.positions, atSix, 'settled atom keeps moving');
  forms.select('face', 8);
  forms.begin(forms.positions, forms.colours, 8, 16 / 9);
  forms.sample(10, 16 / 9, face.positions, face.colours);
  assert.deepEqual(forms.positions.subarray(0, 32000 * 3), face.positions);
  assert.deepEqual(forms.colours.subarray(0, 32000 * 3), face.colours);
  assert.ok(forms.colours.subarray(32000 * 3).every(value => value === 0));
  assert.equal(forms.finish(), true);
  assert.equal(forms.active, false);
  assert.equal(forms.positions, positions);
  assert.equal(forms.colours, colours);
  assert.deepEqual(face.positions, before, 'source generator data is never changed');
});

test('9K landing also gets a full 48K idle pool while explicit larger pools retain their size', () => {
  const forms = createLandingForms({ shapes: facePool(9000) });
  forms.prepare();
  const positions = forms.positions;
  forms.prepare();
  assert.equal(forms.positions, positions, 'preparation is idempotent');
  assert.equal(forms.count, 48000);
  const larger = createLandingForms({ shapes: facePool(64000) });
  assert.equal(larger.count, 64000);
});

test('interrupted atom/jelly/nebula journeys start from the exact previous displayed frame', () => {
  const face = facePool(4000), forms = createLandingForms({ shapes: face, idleCount: 6000 });
  forms.select('orbit', 1); forms.begin(face.positions, face.colours, 1, 1);
  forms.sample(1.4, 1);
  let previousPositions = forms.positions.slice(), previousColours = forms.colours.slice();
  forms.select('jelly', 1.4); forms.begin(forms.positions, forms.colours, 1.4, 1);
  forms.sample(1.4, 1);
  assert.deepEqual(forms.positions, previousPositions);
  assert.deepEqual(forms.colours, previousColours);
  forms.sample(2.3, .6);
  previousPositions = forms.positions.slice(); previousColours = forms.colours.slice();
  forms.select('nebula', 2.3); forms.begin(forms.positions, forms.colours, 2.3, .6);
  forms.sample(2.3, .6, face.positions, face.colours);
  assert.deepEqual(forms.positions, previousPositions);
  assert.deepEqual(forms.colours, previousColours);
  forms.sample(5, .6, face.positions, face.colours);
  assert.deepEqual(forms.positions.subarray(0, face.positions.length), face.positions);
  assert.ok(forms.colours.subarray(face.colours.length).every(value => value === 0));
  assert.equal(forms.settledMode, 'nebula');
  assert.equal(forms.finish(), true);
});

test('settled jelly continues swimming and resize/reversal keep every coordinate finite', () => {
  const face = facePool(4000), forms = createLandingForms({ shapes: face, idleCount: 6000 });
  forms.select('jelly', 0); forms.begin(face.positions, face.colours, 0, 1.7);
  forms.sample(2.5, 1.7);
  assert.equal(forms.settledMode, 'jelly');
  const jelly = createJellyfish(6000), motion = createJellyMotion();
  jelly.update(2.5); motion.apply(jelly.positions, 2.5, 1.7);
  sameParticles(forms.positions, jelly.positions);
  sameParticles(forms.colours, jelly.colours);
  assert.equal(forms.finish(), false, 'idle geometry remains displayed');
  const first = forms.positions.slice();
  forms.sample(12, .4);
  assert.notDeepEqual(forms.positions, first);
  assert.ok(forms.positions.every(Number.isFinite));
  assert.ok(Number.isFinite(forms.cameraDepth(.4, .46)));
  forms.select('orbit', 12); forms.begin(forms.positions, forms.colours, 12, .4);
  forms.sample(15, .4);
  assert.equal(forms.settledMode, 'orbit');
  assert.ok(forms.positions.every(Number.isFinite));
});

test('reduced motion shortens transitions and freezes each settled form', () => {
  const face = facePool(4000), forms = createLandingForms({ shapes: face, reduce: true, idleCount: 4000 });
  for (const [mode, clock] of [['orbit', 1], ['jelly', 10]]) {
    forms.select(mode, clock);
    forms.begin(mode === 'orbit' ? face.positions : forms.positions,
      mode === 'orbit' ? face.colours : forms.colours, clock, 1);
    forms.sample(clock + .43, 1);
    assert.equal(forms.transitioning, false);
    const position = forms.positions.slice(), colour = forms.colours.slice();
    forms.sample(clock + 5, 1);
    assert.deepEqual(forms.positions, position);
    assert.deepEqual(forms.colours, colour);
  }
});

test('unsupported modes fail before changing an active transition', () => {
  const forms = createLandingForms({ shapes: facePool(4000), idleCount: 4000 });
  forms.select('orbit', 0);
  assert.throws(() => forms.select('unknown', 0), RangeError);
  assert.equal(forms.mode, 'orbit');
  assert.equal(forms.transitioning, true);
  assert.throws(() => createLandingForms({ shapes: { N: 0 } }), RangeError);
});


test('jellyfish gathers into the atom centre, keeps every grain and can reverse continuously', () => {
  const face = facePool(4000), forms = createLandingForms({ shapes: face, idleCount: 6000 });
  const radius = positions => {
    let squared = 0;
    for (const value of positions) squared += value * value;
    return Math.sqrt(squared / (positions.length / 3));
  };
  forms.select('face', 0);
  forms.select('jelly', 1); forms.begin(face.positions, face.colours, 1, 1.7);
  forms.sample(4, 1.7);
  const source = forms.positions.slice(), sourceColours = forms.colours.slice();
  forms.select('orbit', 4); forms.begin(forms.positions, forms.colours, 4, 1.7);
  forms.sample(4, 1.7);
  assert.deepEqual(forms.positions, source, 'the inward journey starts on the displayed jellyfish');
  assert.deepEqual(forms.colours, sourceColours);
  forms.sample(4.9, 1.7);
  assert.ok(radius(forms.positions) < radius(source) * .15, 'particles visibly converge near the origin');
  assert.ok(forms.positions.every(Number.isFinite));
  const gathered = forms.positions.slice(), gatheredColours = forms.colours.slice();
  forms.sample(6, 1.7);
  const orbit = createOrbital(6000); orbit.update(6);
  sameParticles(forms.positions, orbit.positions);
  sameParticles(forms.colours, orbit.colours);
  forms.sample(4.9, 1.7);
  forms.select('face', 4.9); forms.begin(forms.positions, forms.colours, 4.9, 1.7);
  forms.sample(4.9, 1.7, face.positions, face.colours);
  assert.deepEqual(forms.positions, gathered);
  assert.deepEqual(forms.colours, gatheredColours);
  forms.sample(7, 1.7, face.positions, face.colours);
  assert.deepEqual(forms.positions.subarray(0, face.positions.length), face.positions);
  assert.ok(forms.colours.subarray(face.colours.length).every(value => value === 0));
  assert.equal(forms.finish(), true);
});
