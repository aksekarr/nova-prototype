import { createMappedFace } from './facewarp.js';
import { createFaceMotion } from './facemotion.js';
import { createFaceHead } from './facehead.js';

export const EYE_SHAPE_KEYS = ['upperLid', 'lowerLid', 'slant', 'browKnit', 'eyeAsym'];
export const EXPR = {
  neutral:  { smile: 0.05, browL: 0, browR: 0, tilt: 0, eye: 1, gx: null, gy: null,
    upperLid: 0, lowerLid: 0, slant: 0, browKnit: 0, eyeAsym: 0 },
  warm:     { smile: 0.55, browL: 0.08, browR: 0.08, tilt: 0, eye: 0.78, gx: null, gy: null,
    upperLid: 0, lowerLid: 0, slant: 0, browKnit: 0, eyeAsym: 0 },
  curious:  { smile: 0.12, browL: 0.34, browR: -0.02, tilt: 0.1, eye: 1.08, gx: null, gy: null,
    upperLid: 0, lowerLid: 0, slant: 0, browKnit: 0, eyeAsym: 0 },
  thinking: { smile: -0.12, browL: -0.08, browR: 0.2, tilt: -0.08, eye: 0.9, gx: -1, gy: 1,
    upperLid: 0, lowerLid: 0, slant: 0, browKnit: 0, eyeAsym: 0 }
};

function lerp(a, b, k) {
  return a + (b - a) * k;
}

export function createFace(shapes, reduce) {
  const cur = { smile: 0.05, browL: 0, browR: 0, tilt: 0, eye: 1,
    upperLid: 0, lowerLid: 0, slant: 0, browKnit: 0, eyeAsym: 0 };
  const eyePoses = Object.fromEntries(Object.entries(EXPR).map(([name, pose]) => [name, { ...pose }]));
  let currentExpression = 'neutral';
  const gaze = { x: 0, y: 0 };
  const fixedGaze = { x: 0, y: 0, mix: 0 };
  let blinkAge = Infinity, blinkV = 1;
  const mappedFace = createMappedFace(shapes, reduce);
  const motion = createFaceMotion(shapes, reduce);
  const head = createFaceHead(reduce);
  const follow = createHeadFollow(shapes, motion.phase);
  // Stage applies head motion after intrinsic particle easing.
  shapes.headDisplay = follow;

  function update(dt, clock, exprName, envelope, shape, speaking = false) {
    const tgt = EXPR[exprName], k = 1 - Math.pow(0.04, dt);
    currentExpression = exprName;
    cur.smile = lerp(cur.smile, tgt.smile, k);
    cur.browL = lerp(cur.browL, tgt.browL, k);
    cur.browR = lerp(cur.browR, tgt.browR, k);
    cur.tilt = lerp(cur.tilt, tgt.tilt, k);
    cur.eye = lerp(cur.eye, tgt.eye, k);
    for (const key of EYE_SHAPE_KEYS) cur[key] = lerp(cur[key], eyePoses[exprName][key], k);

    const pose = head.update(dt, { speaking, envelope });
    // Head gaze is already spring-smoothed; only the expression override needs
    // the existing soft handoff, so normal eyes do not acquire a second lag.
    const gazeRate = 1 - Math.pow(0.002, dt);
    if (tgt.gx !== null) { fixedGaze.x = tgt.gx; fixedGaze.y = tgt.gy; }
    fixedGaze.mix = lerp(fixedGaze.mix, tgt.gx !== null ? 1 : 0, gazeRate);
    gaze.x = lerp(pose.gazeX, fixedGaze.x, fixedGaze.mix);
    gaze.y = lerp(pose.gazeY, fixedGaze.y, fixedGaze.mix);

    blinkAge = pose.blink ? 0 : blinkAge + dt;
    blinkV = blinkAge < 0.16 ? 1 - 0.92 * Math.sin(Math.PI * blinkAge / 0.16) : 1;

    mappedFace.update(clock, cur, gaze, blinkV, envelope, shape);
    motion.update(clock);
    follow.update(dt, pose);
  }

  return { update, applyTuning(tuning) {
    // Sculpted eye values belong to each pose; existing expression, speech,
    // gaze and head controllers retain their original inputs and timing.
    for (const name of Object.keys(eyePoses)) {
      const values = tuning.eyePoses?.[name];
      if (values) for (const key of EYE_SHAPE_KEYS) if (Number.isFinite(values[key])) {
        eyePoses[name][key] = Math.max(key === 'lowerLid' ? 0 : -1, Math.min(1, values[key]));
      }
    }
    const editPose = eyePoses[tuning.eyePose ?? currentExpression];
    if (editPose) for (const key of EYE_SHAPE_KEYS) if (Number.isFinite(tuning[key])) {
      editPose[key] = Math.max(key === 'lowerLid' ? 0 : -1, Math.min(1, tuning[key]));
    }
    mappedFace.applyTuning(tuning);
    motion.applyTuning(tuning);
    head.applyTuning(tuning);
    follow.applyTuning(tuning);
  } };
}

// Pose history belongs to the display pass; intrinsic simulation buffers and
// the shapes generator remain untouched. Every star keeps its own fixed traits.
export function createHeadFollow(shapes, phase = shapes.MOTION.FLOW_PHASE) {
  const { BASE, I, UV, MAP_SCALE, MAPS, MOTION } = shapes;
  const count = BASE.length / 3, coreEnd = I.face[1], filamentEnd = I.filaments[1];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let j = 0; j < coreEnd * 3; j += 3) {
    minX = Math.min(minX, BASE[j]); maxX = Math.max(maxX, BASE[j]);
    minY = Math.min(minY, BASE[j + 1]); maxY = Math.max(maxY, BASE[j + 1]);
    minZ = Math.min(minZ, BASE[j + 2]); maxZ = Math.max(maxZ, BASE[j + 2]);
  }
  const width = maxX - minX, height = maxY - minY, midZ = (minZ + maxZ) * 0.5;
  const nx = (minX + maxX) * 0.5, ny = minY - height * 0.07, nz = minZ - height * 0.04;
  const free = new Float32Array(count), departing = new Uint8Array(count);
  for (const i of MOTION.EDGE_INDEX) departing[i] = 1;
  for (const i of MOTION.DETACH_INDEX) departing[i] = 1;
  const landmarks = MAPS.landmarks;
  const regions = ['L', 'R'].map(side => [
    Math.min(landmarks['eye' + side + '_inner'][0], landmarks['eye' + side + '_outer'][0]) - 0.01,
    Math.max(landmarks['eye' + side + '_inner'][0], landmarks['eye' + side + '_outer'][0]) + 0.01,
    landmarks['eye' + side + '_upperLid'][1] - 0.01,
    landmarks['eye' + side + '_lowerLid'][1] + 0.01
  ]);
  regions.push([landmarks.noseBridge[0] - 0.055, landmarks.noseTip[0] + 0.055,
    landmarks.noseBridge[1] - 0.01, landmarks.noseTip[1] + 0.035]);
  regions.push([landmarks.mouthLeft[0] - 0.015, landmarks.mouthRight[0] + 0.015,
    landmarks.upperLipTop[1] - 0.015, landmarks.lowerLipBottom[1] + 0.015]);
  const individual = new Float32Array(count * 4), shared = new Float32Array(count * 4);
  const traits = new Float32Array(count * 4), attachment = new Float32Array(count);
  const offsets = new Uint16Array(count), blends = new Float32Array(count);
  const random = swarmRandom(0x5e71c4a9), cell = width * 0.075;
  for (let i = 0; i < count; i++) {
    const j = i * 3, k = i * 4;
    const u = i < coreEnd ? UV[i * 2] : BASE[j] / MAP_SCALE + 0.5;
    const v = i < coreEnd ? UV[i * 2 + 1] : 0.5 - BASE[j + 1] / MAP_SCALE;
    let distance = Infinity;
    for (const r of regions) distance = Math.min(distance,
      Math.hypot(Math.max(r[0] - u, 0, u - r[1]), Math.max(r[2] - v, 0, v - r[3])));
    free[i] = swarmSmooth(distance / 0.025);
    individual[k] = random();
    const angle = random() * Math.PI * 2, z = (random() * 2 - 1) * 0.15;
    const norm = Math.sqrt(1 + z * z);
    individual[k + 1] = Math.cos(angle) / norm;
    individual[k + 2] = Math.sin(angle) / norm;
    individual[k + 3] = z / norm;
    const x = BASE[j] / cell, y = BASE[j + 1] / cell, depth = BASE[j + 2] / cell;
    shared[k] = swarmNoise(x, y, depth, 0);
    const dx = swarmNoise(x, y, depth, 1) * 2 - 1;
    const dy = swarmNoise(x, y, depth, 2) * 2 - 1;
    const dz = (swarmNoise(x, y, depth, 3) * 2 - 1) * 0.15;
    const length = Math.hypot(dx, dy, dz) || 1;
    shared[k + 1] = dx / length; shared[k + 2] = dy / length; shared[k + 3] = dz / length;
  }
  const BUCKETS = 32, SAMPLES = 64, STEP = 1 / 120;
  const history = new Float64Array(SAMPLES * 5);
  const previous = new Float64Array(5), current = new Float64Array(5), sample = new Float64Array(5);
  const matrices = new Float64Array(BUCKETS * 12);
  const settings = new Float64Array([1, 0.5, 0, 2.5]), targets = new Float64Array(settings);
  let initialized = false, cursor = 0, time = 0, sampledAt = 0, nextSample = STEP;
  let displayAmount = 0, lastCoherence = -1, angularSpeed = 0;
  const diagnostics = { angularSpeed: 0, deviationScale: 0 };

  function update(dt, pose) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    current[0] = pose.yaw; current[1] = pose.pitch; current[2] = pose.roll;
    current[3] = pose.x; current[4] = pose.y;
    if (!initialized) {
      for (let i = 0; i < SAMPLES; i++) history.set(current, i * 5);
      previous.set(current); initialized = true;
    }
    if (dt > 0) angularSpeed = Math.hypot(current[0] - previous[0], current[1] - previous[1],
      current[2] - previous[2]) / dt;
    if (angularSpeed < 1e-9) angularSpeed = 0;
    diagnostics.angularSpeed = angularSpeed;
    const end = time + dt;
    while (nextSample <= end + 1e-9) {
      const mix = dt > 0 ? Math.min(1, (nextSample - time) / dt) : 1;
      cursor = (cursor + 1) % SAMPLES;
      for (let c = 0; c < 5; c++) history[cursor * 5 + c] = lerp(previous[c], current[c], mix);
      sampledAt = nextSample; nextSample += STEP;
    }
    time = end; previous.set(current);
    const ease = 1 - Math.exp(-dt / 0.12);
    for (let c = 0; c < settings.length; c++) {
      settings[c] = lerp(settings[c], targets[c], ease);
      if (Math.abs(settings[c] - targets[c]) < 1e-7) settings[c] = targets[c];
    }
    if (lastCoherence !== settings[1]) {
      mixSwarmTraits(individual, shared, traits, settings[1] * 0.9);
      lastCoherence = settings[1];
    }
  }

  function writeMatrix(offset, amount) {
    const deg = Math.PI / 180 * amount;
    const sx = Math.sin(sample[1] * deg), cx = Math.cos(sample[1] * deg);
    const sy = Math.sin(sample[0] * deg), cy = Math.cos(sample[0] * deg);
    const sz = Math.sin(sample[2] * deg), cz = Math.cos(sample[2] * deg);
    const m = matrices, k = offset, depth = settings[3];
    // Store only R-I. Virtual depth contributes to rotational displacement,
    // then is subtracted again: neutral geometry never inflates or changes z.
    m[k] = cz * cy - 1; m[k + 1] = cz * sy * sx - sz * cx; m[k + 2] = cz * sy * cx + sz * sx;
    m[k + 4] = sz * cy; m[k + 5] = sz * sy * sx + cz * cx - 1; m[k + 6] = sz * sy * cx - cz * sx;
    m[k + 8] = -sy; m[k + 9] = cy * sx; m[k + 10] = cy * cx - 1;
    const zShift = midZ * (1 - depth) - nz;
    m[k + 3] = sample[3] * amount - m[k] * nx - m[k + 1] * ny + m[k + 2] * zShift;
    m[k + 7] = sample[4] * amount - m[k + 4] * nx - m[k + 5] * ny + m[k + 6] * zShift;
    m[k + 11] = -m[k + 8] * nx - m[k + 9] * ny + m[k + 10] * zShift;
    m[k + 2] *= depth; m[k + 6] *= depth; m[k + 10] *= depth;
  }

  function apply(source, display, amount = 1) {
    displayAmount = amount;
    if (amount === 0) { display.set(source); return; }
    for (let b = 0; b < BUCKETS; b++) {
      const at = time - 0.04 * settings[0] * b / (BUCKETS - 1);
      if (at >= sampledAt) {
        const mix = time > sampledAt ? (at - sampledAt) / (time - sampledAt) : 1;
        for (let c = 0; c < 5; c++) sample[c] = lerp(history[cursor * 5 + c], current[c], mix);
      } else {
        const age = Math.min(SAMPLES - 1, (sampledAt - at) / STEP), whole = Math.floor(age);
        const a = (cursor - whole + SAMPLES) % SAMPLES, b = (a - 1 + SAMPLES) % SAMPLES;
        for (let c = 0; c < 5; c++) sample[c] = lerp(history[a * 5 + c], history[b * 5 + c], age - whole);
      }
      writeMatrix(b * 12, amount);
    }
    updateAttachment(source, BASE, phase, departing, traits, free, attachment, offsets, blends,
      coreEnd, filamentEnd, width, settings[2]);
    // Reply-start turns peak near 80 degrees/second; keep their path shimmer
    // around 0.4% of face width, with proportionally less on gentle beats.
    const deviation = settings[0] * angularSpeed * width * (0.004 / 80) * amount;
    diagnostics.deviationScale = deviation;
    applySwarm(source, display, matrices, attachment, offsets, blends, traits, free, deviation);
  }

  // Clearance landmarks receive exactly the protected features' current pose,
  // including virtual depth, with no delay or deviation.
  function transformPoint(point) {
    if (displayAmount === 0) return point;
    const x = point.x, y = point.y, z = point.z, m = matrices;
    point.x = x + m[0] * x + m[1] * y + m[2] * z + m[3];
    point.y = y + m[4] * x + m[5] * y + m[6] * z + m[7];
    point.z = z + m[8] * x + m[9] * y + m[10] * z + m[11];
    return point;
  }

  return { update, apply, transformPoint, diagnostics, applyTuning(tuning) {
    const names = ['swarm', 'swarmCoherence', 'surroundWeight', 'headDepth'];
    const low = [0, 0, 0, 1], high = [2, 1, 1, 4];
    for (let c = 0; c < names.length; c++) if (Number.isFinite(tuning[names[c]])) {
      targets[c] = Math.max(low[c], Math.min(high[c], tuning[names[c]]));
      if (!initialized) settings[c] = targets[c];
    }
  } };
}

function swarmSmooth(value) {
  const t = Math.max(0, Math.min(1, value));
  return Math.max(0, Math.min(1, t * t * t * (t * (t * 6 - 15) + 10)));
}

// Independent seed: never reads or advances the shapes generator.
function swarmRandom(seed) {
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function swarmHash(x, y, z, channel) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
    ^ Math.imul(z, 1442695041) ^ Math.imul(channel + 1, 1274126177) ^ 0x38c5e1b7;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}

function swarmNoise(x, y, z, channel) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = swarmSmooth(x - ix), v = swarmSmooth(y - iy), w = swarmSmooth(z - iz);
  const a = lerp(swarmHash(ix, iy, iz, channel), swarmHash(ix + 1, iy, iz, channel), u);
  const b = lerp(swarmHash(ix, iy + 1, iz, channel), swarmHash(ix + 1, iy + 1, iz, channel), u);
  const c = lerp(swarmHash(ix, iy, iz + 1, channel), swarmHash(ix + 1, iy, iz + 1, channel), u);
  const d = lerp(swarmHash(ix, iy + 1, iz + 1, channel), swarmHash(ix + 1, iy + 1, iz + 1, channel), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}

function mixSwarmTraits(individual, shared, traits, coherence) {
  for (let k = 0; k < traits.length; k += 4) {
    traits[k] = lerp(individual[k], shared[k], coherence);
    const x = lerp(individual[k + 1], shared[k + 1], coherence);
    const y = lerp(individual[k + 2], shared[k + 2], coherence);
    const z = lerp(individual[k + 3], shared[k + 3], coherence);
    const norm = Math.hypot(x, y, z) || 1;
    traits[k + 1] = x / norm; traits[k + 2] = y / norm; traits[k + 3] = z / norm;
  }
}

function updateAttachment(source, base, phase, departing, traits, free, attachment, offsets, blends,
  coreEnd, filamentEnd, width, surround) {
  for (let i = 0, j = 0; i < attachment.length; i++, j += 3) {
    let attached = 1;
    if (i >= filamentEnd) attached = 0;
    else if (i >= coreEnd) {
      const u = phase[i], t = u * (0.65 + u * 0.35);
      attached = 1 - swarmSmooth(t);
    } else if (departing[i]) {
      const distance = Math.hypot(source[j] - base[j], source[j + 1] - base[j + 1], source[j + 2] - base[j + 2]);
      attached = 1 - swarmSmooth((distance / width - 0.035) / 0.165);
    }
    const weight = surround + (1 - surround) * attached;
    attachment[i] = weight;
    const bucket = traits[i * 4] * free[i] * weight * 31;
    const lower = Math.min(30, Math.floor(bucket));
    offsets[i] = lower * 12; blends[i] = bucket - lower;
  }
}

function applySwarm(source, display, m, attachment, offsets, blends, traits, free, deviation) {
  for (let i = 0, j = 0; i < attachment.length; i++, j += 3) {
    const x = source[j], y = source[j + 1], z = source[j + 2], weight = attachment[i];
    if (weight === 0) { display[j] = x; display[j + 1] = y; display[j + 2] = z; continue; }
    const k = offsets[i], next = k + 12, mix = blends[i], t = i * 4;
    const dx = m[k] * x + m[k + 1] * y + m[k + 2] * z + m[k + 3];
    const dy = m[k + 4] * x + m[k + 5] * y + m[k + 6] * z + m[k + 7];
    const dz = m[k + 8] * x + m[k + 9] * y + m[k + 10] * z + m[k + 11];
    const dev = deviation * free[i];
    display[j] = x + weight * (lerp(dx, m[next] * x + m[next + 1] * y + m[next + 2] * z + m[next + 3], mix) + traits[t + 1] * dev);
    display[j + 1] = y + weight * (lerp(dy, m[next + 4] * x + m[next + 5] * y + m[next + 6] * z + m[next + 7], mix) + traits[t + 2] * dev);
    display[j + 2] = z + weight * (lerp(dz, m[next + 8] * x + m[next + 9] * y + m[next + 10] * z + m[next + 11], mix) + traits[t + 3] * dev);
  }
}
