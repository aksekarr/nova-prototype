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
    const ax = HA * taper(y) * Math.sqrt(s);
    const q = 1 - (x / ax) * (x / ax);
    return q > 0 ? HC * Math.sqrt(s) * Math.sqrt(q) : 0;
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
      const u = R(), rad = s.th * 0.14;
      TREE[idx * 3] = (s.a[0] + (s.b[0] - s.a[0]) * u + gauss() * rad) * sc;
      TREE[idx * 3 + 1] = (s.a[1] + (s.b[1] - s.a[1]) * u + gauss() * rad - mid) * sc;
      TREE[idx * 3 + 2] = (s.a[2] + (s.b[2] - s.a[2]) * u + gauss() * rad) * sc;
    }
  });
  for (; idx < N; idx++) {
    const t = tips[Math.floor(R() * tips.length)];
    TREE[idx * 3] = (t[0] + gauss() * 0.32) * sc;
    TREE[idx * 3 + 1] = (t[1] + gauss() * 0.28 - mid) * sc;
    TREE[idx * 3 + 2] = (t[2] + gauss() * 0.32) * sc;
  }
  // Spread every face group across the whole tree.
  for (let m = N - 1; m > 0; m--) {
    const q = Math.floor(R() * (m + 1));
    for (let c = 0; c < 3; c++) {
      const tmp = TREE[m * 3 + c];
      TREE[m * 3 + c] = TREE[q * 3 + c];
      TREE[q * 3 + c] = tmp;
    }
  }

  return { N, I, FEATURE_END, P1, P2, P3, P4, PH, RATE, FACE, COL, NEB, TREE, EYE_X, EYE_Y, EYE_Z, surfZ };
}
