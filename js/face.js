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
  const { BASE, FACE, I } = shapes;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity;
  for (let j = I.face[0] * 3; j < I.face[1] * 3; j += 3) {
    minX = Math.min(minX, BASE[j]); maxX = Math.max(maxX, BASE[j]);
    minY = Math.min(minY, BASE[j + 1]); maxY = Math.max(maxY, BASE[j + 1]);
    minZ = Math.min(minZ, BASE[j + 2]);
  }
  const height = maxY - minY;
  const neckX = (minX + maxX) * 0.5, neckY = minY - height * 0.07;
  const neckZ = minZ - height * 0.04;

  function poseParticles(pose, start, end, weight) {
    const radians = Math.PI / 180 * weight;
    const sx = Math.sin(pose.pitch * radians), cx = Math.cos(pose.pitch * radians);
    const sy = Math.sin(pose.yaw * radians), cy = Math.cos(pose.yaw * radians);
    const sz = Math.sin(pose.roll * radians), cz = Math.cos(pose.roll * radians);
    // Rz * Ry * Rx, evaluated once per population rather than per particle.
    const xx = cz * cy, xy = cz * sy * sx - sz * cx, xz = cz * sy * cx + sz * sx;
    const yx = sz * cy, yy = sz * sy * sx + cz * cx, yz = sz * sy * cx - cz * sx;
    const zx = -sy, zy = cy * sx, zz = cy * cx;
    const tx = neckX + pose.x * weight, ty = neckY + pose.y * weight;
    for (let j = start * 3; j < end * 3; j += 3) {
      const x = FACE[j] - neckX, y = FACE[j + 1] - neckY, z = FACE[j + 2] - neckZ;
      FACE[j] = xx * x + xy * y + xz * z + tx;
      FACE[j + 1] = yx * x + yy * y + yz * z + ty;
      FACE[j + 2] = zx * x + zy * y + zz * z + neckZ;
    }
  }

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
    poseParticles(pose, I.face[0], I.face[1], 1);
    poseParticles(pose, I.face[1], shapes.N ?? I.halo[1], 0.6);
  }

  return { update, applyTuning(tuning) {
    mappedFace.applyTuning(tuning);
    motion.applyTuning(tuning);
    head.applyTuning(tuning);
  } };
}
