// A small overlay attached to the existing nebula population. Construction is
// deterministic; update reuses every buffer and never writes into its inputs.
export const NEBULA_ENERGY_SLOTS = 2;
export const NEBULA_ENERGY_MAIN_SEGMENTS = 24;
export const NEBULA_ENERGY_BRANCH_SEGMENTS = 8;
export const NEBULA_ENERGY_SEGMENTS_PER_SLOT = 40;
export const NEBULA_ENERGY_CYCLE = 20;

const TEMPLATE_COUNT = 32;
const VERTICES_PER_SLOT = NEBULA_ENERGY_SEGMENTS_PER_SLOT * 2;
const MAIN_POINTS = NEBULA_ENERGY_MAIN_SEGMENTS + 1;
const TILT_COS = Math.cos(0.55), TILT_SIN = Math.sin(0.55);
const ANTICIPATION = 0.34, RISE = 0.10, CRACKLE = 0.28;

function seeded(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function smooth(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

export function createNebulaEnergy(nebulaPositions, phases, { reduce = false } = {}) {
  const count = Math.floor((nebulaPositions?.length || 0) / 3);
  const positions = new Float32Array(NEBULA_ENERGY_SLOTS * VERTICES_PER_SLOT * 3);
  const strengths = new Float32Array(NEBULA_ENERGY_SLOTS * VERTICES_PER_SLOT);
  const glowPositions = new Float32Array(NEBULA_ENERGY_SLOTS * 3);
  const glowStrengths = new Float32Array(NEBULA_ENERGY_SLOTS);
  const mainPath = new Float32Array(MAIN_POINTS * 3);
  const candidates = [];
  const templates = [];
  const random = seeded(0x5e71e9);

  for (let i = 0; i < count; i++) {
    const j = i * 3, x = nebulaPositions[j], y = nebulaPositions[j + 1], z = nebulaPositions[j + 2];
    const diskY = y * TILT_COS + z * TILT_SIN;
    const diskZ = (-y * TILT_SIN + z * TILT_COS) / 0.7;
    const radius = Math.hypot(x, diskZ);
    const phase = Math.atan2(diskZ, x) - radius * 0.42;
    const armDistance = Math.abs(Math.atan2(Math.sin(phase * 3), Math.cos(phase * 3)) / 3);
    // Keep events within the arms, away from the hot nucleus and distant halo.
    if (Number.isFinite(radius) && radius >= 3.1 && radius <= 8.5
        && Math.abs(diskY) <= 0.65 && armDistance <= 0.35) candidates.push(i);
  }

  function closest(tx, ty, tz, ax, ay, az, minDistance, maxDistance, skipA, skipB) {
    let best = -1, bestScore = Infinity;
    for (const index of candidates) {
      if (index === skipA || index === skipB) continue;
      const j = index * 3, x = nebulaPositions[j], y = nebulaPositions[j + 1], z = nebulaPositions[j + 2];
      const distance = Math.hypot(x - ax, y - ay, z - az);
      if (distance < minDistance || distance > maxDistance) continue;
      const score = (x - tx) ** 2 + (y - ty) ** 2 + (z - tz) ** 2;
      if (score < bestScore) { best = index; bestScore = score; }
    }
    return best;
  }

  for (let attempt = 0; attempt < TEMPLATE_COUNT * 3 && templates.length < TEMPLATE_COUNT; attempt++) {
    if (!candidates.length) break;
    const a = candidates[Math.floor(random() * candidates.length)], ai = a * 3;
    const ax = nebulaPositions[ai], ay = nebulaPositions[ai + 1], az = nebulaPositions[ai + 2];
    const diskZ = (-ay * TILT_SIN + az * TILT_COS) / 0.7;
    const radius = Math.hypot(ax, diskZ), angle = Math.atan2(diskZ, ax);
    const direction = radius > 6.6 ? -1 : 1;
    const tangentX = Math.cos(angle) - radius * 0.42 * Math.sin(angle);
    const tangentZ = (Math.sin(angle) + radius * 0.42 * Math.cos(angle)) * 0.7;
    const tangentLength = Math.hypot(tangentX, tangentZ);
    const span = 1.9 + random() * 0.7;
    const b = closest(ax + direction * span * tangentX / tangentLength,
      ay - direction * span * tangentZ * TILT_SIN / tangentLength,
      az + direction * span * tangentZ * TILT_COS / tangentLength,
      ax, ay, az, 1.55, 2.75, a, -1);
    if (b < 0) continue;
    const bi = b * 3, dx = nebulaPositions[bi] - ax, dy = nebulaPositions[bi + 1] - ay, dz = nebulaPositions[bi + 2] - az;
    // A side vector in the galaxy disk gives each branch a distinct root/tip.
    let sx = TILT_COS * dz - TILT_SIN * dy, sy = TILT_SIN * dx, sz = -TILT_COS * dx;
    const sideLength = Math.hypot(sx, sy, sz);
    if (sideLength < 0.01) continue;
    sx /= sideLength; sy /= sideLength; sz /= sideLength;
    const cx = ax + dx * 7 / 24, cy = ay + dy * 7 / 24, cz = az + dz * 7 / 24;
    const ex = ax + dx * 17 / 24, ey = ay + dy * 17 / 24, ez = az + dz * 17 / 24;
    const c = closest(cx + sx * 0.8, cy + sy * 0.8, cz + sz * 0.8, cx, cy, cz, 0.5, 1.15, a, b);
    const d = closest(ex - sx * 0.7, ey - sy * 0.7, ez - sz * 0.7, ex, ey, ez, 0.45, 1.1, a, b);
    if (c < 0 || d < 0) continue;
    const ci = c * 3;
    const vx = nebulaPositions[ci] - ax, vy = nebulaPositions[ci + 1] - ay, vz = nebulaPositions[ci + 2] - az;
    const crossLength = Math.hypot(dy * vz - dz * vy, dz * vx - dx * vz, dx * vy - dy * vx);
    if (crossLength < 0.35) continue;
    // Both endpoints are outside r=3.1; reject a chord that cuts the nucleus.
    const endZ = (-nebulaPositions[bi + 1] * TILT_SIN + nebulaPositions[bi + 2] * TILT_COS) / 0.7;
    const diskDX = dx, diskDZ = endZ - diskZ;
    const nearest = Math.max(0, Math.min(1, -(ax * diskDX + diskZ * diskDZ) / (diskDX * diskDX + diskDZ * diskDZ)));
    if (Math.hypot(ax + diskDX * nearest, diskZ + diskDZ * nearest) < 2.8) continue;
    const offsets = new Float32Array(MAIN_POINTS * 2);
    const branchOffsets = new Float32Array((NEBULA_ENERGY_BRANCH_SEGMENTS + 1) * 2);
    const suppliedPhase = Number.isFinite(phases?.[a]) ? phases[a] : 0;
    const bendPhase = suppliedPhase + random() * Math.PI * 2;
    for (let i = 1; i < NEBULA_ENERGY_MAIN_SEGMENTS; i++) {
      const t = i / NEBULA_ENERGY_MAIN_SEGMENTS, envelope = Math.sin(t * Math.PI);
      offsets[i * 2] = envelope * (Math.sin(t * Math.PI * 3 + bendPhase) * 0.038 + (random() - 0.5) * 0.023);
      offsets[i * 2 + 1] = envelope * (Math.sin(t * Math.PI * 2 + bendPhase) * 0.013 + (random() - 0.5) * 0.018);
    }
    for (let i = 1; i < NEBULA_ENERGY_BRANCH_SEGMENTS; i++) {
      const envelope = Math.sin(i / NEBULA_ENERGY_BRANCH_SEGMENTS * Math.PI);
      branchOffsets[i * 2] = (random() - 0.5) * 0.1 * envelope;
      branchOffsets[i * 2 + 1] = (random() - 0.5) * 0.08 * envelope;
    }
    templates.push({ a, b, c, d, offsets, branchOffsets, jitter: (random() - 0.5) * 1.5,
      fade: 0.9 + random() * 0.45 });
  }

  function writeVertex(vertex, x, y, z, strength) {
    const j = vertex * 3;
    positions[j] = x; positions[j + 1] = y; positions[j + 2] = z;
    strengths[vertex] = strength;
  }

  function update(clock, displayedPositions = nebulaPositions, amount = 1) {
    positions.fill(0); strengths.fill(0); glowPositions.fill(0); glowStrengths.fill(0);
    const gain = Number.isFinite(amount) ? Math.max(0, Math.min(1, amount)) : 0;
    if (reduce || gain === 0 || !templates.length || !Number.isFinite(clock) || clock < 0
        || !displayedPositions || displayedPositions.length < count * 3) return api;
    const cycle = Math.floor(clock / NEBULA_ENERGY_CYCLE), withinCycle = clock - cycle * NEBULA_ENERGY_CYCLE;
    for (let slot = 0; slot < NEBULA_ENERGY_SLOTS; slot++) {
      const template = templates[((cycle % templates.length) * 13 + slot * 17) % templates.length];
      const age = withinCycle - (2.8 + slot * 10 + template.jitter);
      const fadeStart = ANTICIPATION + RISE + CRACKLE;
      if (age <= 0 || age >= fadeStart + template.fade) continue;
      const ai = template.a * 3, bi = template.b * 3, ci = template.c * 3, di = template.d * 3;
      let finite = true;
      for (let c = 0; c < 3; c++) {
        if (!Number.isFinite(displayedPositions[ai + c]) || !Number.isFinite(displayedPositions[bi + c])
            || !Number.isFinite(displayedPositions[ci + c]) || !Number.isFinite(displayedPositions[di + c])) finite = false;
      }
      if (!finite) continue;
      const ax = displayedPositions[ai], ay = displayedPositions[ai + 1], az = displayedPositions[ai + 2];
      const dx = displayedPositions[bi] - ax, dy = displayedPositions[bi + 1] - ay, dz = displayedPositions[bi + 2] - az;
      const length = Math.hypot(dx, dy, dz);
      if (length < 0.001) continue;
      const ux = dx / length, uy = dy / length, uz = dz / length;
      const vx = displayedPositions[ci] - ax, vy = displayedPositions[ci + 1] - ay, vz = displayedPositions[ci + 2] - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const normalLength = Math.hypot(nx, ny, nz);
      if (normalLength < 0.001) continue;
      nx /= normalLength; ny /= normalLength; nz /= normalLength;
      const sx = ny * uz - nz * uy, sy = nz * ux - nx * uz, sz = nx * uy - ny * ux;
      let energy, glow;
      if (age < ANTICIPATION) {
        energy = 0;
        glow = 0.16 * smooth(age / ANTICIPATION);
      } else if (age < ANTICIPATION + RISE) {
        energy = smooth((age - ANTICIPATION) / RISE);
        glow = 0.16 + energy * 0.84;
      } else if (age < fadeStart) {
        const flicker = Math.sin((age - ANTICIPATION - RISE) / CRACKLE * Math.PI * 3);
        energy = 1 - 0.38 * flicker * flicker;
        glow = 1 - 0.2 * flicker * flicker;
      } else {
        energy = 1 - smooth((age - fadeStart) / template.fade);
        glow = energy;
      }
      energy *= gain;
      const glowIndex = slot * 3;
      glowPositions[glowIndex] = ax + dx * 0.5;
      glowPositions[glowIndex + 1] = ay + dy * 0.5;
      glowPositions[glowIndex + 2] = az + dz * 0.5;
      glowStrengths[slot] = glow * gain;

      for (let i = 0; i < MAIN_POINTS; i++) {
        const t = i / NEBULA_ENERGY_MAIN_SEGMENTS, j = i * 3;
        const side = template.offsets[i * 2] * length, normal = template.offsets[i * 2 + 1] * length;
        mainPath[j] = ax + dx * t + sx * side + nx * normal;
        mainPath[j + 1] = ay + dy * t + sy * side + ny * normal;
        mainPath[j + 2] = az + dz * t + sz * side + nz * normal;
      }
      let vertex = slot * VERTICES_PER_SLOT;
      for (let i = 0; i < NEBULA_ENERGY_MAIN_SEGMENTS; i++) {
        const j = i * 3;
        writeVertex(vertex++, mainPath[j], mainPath[j + 1], mainPath[j + 2], energy);
        writeVertex(vertex++, mainPath[j + 3], mainPath[j + 4], mainPath[j + 5], energy);
      }
      for (let branch = 0; branch < 2; branch++) {
        const root = (branch === 0 ? 7 : 17) * 3, tip = branch === 0 ? ci : di;
        const rx = mainPath[root], ry = mainPath[root + 1], rz = mainPath[root + 2];
        const bx = displayedPositions[tip] - rx, by = displayedPositions[tip + 1] - ry, bz = displayedPositions[tip + 2] - rz;
        const branchLength = Math.hypot(bx, by, bz), baseStrength = energy * (branch === 0 ? 0.42 : 0.3);
        let px = rx, py = ry, pz = rz, previousStrength = baseStrength;
        for (let i = 1; i <= NEBULA_ENERGY_BRANCH_SEGMENTS; i++) {
          const t = i / NEBULA_ENERGY_BRANCH_SEGMENTS;
          const side = template.branchOffsets[i * 2] * branchLength;
          const normal = template.branchOffsets[i * 2 + 1] * branchLength;
          const x = rx + bx * t + sx * side + nx * normal;
          const y = ry + by * t + sy * side + ny * normal;
          const z = rz + bz * t + sz * side + nz * normal;
          const nextStrength = baseStrength * (1 - t * 0.55);
          writeVertex(vertex++, px, py, pz, previousStrength);
          writeVertex(vertex++, x, y, z, nextStrength);
          px = x; py = y; pz = z; previousStrength = nextStrength;
        }
      }
    }
    return api;
  }

  const api = { positions, strengths, glowPositions, glowStrengths, update };
  return api;
}
