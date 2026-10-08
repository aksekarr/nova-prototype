import { createMappedFace } from './facewarp.js';
import { createFaceMotion } from './facemotion.js';

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
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 2 };
  let blinkAt = 3, blinkV = 1;
  const mappedFace = createMappedFace(shapes, reduce);
  const motion = createFaceMotion(shapes, reduce);

  function update(dt, clock, exprName, envelope, shape) {
    const tgt = EXPR[exprName], k = 1 - Math.pow(0.04, dt);
    cur.smile = lerp(cur.smile, tgt.smile, k);
    cur.browL = lerp(cur.browL, tgt.browL, k);
    cur.browR = lerp(cur.browR, tgt.browR, k);
    cur.tilt = lerp(cur.tilt, tgt.tilt, k);
    cur.eye = lerp(cur.eye, tgt.eye, k);

    // Gaze wanders unless the expression fixes its target.
    if (tgt.gx !== null) {
      gaze.tx = tgt.gx;
      gaze.ty = tgt.gy;
    } else if (clock > gaze.next) {
      gaze.tx = (Math.random() * 2 - 1) * 0.8;
      gaze.ty = (Math.random() * 2 - 1) * 0.5;
      gaze.next = clock + 1.4 + Math.random() * 2.6;
    }
    gaze.x = lerp(gaze.x, gaze.tx, 1 - Math.pow(0.002, dt));
    gaze.y = lerp(gaze.y, gaze.ty, 1 - Math.pow(0.002, dt));

    const bt = clock - blinkAt;
    if (bt > 0 && bt < 0.16) {
      blinkV = 1 - 0.92 * Math.sin(Math.PI * bt / 0.16);
    } else {
      blinkV = 1;
      if (bt >= 0.16) blinkAt = clock + 2.4 + Math.random() * 3.2;
    }

    mappedFace.update(clock, cur, gaze, blinkV, envelope, shape);
    motion.update(clock);
  }

  return { update, applyTuning(tuning) {
    mappedFace.applyTuning(tuning);
    motion.applyTuning(tuning);
  } };
}
