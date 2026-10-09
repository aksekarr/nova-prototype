import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/nebula-energy.js', import.meta.url), 'utf8');
const { createNebulaEnergy, NEBULA_ENERGY_SLOTS, NEBULA_ENERGY_MAIN_SEGMENTS,
  NEBULA_ENERGY_BRANCH_SEGMENTS, NEBULA_ENERGY_SEGMENTS_PER_SLOT } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

// Dense arms plus deliberately excluded centre and remote halo populations.
function fixture(count = 32000) {
  const positions = new Float32Array(count * 3), phases = new Float32Array(count);
  const cy = Math.cos(0.55), sy = Math.sin(0.55);
  for (let i = 0; i < count; i++) {
    const radius = i % 10 === 0 ? 0.2 + (i % 83) / 83 * 1.6
      : i % 10 === 1 ? 12 + (i % 61) / 61 * 8 : 3 + (i % 997) / 997 * 5.8;
    const angle = i % 3 * Math.PI * 2 / 3 + radius * 0.42 + Math.sin(i * 2.399) * 0.27;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius * 0.7;
    const y = Math.sin(i * 0.731) * 0.53, j = i * 3;
    positions[j] = x; positions[j + 1] = y * cy - z * sy; positions[j + 2] = y * sy + z * cy;
    phases[i] = (i * 2.39996) % (Math.PI * 2);
  }
  return { positions, phases };
}
const base = fixture();
const max = values => values.reduce((value, next) => Math.max(value, next), 0);
const energyAt = (energy, time, positions = base.positions, amount = 1) => energy.update(time, positions, amount);
function firstLitTime(energy) {
  for (let time = 0; time < 20; time += 0.01) {
    energyAt(energy, time);
    if (max(energy.strengths) > 0.95) return time;
  }
  assert.fail('an arm population must produce a visible event');
}
function snapshot(energy) {
  return [energy.positions.slice(), energy.strengths.slice(), energy.glowPositions.slice(), energy.glowStrengths.slice()];
}
function originalIndex(x, y, z) {
  for (let j = 0; j < base.positions.length; j += 3) {
    if (base.positions[j] === x && base.positions[j + 1] === y && base.positions[j + 2] === z) return j / 3;
  }
  return -1;
}

test('two fixed geometry pools reuse buffers and never modify foundation, phases or displayed particles', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  assert.equal(energy.positions.length, NEBULA_ENERGY_SLOTS * NEBULA_ENERGY_SEGMENTS_PER_SLOT * 2 * 3);
  assert.equal(energy.strengths.length, NEBULA_ENERGY_SLOTS * NEBULA_ENERGY_SEGMENTS_PER_SLOT * 2);
  assert.equal(energy.glowPositions.length, 6);
  assert.equal(energy.glowStrengths.length, 2);
  const buffers = [energy.positions, energy.strengths, energy.glowPositions, energy.glowStrengths];
  const beforePositions = base.positions.slice(), beforePhases = base.phases.slice();
  const displayed = base.positions.slice(), beforeDisplayed = displayed.slice();
  for (const time of [0, 3, 12, 24, 41, 10000, 2.8]) {
    assert.equal(energy.update(time, displayed), energy);
    assert.deepEqual([energy.positions, energy.strengths, energy.glowPositions, energy.glowStrengths], buffers);
    buffers.forEach((buffer, index) => assert.equal(buffer,
      [energy.positions, energy.strengths, energy.glowPositions, energy.glowStrengths][index]));
  }
  assert.deepEqual(base.positions, beforePositions);
  assert.deepEqual(base.phases, beforePhases);
  assert.deepEqual(displayed, beforeDisplayed);
});

test('absolute-time seeking is deterministic regardless of prior updates, including dark intervals', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  const other = createNebulaEnergy(base.positions, base.phases);
  const active = firstLitTime(energy);
  for (const time of [active, 0, 53.3, 12.9, active, 100003.7, 19.8, 33.2]) {
    energyAt(energy, time);
    energyAt(other, 7.2);
    energyAt(other, time);
    assert.deepEqual(snapshot(energy), snapshot(other), `deterministic at ${time}`);
  }
});

test('events are sparse, staggered, smooth on arrival and followed by a sustained fade', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  const starts = [], durations = [], onset = [], ends = [];
  let previouslyLit = false, start = 0, previousGlow = 0, lastStrong = 0;
  const dt = 0.01;
  for (let step = 0; step < 120 / dt; step++) {
    const time = step * dt;
    energyAt(energy, time);
    const glow = max(energy.glowStrengths), lit = glow > 0;
    assert.ok(energy.glowStrengths.filter(value => value > 0).length <= 1, 'the two events never crowd one another');
    if (lit && !previouslyLit) { starts.push(time); start = time; onset.push(glow); }
    if (max(energy.strengths) > 0.99) lastStrong = time;
    if (!lit && previouslyLit) { durations.push(time - start); ends.push(time - lastStrong); }
    assert.ok(Math.abs(glow - previousGlow) < 0.17, 'glow rises and falls without a discontinuity');
    previousGlow = glow; previouslyLit = lit;
  }
  assert.equal(starts.length, 12, 'two events per twenty seconds');
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 8.4 && starts[i] - starts[i - 1] <= 11.6);
  assert.ok(onset.every(value => value < 0.001), 'anticipation begins gently');
  assert.ok(durations.every(value => value > 1.6 && value < 2.1));
  assert.ok(ends.every(value => value > 0.8 && value < 1.5), 'crackles leave a visible fading afterglow');
});

test('main endpoints and branch tips attach to foundation particles outside the nucleus and halo', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  const time = firstLitTime(energy);
  energyAt(energy, time);
  const slot = energy.glowStrengths.findIndex(value => value > 0), firstVertex = slot * NEBULA_ENERGY_SEGMENTS_PER_SLOT * 2;
  const vertices = [firstVertex, firstVertex + NEBULA_ENERGY_MAIN_SEGMENTS * 2 - 1,
    firstVertex + (NEBULA_ENERGY_MAIN_SEGMENTS + NEBULA_ENERGY_BRANCH_SEGMENTS) * 2 - 1,
    firstVertex + NEBULA_ENERGY_SEGMENTS_PER_SLOT * 2 - 1];
  for (const vertex of vertices) {
    const j = vertex * 3, x = energy.positions[j], y = energy.positions[j + 1], z = energy.positions[j + 2];
    assert.ok(originalIndex(x, y, z) >= 0, 'each terminal is an original particle');
    const radius = Math.hypot(x, (-y * Math.sin(0.55) + z * Math.cos(0.55)) / 0.7);
    assert.ok(radius >= 3.09999 && radius <= 8.50001);
  }
});

test('paths and glow follow rigid translation and rotation of displayed particle anchors', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  const time = firstLitTime(energy);
  const before = snapshot(energy), transformed = base.positions.slice();
  const cosine = Math.cos(0.71), sine = Math.sin(0.71);
  for (let j = 0; j < transformed.length; j += 3) {
    transformed[j] = base.positions[j] * cosine - base.positions[j + 2] * sine + 4;
    transformed[j + 1] = base.positions[j + 1] - 1.7;
    transformed[j + 2] = base.positions[j] * sine + base.positions[j + 2] * cosine + 0.8;
  }
  energyAt(energy, time, transformed);
  for (let vertex = 0; vertex < energy.strengths.length; vertex++) {
    if (energy.strengths[vertex] === 0) continue;
    const j = vertex * 3, x = before[0][j], y = before[0][j + 1], z = before[0][j + 2];
    assert.ok(Math.abs(energy.positions[j] - (x * cosine - z * sine + 4)) < 0.000003);
    assert.ok(Math.abs(energy.positions[j + 1] - (y - 1.7)) < 0.000003);
    assert.ok(Math.abs(energy.positions[j + 2] - (x * sine + z * cosine + 0.8)) < 0.000003);
  }
  for (let slot = 0; slot < NEBULA_ENERGY_SLOTS; slot++) {
    if (!energy.glowStrengths[slot]) continue;
    const j = slot * 3, x = before[2][j], y = before[2][j + 1], z = before[2][j + 2];
    assert.ok(Math.abs(energy.glowPositions[j] - (x * cosine - z * sine + 4)) < 0.000003);
    assert.ok(Math.abs(energy.glowPositions[j + 1] - (y - 1.7)) < 0.000003);
    assert.ok(Math.abs(energy.glowPositions[j + 2] - (x * sine + z * cosine + 0.8)) < 0.000003);
  }
  assert.deepEqual(energy.strengths, before[1]);
});

test('arc geometry remains finite, short and outside the hot nucleus across the full event sequence', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  let activeCount = 0;
  for (let time = 0; time < 640; time += 0.1) {
    energyAt(energy, time);
    for (const buffer of [energy.positions, energy.strengths, energy.glowPositions, energy.glowStrengths]) {
      assert.ok(buffer.every(Number.isFinite));
    }
    for (let slot = 0; slot < NEBULA_ENERGY_SLOTS; slot++) {
      if (!energy.glowStrengths[slot]) continue;
      activeCount++;
      let length = 0;
      const offset = slot * NEBULA_ENERGY_SEGMENTS_PER_SLOT * 6;
      for (let segment = 0; segment < NEBULA_ENERGY_MAIN_SEGMENTS; segment++) {
        const j = offset + segment * 6;
        length += Math.hypot(energy.positions[j + 3] - energy.positions[j], energy.positions[j + 4] - energy.positions[j + 1], energy.positions[j + 5] - energy.positions[j + 2]);
        const x = energy.positions[j], y = energy.positions[j + 1], z = energy.positions[j + 2];
        assert.ok(Math.hypot(x, (-y * Math.sin(0.55) + z * Math.cos(0.55)) / 0.7) > 2.5);
      }
      assert.ok(length >= 1.5 && length < 3.5, `short internal path: ${length}`);
    }
  }
  assert.ok(activeCount > 100, 'audit includes active geometry, not just dark buffers');
});

test('amount scales illumination and disabling or reducing motion clears an already active event', () => {
  const energy = createNebulaEnergy(base.positions, base.phases);
  const reduced = createNebulaEnergy(base.positions, base.phases, { reduce: true });
  const time = firstLitTime(energy), full = snapshot(energy);
  energyAt(energy, time, base.positions, 0.25);
  assert.deepEqual(energy.positions, full[0]);
  for (let i = 0; i < energy.strengths.length; i++) assert.ok(Math.abs(energy.strengths[i] - full[1][i] * 0.25) < 0.0000001);
  for (const amount of [0, -1, NaN, Infinity]) {
    energyAt(energy, time, base.positions, amount);
    assert.equal(max(energy.strengths), 0);
    assert.equal(max(energy.glowStrengths), 0);
  }
  for (const t of [time, 12, 24, 200]) {
    energyAt(reduced, t);
    assert.equal(max(reduced.strengths), 0);
    assert.equal(max(reduced.glowStrengths), 0);
  }
});

test('empty or unsuitable populations, bad clocks and invalid displayed anchors stay finite and dark', () => {
  for (const positions of [new Float32Array(), new Float32Array(90), new Float32Array([NaN, Infinity, 0])]) {
    const energy = createNebulaEnergy(positions, new Float32Array());
    energy.update(3, positions);
    assert.equal(max(energy.strengths), 0);
    assert.equal(max(energy.glowStrengths), 0);
    assert.ok(energy.positions.every(Number.isFinite));
  }
  const energy = createNebulaEnergy(base.positions, base.phases), time = firstLitTime(energy);
  for (const badTime of [NaN, Infinity, -2]) {
    energyAt(energy, badTime);
    assert.equal(max(energy.glowStrengths), 0);
  }
  energy.update(time, new Float32Array());
  assert.equal(max(energy.glowStrengths), 0);
  energy.update(time, new Float32Array(base.positions.length).fill(NaN));
  assert.equal(max(energy.glowStrengths), 0);
  assert.ok(energy.positions.every(Number.isFinite));
});
