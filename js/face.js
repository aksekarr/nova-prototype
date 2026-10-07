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
  const { I, P1, P2, P3, P4, FACE, EYE_X, EYE_Y, EYE_Z, surfZ } = shapes;
  const cur = { smile: 0.05, browL: 0, browR: 0, tilt: 0, eye: 1 };
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 2 };
  let blinkAt = 3, blinkV = 1;
  const lightFace = shapes.version === 'v3' ? createMappedFace(shapes, reduce)
    : shapes.version === 'v2' ? createLightFace(shapes, reduce) : null;
  const motion = shapes.version === 'v3' ? createFaceMotion(shapes, reduce) : null;

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

    if (lightFace) {
      lightFace.update(clock, cur, gaze, blinkV, envelope, shape);
      if (motion) motion.update(clock);
      return;
    }
    const open = cur.eye * blinkV;
    for (let side = -1; side <= 1; side += 2) {
      let rg = side < 0 ? I.eyeL : I.eyeR;
      const ex = side * EYE_X, gx = gaze.x * 0.12, gy = gaze.y * 0.08;
      for (let i = rg[0]; i < rg[1]; i++) {
        const a = P1[i] + (P2[i] ? clock * 0.6 : 0);
        let r;
        if (P2[i] === 0) {
          r = 0.4 + P3[i];
          FACE[i * 3] = ex + Math.cos(a) * r;
          FACE[i * 3 + 1] = EYE_Y + Math.sin(a) * r * open;
          FACE[i * 3 + 2] = EYE_Z + 0.05;
        } else {
          r = P3[i];
          FACE[i * 3] = ex + gx + Math.cos(a) * r;
          FACE[i * 3 + 1] = EYE_Y + gy + Math.sin(a) * r * Math.max(open, 0.12);
          FACE[i * 3 + 2] = EYE_Z + 0.14;
        }
      }
      rg = side < 0 ? I.browL : I.browR;
      const lift = side < 0 ? cur.browL : cur.browR;
      for (let i = rg[0]; i < rg[1]; i++) {
        const u = P1[i], bx = side * (0.42 + 1.05 * u);
        FACE[i * 3] = bx;
        FACE[i * 3 + 1] = 1.32 + lift + 0.14 * Math.sin(Math.PI * u) + cur.tilt * (u - 0.5) + P2[i];
        FACE[i * 3 + 2] = surfZ(bx, 1.3) + 0.12;
      }
    }
    const mOpen = (envelope * 1.0 + 0.015) * shape.h * (1 - shape.close), base = -1.45;
    for (let i = I.mouth[0]; i < I.mouth[1]; i++) {
      const mu = P1[i], mx = mu * 0.72 * (1 + 0.12 * cur.smile) * shape.w;
      FACE[i * 3] = mx;
      FACE[i * 3 + 1] = base + cur.smile * 0.32 * mu * mu * (1 - 0.7 * shape.round) + P2[i] * mOpen * 0.45 * Math.sqrt(1 - mu * mu) + P3[i];
      FACE[i * 3 + 2] = surfZ(mx, base) + 0.1;
    }
    const ct = Math.cos(0.42), st = Math.sin(0.42), cz = Math.cos(0.18), sz = Math.sin(0.18);
    for (let i = I.halo[0]; i < I.halo[1]; i++) {
      const ha = P1[i] + clock * P4[i] * (reduce ? 0.4 : 1), hr = P2[i];
      const hx = hr * Math.cos(ha), hz = hr * Math.sin(ha), hy = P3[i];
      const y1 = hy * ct - hz * st, z1 = hy * st + hz * ct;
      FACE[i * 3] = hx * cz - y1 * sz;
      FACE[i * 3 + 1] = hx * sz + y1 * cz;
      FACE[i * 3 + 2] = z1;
    }
  }

  return { update, applyTuning(tuning) {
    if (lightFace) lightFace.applyTuning(tuning);
    if (motion) motion.applyTuning(tuning);
  } };
}

// The light face shares the original expression, gaze, blink and voice clocks.
// Only the geometry mapping differs; each lip is a ribbon with a shared seam.
function createLightFace(shapes, reduce) {
  const { I, P1, P2, P3, P4, LIP, FACE, BASE, FACE_COL, BASE_COL, surfZ, EYE_X, EYE_Y } = shapes;
  let lipProminence = 1, eyeGlow = 1, dissolveAmount = 1;

  function applyTuning(tuning) {
    lipProminence = tuning.lipProminence;
    eyeGlow = tuning.eyeGlow;
    dissolveAmount = tuning.dissolveAmount;
    for (const [key, range] of Object.entries(I)) {
      const gain = key === 'mouth' ? lipProminence : key.startsWith('eye') ? eyeGlow
        : key === 'rim' ? tuning.rimStrength : key === 'halo' ? dissolveAmount : 1;
      for (let i = range[0]; i < range[1]; i++) {
        // Stable membership fades dots in instead of washing out every contour.
        const density = key === 'interior'
          ? Math.max(0, Math.min(1, (tuning.interiorDensity - P4[i]) * 12)) : 1;
        for (let c = 0; c < 3; c++) FACE_COL[i * 3 + c] = BASE_COL[i * 3 + c] * gain * density;
      }
    }
  }

  function update(clock, cur, gaze, blink, envelope, shape) {
    // Remap the existing blink's last eight percent onto a fully closed lid.
    const open = cur.eye * Math.max(0, (blink - 0.08) / 0.92);
    for (let side = -1; side <= 1; side += 2) {
      const ex = side * EYE_X;
      let rg = side < 0 ? I.eyeL : I.eyeR;
      for (let i = rg[0]; i < rg[1]; i++) {
        const j = i * 3, u = P1[i], arch = Math.max(0, 1 - u * u);
        const glow = P2[i] !== 0;
        // Glow slips beneath a fixed soft upper arc; it never orbits the eye.
        const x = ex + u * 0.48 + (glow ? gaze.x * 0.045 * arch : 0);
        const lid = 0.18 * arch * open;
        const y = EYE_Y + side * u * 0.038 + lid
          - (glow ? (0.07 + P3[i] * 0.20) * arch * open : 0)
          + P4[i] * (glow ? open : 1) + (glow ? gaze.y * 0.025 * open * arch : 0);
        FACE[j] = x; FACE[j + 1] = y; FACE[j + 2] = surfZ(x, y) + 0.055;
        const fade = glow ? Math.min(1, open * 1.6) : 1;
        FACE_COL[j] = BASE_COL[j] * eyeGlow * fade;
        FACE_COL[j + 1] = BASE_COL[j + 1] * eyeGlow * fade;
        FACE_COL[j + 2] = BASE_COL[j + 2] * eyeGlow * fade;
      }
      rg = side < 0 ? I.browL : I.browR;
      const lift = side < 0 ? cur.browL : cur.browR;
      for (let i = rg[0]; i < rg[1]; i++) {
        const j = i * 3, u = P1[i], x = side * (0.38 + 1.00 * u);
        const y = 1.11 + lift + 0.16 * Math.sin(Math.PI * u) - 0.10 * u
          + cur.tilt * (u - 0.5) + P2[i];
        FACE[j] = x; FACE[j + 1] = y; FACE[j + 2] = surfZ(x, y) + 0.035;
      }
    }

    const aperture = (envelope + 0.015) * shape.h * (1 - shape.close) * 0.62;
    const width = 0.74 * shape.w * (1 + cur.smile * 0.12) * (1 - shape.round * 0.10);
    const thickness = (0.85 + lipProminence * 0.15) * (1 - shape.close * 0.32);
    for (let i = I.mouth[0]; i < I.mouth[1]; i++) {
      const j = i * 3, u = P1[i], upper = P2[i] > 0, v = P3[i];
      const profile = (i - I.mouth[0]) * 4;
      const edge = Math.max(0, 1 - u * u), arc = LIP[profile], body = LIP[profile + 1];
      const seam = -1.38 + cur.smile * 0.32 * u * u * (1 - 0.7 * shape.round)
        + LIP[profile + 3];
      const x = u * width;
      const gap = aperture * (upper ? 0.33 : 0.57) * arc;
      const y = seam + (upper ? 1 : -1) * (gap + body * v * thickness) + P4[i] * arc;
      FACE[j] = x; FACE[j + 1] = y;
      // Both ribbons lie on the same surface, with a soft lip roll, not two
      // unattached hoops. Pursing advances that roll and narrows the corners.
      FACE[j + 2] = surfZ(x, y) + 0.065 + edge *
        (LIP[profile + 2] + 0.22 * shape.round + 0.035 * shape.close);
    }

    const speed = reduce ? 0.4 : 1;
    for (let i = I.halo[0]; i < I.halo[1]; i++) {
      const j = i * 3, phase = clock * speed * P3[i] + P1[i];
      const motion = dissolveAmount * P2[i];
      FACE[j] = BASE[j] + Math.sin(phase) * motion;
      FACE[j + 1] = BASE[j + 1] + Math.sin(phase * 0.73) * motion;
      FACE[j + 2] = BASE[j + 2] + Math.cos(phase * 0.87) * motion;
    }
  }
  return { update, applyTuning };
}
