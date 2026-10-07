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

  // Recolour only after every legacy draw. The same spatial fields carry light
  // along the arms, through their dust, and into the knots without extra draws.
  for (let i = 0; i < N; i++) {
    const j = i * 3, x = NEB[j];
    const z = (-NEB[j + 1] * sy + NEB[j + 2] * cy) / 0.7;
    const radius = Math.hypot(x, z), angle = Math.atan2(z, x);
    const light = Math.max(NEB_COL[j], NEB_COL[j + 1], NEB_COL[j + 2]);
    const halo = light < 0.084;
    const amberStar = NEB_COL[j] > NEB_COL[j + 2];
    const core = Math.exp(-Math.pow(radius / 3.1, 2));
    const phase = angle - radius * 0.42;
    const armDistance = Math.atan2(Math.sin(phase * 3), Math.cos(phase * 3)) / 3;
    const armLight = Math.exp(-Math.pow(armDistance / 0.34, 2));
    let red = 0.53, green = 0.76, blue = 1.0;

    // A broad teal outer region blends into icy arm light, not isolated dots.
    const teal = (0.5 + 0.5 * Math.sin(angle + 0.7)) *
      Math.exp(-Math.pow((radius - 7) / 3.1, 2)) * 0.56;
    red += (0.22 - red) * teal;
    green += (0.86 - green) * teal;
    blue += (0.84 - blue) * teal;

    // Coloured envelopes surround pale hot knots, like illuminated gas rather
    // than four solid-colour beads. The inner knot joins the warm bulge below.
    for (let k = 0; k < knots.length; k++) {
      const dx = x - knots[k][0], dz = z - knots[k][1];
      const d2 = dx * dx + dz * dz;
      const glow = Math.exp(-d2 / 3.3) * (1 - 0.48 * Math.exp(-d2 / 0.32)) * 0.78;
      const magenta = k % 2 === 1;
      red += ((magenta ? 0.94 : 0.62) - red) * glow;
      green += ((magenta ? 0.43 : 0.40) - green) * glow;
      blue += ((magenta ? 0.81 : 1.0) - blue) * glow;
    }
    const warm = Math.pow(core, 0.68);
    red += (1.0 - red) * warm;
    green += (0.85 - green) * warm;
    blue += (0.63 - blue) * warm;

    // Narrow reddish-brown seams thread the blue arms; sparse crossing bands
    // keep their dark edges. Small deterministic undulations avoid uniform rings.
    const laneA = Math.abs(x * 0.78 + z * 0.63 + 1.6);
    const laneB = Math.abs(-x * 0.48 + z * 0.88 - 3.1);
    const threadPhase = phase - 0.13 - 0.035 * Math.sin(radius * 2.6 + angle);
    const armLane = Math.abs(Math.sin(1.5 * threadPhase)) * radius / 1.5;
    const dust = (1 - core * 0.76) * Math.max(
      Math.exp(-Math.pow(laneA / 0.76, 4)) * 0.85,
      Math.exp(-Math.pow(laneB / 0.82, 4)) * 0.85,
      Math.exp(-Math.pow(armLane / 0.32, 2)) * 0.96
    );
    red += (0.38 - red) * dust;
    green += (0.16 - green) * dust;
    blue += (0.12 - blue) * dust;
    if (amberStar) { red = 1; green = 0.80; blue = 0.54; }
    // Lift the continuous arm population more than the already-dense knots.
    // Distant halo particles retain their original low luminosity.
    const illumination = halo ? light : (0.14 + light * 0.80) *
      (0.88 + armLight * 0.32 + core * 0.52);
    const intensity = illumination * (1 - dust * 0.64);
    NEB_COL[j] = red * intensity;
    NEB_COL[j + 1] = green * intensity;
    NEB_COL[j + 2] = blue * intensity;
  }

  // A separate design consumes randomness only after every pre-existing draw.
  // Nothing above, including the v1 face, nebula, tree or their colours, changes.
  const FACE_V2 = createLightFace(N, R, gauss);
  return { N, I, FEATURE_END, P1, P2, P3, P4, PH, RATE, FACE, COL, FACE_COL, NEB, NEB_COL, TREE, TREE_COL, SIZE, EYE_X, EYE_Y, EYE_Z, surfZ, FACE_V2 };
}

// Light suggests the surface: an open rim, cheek sweeps and a few contour dots.
// All random state is supplied by createShapes; this design has no side effects.
function createLightFace(N, R, gauss) {
  const I = {};
  let cursor = 0;
  for (const [name, share] of [
    ['mouth', 0.20], ['eyeL', 0.05], ['eyeR', 0.05],
    ['browL', 0.02], ['browR', 0.02], ['rim', 0.25],
    ['nose', 0.03], ['interior', 0.15]
  ]) I[name] = [cursor, cursor += Math.round(N * share)];
  I.halo = [cursor, N];
  const FEATURE_END = I.browR[1];
  // Arc, ribbon thickness, roll and seam profile: evaluated once, then animated.
  const LIP = new Float64Array((I.mouth[1] - I.mouth[0]) * 4);
  const FACE = new Float32Array(N * 3), FACE_COL = new Float32Array(N * 3);
  const P1 = new Float32Array(N), P2 = new Float32Array(N);
  const P3 = new Float32Array(N), P4 = new Float32Array(N);
  const EYE_X = 0.84, EYE_Y = 0.52;

  function widthAt(y) {
    const v = (y - 0.08) / 2.8;
    const taper = 1 - 0.27 * Math.pow(Math.max(0, Math.min(1, (-y - 0.35) / 2.37)), 0.8);
    return 1.86 * Math.sqrt(Math.max(0, 1 - v * v)) * taper;
  }
  function surfZ(x, y) {
    const width = widthAt(y);
    if (width < 0.001) return 0;
    const v = (y - 0.08) / 2.8, u = x / width;
    // A shallow smooth light volume, without sockets, nostrils or skin anatomy.
    return 1.83 * Math.sqrt(Math.max(0, 1 - v * v)) *
      Math.sqrt(Math.max(0, 1 - u * u));
  }
  function place(i, x, y, z) {
    const j = i * 3;
    FACE[j] = x; FACE[j + 1] = y; FACE[j + 2] = z;
  }
  function colour(i, light, warmth = 0) {
    const j = i * 3;
    // Cool pearl throughout; the mouth alone catches a softly warmer highlight.
    FACE_COL[j] = light * (0.72 + warmth * 0.28);
    FACE_COL[j + 1] = light * (0.86 + warmth * 0.09);
    FACE_COL[j + 2] = light * (1 - warmth * 0.14);
  }
  function frontalLight(x, y) {
    // A broad source above and slightly left keeps the opposite cheek sparse.
    return 0.36 + 0.64 * Math.max(0, Math.min(1, 0.61 + y * 0.13 - x * 0.14));
  }

  for (let i = I.mouth[0]; i < I.mouth[1]; i++) {
    const u = R() * 2 - 1, upper = R() < 0.46 ? 1 : -1;
    const layer = R();
    // Retain a distinct outline and a dim seam between luminous lip volumes.
    // P3 measures across the lip: zero is its meeting line, one its outer edge.
    const depth = layer < 0.21 ? 0.97 + R() * 0.03 :
      layer < 0.30 ? R() * 0.045 : Math.pow(R(), 0.68);
    const jitter = gauss() * 0.004;
    P1[i] = u; P2[i] = upper; P3[i] = depth; P4[i] = jitter;
    const mu = P1[i], lipEdge = Math.max(0, 1 - mu * mu), arc = Math.sqrt(lipEdge);
    const profile = (i - I.mouth[0]) * 4;
    const lipBow = Math.exp(-Math.pow((Math.abs(mu) - 0.30) / 0.20, 2));
    LIP[profile] = arc;
    LIP[profile + 1] = upper > 0 ? arc * (0.105 + 0.095 * lipBow) : 0.225 * Math.pow(lipEdge, 0.8);
    LIP[profile + 2] = 0.08 * Math.sin(P3[i] * Math.PI);
    LIP[profile + 3] = -0.018 * Math.cos(mu * Math.PI) * lipEdge;
    const edge = Math.sqrt(Math.max(0, 1 - u * u));
    const bow = Math.exp(-Math.pow((Math.abs(u) - 0.30) / 0.18, 2));
    const thickness = upper > 0 ? edge * (0.105 + 0.09 * bow) : 0.20 * Math.pow(edge, 0.8);
    const x = u * 0.72 * 1.006;
    const y = -1.38 + 0.05 * 0.32 * u * u + upper * thickness * depth + jitter;
    place(i, x, y, surfZ(x, y) + 0.08 + Math.sin(Math.PI * depth) * 0.11);
    let light = layer < 0.21 ? 0.204 + R() * 0.102 :
      layer < 0.30 ? 0.033 + R() * 0.034 : 0.09 + R() * 0.14;
    light *= 0.48 + 0.52 * Math.pow(edge, 0.45);
    colour(i, light, 0.9);
  }

  for (const side of [-1, 1]) {
    const eye = side < 0 ? I.eyeL : I.eyeR;
    for (let i = eye[0]; i < eye[1]; i++) {
      const u = R() * 2 - 1, glow = R() < 0.66 ? 1 : 0;
      const depth = glow ? Math.pow(R(), 0.65) : gauss() * 0.005;
      const jitter = gauss() * 0.004;
      P1[i] = u; P2[i] = glow; P3[i] = depth; P4[i] = jitter;
      const almond = Math.pow(Math.max(0, 1 - u * u), 0.8);
      const x = side * EYE_X + u * 0.47;
      const y = EYE_Y + u * side * 0.035 + almond * (glow ? 0.10 - depth * 0.17 : 0.14) + jitter;
      place(i, x, y, surfZ(x, y) + 0.045);
      const light = glow ? (0.018 + R() * 0.07) * (1 - depth * 0.55) : 0.18 + R() * 0.16;
      colour(i, light * (0.4 + 0.6 * almond), 0.2);
    }
    const brow = side < 0 ? I.browL : I.browR;
    for (let i = brow[0]; i < brow[1]; i++) {
      const u = R(), jitter = gauss() * 0.008;
      P1[i] = u; P2[i] = jitter;
      const x = side * (0.34 + 1.02 * u);
      const y = 1.13 + 0.14 * Math.sin(Math.PI * u) - u * 0.04 + jitter;
      place(i, x, y, surfZ(x, y) + 0.025);
      colour(i, (0.044 + R() * 0.075) * (0.3 + 0.7 * Math.sin(Math.PI * u)) * 1.3, 0.08);
    }
  }

  for (let i = I.rim[0]; i < I.rim[1]; i++) {
    const side = R() < 0.5 ? -1 : 1, kind = R();
    const core = R() < 0.28;
    const spread = core ? 0.009 : 0.035 + R() * 0.055;
    let x, y, z, light;
    if (kind < 0.64) {
      // Both sides join in one small rounded chin; no line closes the crown.
      const t = R() * 2.25;
      y = 0.08 - 2.8 * Math.cos(t);
      x = side * widthAt(y) * (0.986 - Math.abs(gauss()) * spread);
      y += gauss() * spread * 0.45;
      z = surfZ(x, y);
      light = core ? 0.22 + R() * 0.15 : 0.025 + R() * 0.068;
      // Temples gradually become particles rather than ending in a hard cap.
      light *= 1 - Math.max(0, y - 0.85) * 0.46;
    } else if (kind < 0.93) {
      // A cheekbone catches one sweeping stroke, flowing up into the temple.
      const u = R(), band = R() < 0.72 ? 0 : 1;
      x = side * (0.62 + 0.98 * u + band * 0.045) + gauss() * spread;
      y = -0.42 + 0.31 * u + 0.16 * Math.sin(Math.PI * u) - band * 0.08 + gauss() * spread * 0.65;
      z = surfZ(x, y) + 0.025;
      light = (core ? 0.14 + R() * 0.15 : 0.018 + R() * 0.05) * Math.sin(Math.PI * (0.08 + u * 0.84));
    } else {
      // Faint broken accents at the temples merge into the escaping head light.
      const u = R();
      y = 0.55 + 1.55 * u;
      x = side * widthAt(y) * (0.88 + 0.035 * u) + gauss() * spread;
      z = surfZ(x, y) + gauss() * 0.03;
      light = (0.02 + R() * 0.07) * (1 - u * 0.65);
    }
    place(i, x, y, z);
    colour(i, light * frontalLight(x, y) * 3);
  }

  for (let i = I.nose[0]; i < I.nose[1]; i++) {
    const u = R(), glint = R() < 0.21;
    const y = 0.91 - 1.58 * u;
    const x = -0.065 - 0.042 * Math.sin(Math.PI * u) + gauss() * (glint ? 0.007 : 0.027);
    place(i, x, y, surfZ(x, y) + 0.025);
    const taper = Math.pow(Math.sin(Math.PI * u), 0.7);
    colour(i, (glint ? 0.105 + R() * 0.08 : 0.013 + R() * 0.038) * taper * 1.6);
  }

  for (let i = I.interior[0]; i < I.interior[1]; i++) {
    const side = R() < 0.5 ? -1 : 1, region = R();
    P4[i] = R() * 0.9; // Seeded membership for the live density control.
    // Each short dotted segment bends with a cheek, forehead or chin plane.
    // The centres of the face stay mostly empty; there are no latitude rings.
    const u = (Math.floor(R() * 58) + R() * 0.18) / 58;
    let x, y, light;
    if (region < 0.56) {
      const band = Math.floor(R() * 7);
      x = side * (0.50 + u * 1.03);
      y = -0.59 - band * 0.09 + 0.42 * u + 0.14 * Math.sin(Math.PI * u);
      light = (0.014 + R() * 0.045) * (0.3 + 0.7 * Math.sin(Math.PI * u));
    } else if (region < 0.79) {
      const band = Math.floor(R() * 6);
      x = side * (0.17 + u * 1.25);
      y = 1.49 + band * 0.14 + 0.15 * Math.sin(Math.PI * u) - u * u * 0.15;
      light = (0.012 + R() * 0.045) * (1 - band * 0.12);
    } else {
      const band = Math.floor(R() * 5);
      x = side * u * (0.75 - band * 0.064);
      y = -1.83 - band * 0.12 + u * u * 0.16;
      light = 0.012 + R() * 0.028;
    }
    x += gauss() * 0.012; y += gauss() * 0.006;
    place(i, x, y, surfZ(x, y) + 0.008);
    colour(i, light * frontalLight(x, y) * 3);
  }

  for (let i = I.halo[0]; i < I.halo[1]; i++) {
    const side = R() < 0.5 ? -1 : 1, kind = R();
    const escape = Math.pow(R(), 1.65);
    let x, y, z;
    if (kind < 0.57) {
      // Released points leave the temples and crown, receding into the back.
      const angle = 0.28 + R() * 1.48;
      y = 0.08 + Math.cos(angle) * 2.8;
      x = side * widthAt(y) * (0.83 + R() * 0.24);
      z = surfZ(x, y) * (0.24 + R() * 0.5);
      x += side * escape * (0.12 + R() * 0.72);
      y += escape * (0.08 + R() * 0.68);
      z -= escape * (0.35 + R() * 1.0);
    } else {
      // A broad, uneven rear cloud replaces the v1 orbital hoop entirely.
      const angle = R() * Math.PI * 2;
      const radius = 2.1 + escape * 1.35;
      x = Math.cos(angle) * radius * 0.91 + gauss() * 0.14;
      y = 0.3 + Math.sin(angle) * radius * 0.88 + gauss() * 0.16;
      z = -0.38 - R() * 1.8 - escape * 0.5;
    }
    place(i, x, y, z);
    // Motion contract: P1 phase; P2 drift amplitude; P3 angular speed;
    // P4 escape fraction (zero is attached, one has dissolved into the halo).
    P1[i] = R() * Math.PI * 2;
    P2[i] = 0.035 + escape * 0.145;
    P3[i] = 0.12 + R() * 0.14;
    P4[i] = escape;
    const sparkle = R() < 0.024;
    const light = (sparkle ? 0.16 + R() * 0.12 : 0.015 + R() * 0.057) * (1 - escape * 0.62);
    colour(i, light * (sparkle ? 3.4 : 5.1));
  }

  // These snapshots are read-only sources for live colour tuning and drift.
  const BASE = new Float32Array(FACE), BASE_COL = new Float32Array(FACE_COL);
  return { version: 'v2', I, FEATURE_END, P1, P2, P3, P4, LIP, FACE, BASE, FACE_COL, BASE_COL, EYE_X, EYE_Y, surfZ };
}
