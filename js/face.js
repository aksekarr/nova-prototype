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

  function update(dt, clock, exprName, envelope) {
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
    const mOpen = envelope * 1.0 + 0.015, base = -1.45;
    for (let i = I.mouth[0]; i < I.mouth[1]; i++) {
      const mu = P1[i], mx = mu * 0.72 * (1 + 0.12 * cur.smile);
      FACE[i * 3] = mx;
      FACE[i * 3 + 1] = base + cur.smile * 0.32 * mu * mu + P2[i] * mOpen * 0.45 * Math.sqrt(1 - mu * mu) + P3[i];
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

  return { update };
}
