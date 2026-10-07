// A private generator keeps shape construction deterministic and self-contained.
function rngFrom(seed) {
  return function () {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createShapes(N) {
  const R = rngFrom(7);
  function gauss() {
    let u = 0;
    while (!u) u = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R());
  }

  const C = {
    eye: Math.round(N * 0.035),
    brow: Math.round(N * 0.016),
    mouth: Math.round(N * 0.045),
    halo: Math.round(N * 0.12)
  };
  const I = {};
  let o = 0;
  I.eyeL = [o, o += C.eye];
  I.eyeR = [o, o += C.eye];
  I.browL = [o, o += C.brow];
  I.browR = [o, o += C.brow];
  I.mouth = [o, o += C.mouth];
  I.halo = [o, o += C.halo];
  I.shell = [o, N];
  const FEATURE_END = I.halo[0];

  const P1 = new Float32Array(N), P2 = new Float32Array(N);
  const P3 = new Float32Array(N), P4 = new Float32Array(N);
  const PH = new Float32Array(N), RATE = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    PH[i] = R() * Math.PI * 2;
    RATE[i] = 0.016 + R() * 0.05;
  }

  const HA = 2.3, HB = 3.0, HC = 2.0;
  const EYE_X = 0.95, EYE_Y = 0.55;
  function taper(y) {
    return y < -0.6 ? 1 - 0.38 * Math.min(1, (-0.6 - y) / 2.4) : 1;
  }
  function socket(x, y) {
    const d1 = (x - EYE_X) * (x - EYE_X) + (y - EYE_Y) * (y - EYE_Y);
    const d2 = (x + EYE_X) * (x + EYE_X) + (y - EYE_Y) * (y - EYE_Y);
    return 0.45 * (Math.exp(-d1 / 0.2) + Math.exp(-d2 / 0.2));
  }
  function surfZ(x, y) {
    const s = 1 - (y / HB) * (y / HB);
    if (s <= 0) return 0;
    // Broad relief keeps the animated features seated on the same light sculpture.
    // Narrow the lower jaw, flare the cheek plane, then bring the chin forward.
    const jawT = Math.max(0, Math.min(1, (-y - 1.5) / 1.3));
    const jaw = jawT * jawT * (3 - 2 * jawT);
    const cheekWidth = 0.045 * Math.exp(-Math.pow((y + 0.18) / 0.58, 2));
    const ax = HA * taper(y) * Math.sqrt(s) * (1 + cheekWidth - 0.14 * jaw);
    const q = 1 - (x / ax) * (x / ax);
    if (q <= 0) return 0;
    const brow = 0.19 * Math.exp(-Math.pow((y - 1.42) / 0.66, 4) - Math.pow(x / 1.75, 4));
    const cheeks = 0.24 * Math.exp(-Math.pow((Math.abs(x) - 1.28) / 0.48, 2) - Math.pow((y + 0.18) / 0.55, 2));
    const chin = 0.23 * Math.exp(-Math.pow(x / 0.65, 2) - Math.pow((y + 2.43) / 0.42, 2));
    return (HC * Math.sqrt(s) + brow + cheeks + chin) * Math.sqrt(q);
  }
  const EYE_Z = surfZ(EYE_X, EYE_Y) - 0.3;

  const FACE = new Float32Array(N * 3);
  const COL = new Float32Array(N * 3);
  function setCol(i, r, g, b) {
    COL[i * 3] = r;
    COL[i * 3 + 1] = g;
    COL[i * 3 + 2] = b;
  }

  // Shell: topographic contour rings across the front of the head.
  const a = I.shell[0], b = I.shell[1], count = b - a, RINGS = 34;
  const shellAngle = new Float64Array(count);
  const w = [];
  let tot = 0;
  for (let r = 0; r < RINGS; r++) {
    const y = -2.85 + (5.75 * r) / (RINGS - 1);
    const s = Math.sqrt(Math.max(0, 1 - (y / HB) * (y / HB)));
    w.push(s * taper(y) + 0.05);
    tot += s * taper(y) + 0.05;
  }
  let idx = a;
  for (let r = 0; r < RINGS && idx < b; r++) {
    const yr = -2.85 + (5.75 * r) / (RINGS - 1);
    const n = r === RINGS - 1 ? b - idx : Math.round(count * w[r] / tot);
    for (let k = 0; k < n && idx < b; k++, idx++) {
      const th = (R() * 2 - 1) * 1.95;
      shellAngle[idx - a] = th;
      const y2 = yr + gauss() * 0.012;
      const ss = Math.sqrt(Math.max(0, 1 - (y2 / HB) * (y2 / HB)));
      const x = HA * taper(y2) * ss * Math.sin(th);
      const z = HC * ss * Math.cos(th) - socket(x, y2);
      FACE[idx * 3] = x;
      FACE[idx * 3 + 1] = y2;
      FACE[idx * 3 + 2] = z;
      const lit = 0.16 + 0.26 * Math.pow(Math.max(0, Math.cos(th)), 0.6);
      setCol(idx, lit * 0.78, lit * 0.9, lit * 1.15);
    }
  }
  for (; idx < b; idx++) {
    FACE[idx * 3 + 1] = -3;
    setCol(idx, 0.12, 0.14, 0.2);
  }

  // Dynamic groups store parameters; face.js computes their positions each frame.
  [I.eyeL, I.eyeR].forEach((rg) => {
    for (let i = rg[0]; i < rg[1]; i++) {
      const ring = R() < 0.6;
      P1[i] = R() * Math.PI * 2;
      P2[i] = ring ? 0 : 1;
      P3[i] = ring ? gauss() * 0.02 : Math.abs(gauss()) * 0.08;
      if (ring) setCol(i, 0.85, 0.6, 0.34);
      else setCol(i, 1.0, 0.78, 0.5);
    }
  });
  [I.browL, I.browR].forEach((rg) => {
    for (let i = rg[0]; i < rg[1]; i++) {
      P1[i] = R();
      P2[i] = gauss() * 0.025;
      setCol(i, 0.62, 0.72, 0.9);
    }
  });
  for (let i = I.mouth[0]; i < I.mouth[1]; i++) {
    P1[i] = (R() * 2 - 1);
    P2[i] = R() < 0.5 ? -1 : 1;
    P3[i] = gauss() * 0.02;
    setCol(i, 0.9, 0.72, 0.52);
  }
  for (let i = I.halo[0]; i < I.halo[1]; i++) {
    P1[i] = R() * Math.PI * 2;
    P2[i] = 4.3 + gauss() * 0.22;
    P3[i] = gauss() * 0.1;
    P4[i] = 0.05 + R() * 0.08;
    const hl = 0.12 + R() * 0.16;
    setCol(i, hl * 0.8, hl * 0.9, hl * 1.2);
  }

  const NEB = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    let x, y, z;
    if (R() < 0.72) {
      const arm = Math.floor(R() * 3), rr = 1 + 9 * Math.pow(R(), 0.75);
      const ang = arm * 2.094 + rr * 0.42 + gauss() * 0.32;
      x = rr * Math.cos(ang);
      z = rr * Math.sin(ang) * 0.7;
      y = gauss() * (0.35 + rr * 0.06);
    } else {
      x = gauss() * 7;
      y = gauss() * 3.6;
      z = gauss() * 4;
    }
    const tl = 0.55, cy = Math.cos(tl), sy = Math.sin(tl);
    NEB[i * 3] = x;
    NEB[i * 3 + 1] = y * cy - z * sy;
    NEB[i * 3 + 2] = y * sy + z * cy;
  }

  const TREE = new Float32Array(N * 3);
  // Carry botanical membership through the existing shuffle without any RNG draws.
  const treeTip = new Uint8Array(N);
  const treeThickness = new Float32Array(N);
  const segs = [], tips = [];
  function norm(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function branch(p, d, len, th, depth, up) {
    const e = [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len];
    segs.push({ a: p, b: e, th: th, len: len });
    if (depth === 0) {
      tips.push(e);
      return;
    }
    const n = depth > 3 ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const nd = norm([d[0] + gauss() * 0.55, d[1] + gauss() * 0.3 + up, d[2] + gauss() * 0.55]);
      branch(e, nd, len * 0.74, th * 0.66, depth - 1, up);
    }
  }
  branch([0, -3.4, 0], [0, 1, 0], 2.1, 1, 6, 0.28);
  for (let k = 0; k < 5; k++) {
    const a = k * 1.256 + R() * 0.4;
    branch([0, -3.4, 0], norm([Math.cos(a), -0.6, Math.sin(a)]), 0.9, 0.55, 2, -0.35);
  }
  let minY = 1e9, maxY = -1e9;
  segs.forEach((s) => {
    minY = Math.min(minY, s.a[1], s.b[1]);
    maxY = Math.max(maxY, s.b[1]);
  });
  tips.forEach((t) => { maxY = Math.max(maxY, t[1] + 0.4); });
  const sc = 7 / (maxY - minY), mid = (maxY + minY) / 2;
  const wood = Math.floor(N * 0.5);
  let wsum = 0;
  segs.forEach((s) => { wsum += s.len * (0.25 + s.th); });
  idx = 0;
  segs.forEach((s) => {
    const n = Math.round(wood * s.len * (0.25 + s.th) / wsum);
    for (let j = 0; j < n && idx < N; j++, idx++) {
      treeThickness[idx] = s.th;
      const u = R(), rad = s.th * 0.14;
      TREE[idx * 3] = (s.a[0] + (s.b[0] - s.a[0]) * u + gauss() * rad) * sc;
      TREE[idx * 3 + 1] = (s.a[1] + (s.b[1] - s.a[1]) * u + gauss() * rad - mid) * sc;
      TREE[idx * 3 + 2] = (s.a[2] + (s.b[2] - s.a[2]) * u + gauss() * rad) * sc;
    }
  });
  for (; idx < N; idx++) {
    const t = tips[Math.floor(R() * tips.length)];
    // Root endings stay woody; only the canopy's terminal clusters turn teal.
    treeTip[idx] = t[1] > -3.4 ? 1 : 0;
    treeThickness[idx] = treeTip[idx] ? 0 : 0.55;
    TREE[idx * 3] = (t[0] + gauss() * 0.32) * sc;
    TREE[idx * 3 + 1] = (t[1] + gauss() * 0.28 - mid) * sc;
    TREE[idx * 3 + 2] = (t[2] + gauss() * 0.32) * sc;
  }
  // Spread every face group across the whole tree.
  for (let m = N - 1; m > 0; m--) {
    const q = Math.floor(R() * (m + 1));
    const tip = treeTip[m], thickness = treeThickness[m];
    treeTip[m] = treeTip[q]; treeTip[q] = tip;
    treeThickness[m] = treeThickness[q]; treeThickness[q] = thickness;
    for (let c = 0; c < 3; c++) {
      const tmp = TREE[m * 3 + c];
      TREE[m * 3 + c] = TREE[q * 3 + c];
      TREE[q * 3 + c] = tmp;
    }
  }

  // Preserve this legacy draw order, including sizes, before adding any randomness.
  const SIZE = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const feature = (i >= I.eyeL[0] && i < I.eyeR[1]) ||
      (i >= I.mouth[0] && i < I.mouth[1]);
    SIZE[i] = feature ? 1.15 : R() < 0.03 ? 1.6 + R() : 0.8 + R() * 0.4;
  }

  // All new draws begin here. The original nebula pass above deliberately retains
  // its RNG consumption so feature parameters, tree geometry and sizes stay exact.
  for (let i = a; i < b; i++) {
    const j = i * 3, y = FACE[j + 1], th = shellAngle[i - a];
    // Find each ring's silhouette from surfZ, so its jaw/cheek form has one source.
    let lo = 0, hi = HA * 1.1;
    for (let k = 0; k < 18; k++) {
      const x = (lo + hi) * 0.5;
      if (surfZ(x, y) > 0) lo = x; else hi = x;
    }
    const edge = 1 - Math.pow(1 - Math.abs(th) / 1.95, 0.62);
    const side = th < 0 ? -1 : 1;
    let x = side * lo * edge, z = surfZ(x, y) - socket(x, y);
    let dy = 0;
    // Density falls continuously toward the rim; a few outer samples escape it.
    if (R() < Math.max(0, (edge - 0.58) / 0.42) * 0.62) {
      const drift = R();
      x += side * (0.06 + drift * 0.48);
      dy = gauss() * (0.04 + drift * 0.14);
      z += gauss() * 0.18 - drift * 0.12;
    }
    FACE[j] = x; FACE[j + 1] = y + dy; FACE[j + 2] = z;
  }

  const FACE_COL = new Float32Array(COL);
  const NEB_COL = new Float32Array(N * 3);
  const TREE_COL = new Float32Array(N * 3);
  const knots = [[0, 2.6], [1, 5.0], [2, 7.4], [0, 7.9]].map(([arm, rr]) => {
    const angle = arm * 2.094 + rr * 0.42;
    return [rr * Math.cos(angle), rr * Math.sin(angle), arm];
  });
  const cy = Math.cos(0.55), sy = Math.sin(0.55);
  for (let i = 0; i < N; i++) {
    const j = i * 3, kind = R(), halo = kind < 0.14, knot = !halo && kind < 0.34;
    let x, y, z, arm = 0, rr = 0;
    // Rejection removes matter from two crossing dust bands, including the knots.
    for (;;) {
      if (halo) {
        x = gauss() * 7; y = gauss() * 3.6; z = gauss() * 4 / 0.7;
      } else if (knot) {
        const centre = knots[Math.floor(R() * knots.length)];
        arm = centre[2];
        x = centre[0] + gauss() * 0.48;
        z = centre[1] + gauss() * 0.48;
        y = gauss() * 0.22;
        rr = Math.hypot(x, z);
      } else {
        arm = Math.floor(R() * 3); rr = 1 + 9 * Math.pow(R(), 0.75);
        const angle = arm * 2.094 + rr * 0.42 + gauss() * 0.24;
        x = rr * Math.cos(angle); z = rr * Math.sin(angle);
        y = gauss() * (0.22 + rr * 0.045);
      }
      const laneA = Math.abs(x * 0.78 + z * 0.63 + 1.6);
      const laneB = Math.abs(-x * 0.48 + z * 0.88 - 3.1);
      const dust = Math.max(Math.exp(-Math.pow(laneA / 0.46, 4)), Math.exp(-Math.pow(laneB / 0.52, 4)));
      if (halo || R() > dust * 0.97) break;
    }
    z *= 0.7;
    NEB[j] = x;
    NEB[j + 1] = y * cy - z * sy;
    NEB[j + 2] = y * sy + z * cy;

    // Most light is icy; broad regions of each arm carry violet or teal into knots.
    let red = 0.63, green = 0.79, blue = 1;
    const region = Math.pow(0.5 + 0.5 * Math.sin(rr * 0.67 + arm * 2.1), 3) * 0.82;
    const tint = arm === 1 ? [0.43, 0.25, 0.8] : [0.19, 0.65, 0.7];
    red += (tint[0] - red) * region;
    green += (tint[1] - green) * region;
    blue += (tint[2] - blue) * region;
    let light = halo ? 0.026 + R() * 0.055 : knot ? 0.4 + R() * 0.32 : 0.16 + R() * 0.22;
    if (R() < 0.006) {
      red = 1; green = 0.66; blue = 0.32;
      light = halo ? 0.16 : 0.55 + R() * 0.2;
    }
    NEB_COL[j] = red * light;
    NEB_COL[j + 1] = green * light;
    NEB_COL[j + 2] = blue * light;

    const tip = treeTip[i], thin = 1 - Math.min(1, treeThickness[i]);
    const treeLight = tip ? 0.27 + R() * 0.16 : 0.14 + thin * 0.1 + R() * 0.05;
    TREE_COL[j] = treeLight * (tip ? 0.62 : 0.91 - thin * 0.19);
    TREE_COL[j + 1] = treeLight * (tip ? 0.94 : 0.65 + thin * 0.19);
    TREE_COL[j + 2] = treeLight * (tip ? 0.85 : 0.43 + thin * 0.31);
  }

  return { N, I, FEATURE_END, P1, P2, P3, P4, PH, RATE, FACE, COL, FACE_COL, NEB, NEB_COL, TREE, TREE_COL, SIZE, EYE_X, EYE_Y, EYE_Z, surfZ };
}
