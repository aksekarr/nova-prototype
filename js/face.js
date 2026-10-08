import { createMappedFace } from './facewarp.js';
import { createFaceMotion } from './facemotion.js';
import { createFaceHead } from './facehead.js';

const EXPR = {
  neutral:  { smile: 0.05, browL: 0, browR: 0, tilt: 0, eye: 1, gx: null, gy: null },
  warm:     { smile: 0.55, browL: 0.08, browR: 0.08, tilt: 0, eye: 0.78, gx: null, gy: null },
  curious:  { smile: 0.12, browL: 0.34, browR: -0.02, tilt: 0.1, eye: 1.08, gx: null, gy: null },
  thinking: { smile: -0.12, browL: -0.08, browR: 0.2, tilt: -0.08, eye: 0.9, gx: -1, gy: 1 }
};

function lerp(a, b, k) {
  return a + (b - a) * k;
}

export function createFace(shapes, reduce) {
  const cur = { smile: 0.05, browL: 0, browR: 0, tilt: 0, eye: 1 };
  const gaze = { x: 0, y: 0 };
  const fixedGaze = { x: 0, y: 0, mix: 0 };
  let blinkAge = Infinity, blinkV = 1;
  const mappedFace = createMappedFace(shapes, reduce);
  const motion = createFaceMotion(shapes, reduce);
  const head = createFaceHead(reduce);
  const follow = createHeadFollow(shapes);
  // Stage applies head motion after intrinsic particle easing.
  shapes.headDisplay = follow;

  function update(dt, clock, exprName, envelope, shape, speaking = false) {
    const tgt = EXPR[exprName], k = 1 - Math.pow(0.04, dt);
    cur.smile = lerp(cur.smile, tgt.smile, k);
    cur.browL = lerp(cur.browL, tgt.browL, k);
    cur.browR = lerp(cur.browR, tgt.browR, k);
    cur.tilt = lerp(cur.tilt, tgt.tilt, k);
    cur.eye = lerp(cur.eye, tgt.eye, k);

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
    mappedFace.applyTuning(tuning);
    motion.applyTuning(tuning);
    head.applyTuning(tuning);
    follow.applyTuning(tuning);
  } };
}

// Head history is independent of the simulation targets. Display-time posing
// gives every population the same motion without feeding it through its easing.
export function createHeadFollow(shapes) {
  const { BASE, I } = shapes;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let j = I.face[0] * 3; j < I.face[1] * 3; j += 3) {
    minX = Math.min(minX, BASE[j]); maxX = Math.max(maxX, BASE[j]);
    minY = Math.min(minY, BASE[j + 1]); maxY = Math.max(maxY, BASE[j + 1]);
    minZ = Math.min(minZ, BASE[j + 2]); maxZ = Math.max(maxZ, BASE[j + 2]);
  }
  const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
  const width = maxX - minX, height = maxY - minY;
  const nx = cx, ny = minY - height * 0.07, nz = minZ - height * 0.04;
  const rx = 2 / width, ry = 2 / height, rz = 2 / width;
  const BUCKETS = 32, SAMPLES = 64, STEP = 1 / 120;
  const history = new Float64Array(SAMPLES * 5);
  const previous = new Float64Array(5), current = new Float64Array(5), sample = new Float64Array(5);
  const matrices = new Float64Array(BUCKETS * 12);
  let initialized = false, cursor = 0, time = 0, sampledAt = 0, nextSample = STEP;
  let spread = 0, targetSpread = 0, displayAmount = 0;

  function writeMatrix(offset, amount) {
    const deg = Math.PI / 180 * amount;
    const sx = Math.sin(sample[1] * deg), cx = Math.cos(sample[1] * deg);
    const sy = Math.sin(sample[0] * deg), cy = Math.cos(sample[0] * deg);
    const sz = Math.sin(sample[2] * deg), cz = Math.cos(sample[2] * deg);
    const m = matrices, k = offset;
    m[k] = cz * cy; m[k + 1] = cz * sy * sx - sz * cx; m[k + 2] = cz * sy * cx + sz * sx;
    m[k + 4] = sz * cy; m[k + 5] = sz * sy * sx + cz * cx; m[k + 6] = sz * sy * cx - cz * sx;
    m[k + 8] = -sy; m[k + 9] = cy * sx; m[k + 10] = cy * cx;
    m[k + 3] = nx + sample[3] * amount - m[k] * nx - m[k + 1] * ny - m[k + 2] * nz;
    m[k + 7] = ny + sample[4] * amount - m[k + 4] * nx - m[k + 5] * ny - m[k + 6] * nz;
    m[k + 11] = nz - m[k + 8] * nx - m[k + 9] * ny - m[k + 10] * nz;
  }

  function update(dt, pose) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    current[0] = pose.yaw; current[1] = pose.pitch; current[2] = pose.roll;
    current[3] = pose.x; current[4] = pose.y;
    if (!initialized) {
      for (let i = 0; i < SAMPLES; i++) history.set(current, i * 5);
      previous.set(current); initialized = true;
    }
    const end = time + dt;
    while (nextSample <= end + 1e-9) {
      const mix = dt > 0 ? Math.min(1, (nextSample - time) / dt) : 1;
      cursor = (cursor + 1) % SAMPLES;
      for (let c = 0; c < 5; c++) history[cursor * 5 + c] = lerp(previous[c], current[c], mix);
      sampledAt = nextSample; nextSample += STEP;
    }
    time = end; previous.set(current);
    spread = lerp(spread, targetSpread, 1 - Math.exp(-dt / 0.12));
    if (Math.abs(spread - targetSpread) < 1e-7) spread = targetSpread;
  }

  function apply(source, display, amount = 1) {
    displayAmount = amount;
    if (amount === 0) { display.set(source); return; }
    const bucketCount = spread === 0 ? 1 : BUCKETS;
    for (let b = 0; b < bucketCount; b++) {
      const at = time - 0.06 * spread * b / (BUCKETS - 1);
      if (at >= sampledAt) {
        const mix = time > sampledAt ? (at - sampledAt) / (time - sampledAt) : 1;
        for (let c = 0; c < 5; c++) sample[c] = lerp(history[cursor * 5 + c], current[c], mix);
      } else {
        const age = Math.min(SAMPLES - 1, (sampledAt - at) / STEP), whole = Math.floor(age);
        const a = (cursor - whole + SAMPLES) % SAMPLES;
        const b = (a - 1 + SAMPLES) % SAMPLES;
        for (let c = 0; c < 5; c++) sample[c] = lerp(history[a * 5 + c], history[b * 5 + c], age - whole);
      }
      writeMatrix(b * 12, amount);
    }
    if (spread === 0) applyRigid(source, display, matrices);
    else applyDelayed(source, display, matrices, cx, cy, cz, rx, ry, rz);
  }

  function transformPoint(point) {
    if (displayAmount === 0) return point;
    const x = point.x, y = point.y, z = point.z, m = matrices;
    const bucket = spread === 0 ? 0 : delayBucket(x, y, z, cx, cy, cz, rx, ry, rz);
    const k = Math.min(30, Math.floor(bucket)) * 12, mix = bucket - k / 12;
    const next = mix === 0 ? k : k + 12;
    point.x = lerp(m[k] * x + m[k + 1] * y + m[k + 2] * z + m[k + 3],
      m[next] * x + m[next + 1] * y + m[next + 2] * z + m[next + 3], mix);
    point.y = lerp(m[k + 4] * x + m[k + 5] * y + m[k + 6] * z + m[k + 7],
      m[next + 4] * x + m[next + 5] * y + m[next + 6] * z + m[next + 7], mix);
    point.z = lerp(m[k + 8] * x + m[k + 9] * y + m[k + 10] * z + m[k + 11],
      m[next + 8] * x + m[next + 9] * y + m[next + 10] * z + m[next + 11], mix);
    return point;
  }

  return { update, apply, transformPoint, applyTuning(tuning) {
    if (Number.isFinite(tuning.followSpread)) targetSpread = Math.max(0, Math.min(2, tuning.followSpread));
  } };
}

// One analytic field, without feature masks, population bands or random steps.
// Its delay approaches (but never exceeds) 60 ms at spread 1; every weight is 1.
function delayBucket(x, y, z, cx, cy, cz, rx, ry, rz) {
  const dx = (x - cx) * rx, dy = (y - cy) * ry, dz = (z - cz) * rz;
  const radiusSquared = dx * dx + dy * dy + dz * dz;
  const fourth = radiusSquared * radiusSquared;
  return 31 * fourth / (16 + fourth);
}

function applyRigid(source, display, m) {
  for (let j = 0; j < source.length; j += 3) {
    const x = source[j], y = source[j + 1], z = source[j + 2];
    display[j] = m[0] * x + m[1] * y + m[2] * z + m[3];
    display[j + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    display[j + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
}

function applyDelayed(source, display, m, cx, cy, cz, rx, ry, rz) {
  for (let j = 0; j < source.length; j += 3) {
    const x = source[j], y = source[j + 1], z = source[j + 2];
    const bucket = delayBucket(x, y, z, cx, cy, cz, rx, ry, rz);
    const k = Math.min(30, Math.floor(bucket)) * 12, next = k + 12, mix = bucket - k / 12;
    const ax = m[k] * x + m[k + 1] * y + m[k + 2] * z + m[k + 3];
    const ay = m[k + 4] * x + m[k + 5] * y + m[k + 6] * z + m[k + 7];
    const az = m[k + 8] * x + m[k + 9] * y + m[k + 10] * z + m[k + 11];
    display[j] = lerp(ax, m[next] * x + m[next + 1] * y + m[next + 2] * z + m[next + 3], mix);
    display[j + 1] = lerp(ay, m[next + 4] * x + m[next + 5] * y + m[next + 6] * z + m[next + 7], mix);
    display[j + 2] = lerp(az, m[next + 8] * x + m[next + 9] * y + m[next + 10] * z + m[next + 11], mix);
  }
}
