import { sampleScalar, sampleRGB } from './facesample.js';
import { faceField, protectionWeight } from './facefield.js';

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

export function createShapes(N, maps = null) {
  const R = rngFrom(7);
  function gauss() {
    let u = 0;
    while (!u) u = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R());
  }

  const eyeCount = Math.round(N * 0.035), browCount = Math.round(N * 0.016);
  const mouthCount = Math.round(N * 0.045), haloCount = Math.round(N * 0.12);
  const mouthStart = 2 * (eyeCount + browCount), mouthEnd = mouthStart + mouthCount;
  const shellCount = N - mouthEnd - haloCount;
  const PH = new Float32Array(N), RATE = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    PH[i] = R() * Math.PI * 2;
    RATE[i] = 0.016 + R() * 0.05;
  }

  // Consume the removed v1 face's draws in order to preserve the nebula, tree and sizes.
  const shellAngle = new Float64Array(shellCount);
  for (let i = 0; i < shellCount; i++) {
    shellAngle[i] = (R() * 2 - 1) * 1.95;
    gauss();
  }
  for (let i = 0; i < 2 * eyeCount; i++) { R(); R(); gauss(); }
  for (let i = 0; i < 2 * browCount; i++) { R(); gauss(); }
  for (let i = 0; i < mouthCount; i++) { R(); R(); gauss(); }
  for (let i = 0; i < haloCount; i++) { R(); gauss(); gauss(); R(); R(); }

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
  let idx = 0;
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
    const feature = i < 2 * eyeCount || (i >= mouthStart && i < mouthEnd);
    SIZE[i] = feature ? 1.15 : R() < 0.03 ? 1.6 + R() : 0.8 + R() * 0.4;
  }

  for (const th of shellAngle) {
    const edge = 1 - Math.pow(1 - Math.abs(th) / 1.95, 0.62);
    if (R() < Math.max(0, (edge - 0.58) / 0.42) * 0.62) {
      R(); gauss(); gauss();
    }
  }

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

  const FACE_V3 = maps ? createMapFace(N, maps) : null;
  return { N, PH, RATE, NEB, NEB_COL, TREE, TREE_COL, SIZE, FACE_V3 };
}

// A jittered population keeps continuous facial coverage while broad noise and
// image light collect stars into irregular patches. Features still come only
// from image sampling; protected regions retain enough points to animate cleanly.
function createMapFace(N, maps) {
  const R = rngFrom(3307), count = Math.round(N * 0.75), MAP_SCALE = 7.2;
  const filamentEnd = count + Math.round((N - count) * 0.9);
  const I = { face: [0, count], filaments: [count, filamentEnd], halo: [count, N] };
  const FACE = new Float32Array(N * 3), FACE_COL = new Float32Array(N * 3);
  const UV = new Float32Array(N * 2), MAP_DEPTH = new Float32Array(N);
  const DENSITY_RANDOM = new Float32Array(N), SPARK_RANDOM = new Float32Array(N);
  const STAR_SIZE = new Float32Array(N), STAR_TINT = new Float32Array(N * 3);
  const FIELD = new Float32Array(N), PROTECT = new Float32Array(N);
  const P1 = new Float32Array(N), P2 = new Float32Array(N);
  const P3 = new Float32Array(N), P4 = new Float32Array(N);
  const colourWork = new Float32Array(3), rootColour = new Float32Array(3);
  function densityAt(u, v, field, protect) {
    sampleRGB(maps.colour, u, v, colourWork);
    const luminance = colourWork[0] * 0.2126 + colourWork[1] * 0.7152 + colourWork[2] * 0.0722;
    const uneven = 0.36 + field * 0.46 + Math.sqrt(luminance) * 0.18;
    return sampleScalar(maps.mask, u, v) * Math.max(uneven, protect * 0.95);
  }
  function star(i, warmth = 0.5) {
    const j = i * 3, size = R(), tint = R();
    STAR_SIZE[i] = size < 0.006 ? 3 + R() * 3
      : size < 0.13 ? 1 + R() : 0.35 + R() * 0.5;
    let red, green, blue;
    if (tint < 0.13 + warmth * 0.19) {
      red = 1; green = 0.45 + R() * 0.27; blue = 0.20 + R() * 0.18;
    } else if (tint < 0.58) {
      red = 1; green = 0.9 + R() * 0.1; blue = 0.84 + R() * 0.16;
    } else if (tint < 0.90) {
      red = 0.48 + R() * 0.20; green = 0.74 + R() * 0.16; blue = 1;
    } else {
      red = 0.64 + R() * 0.20; green = 0.33 + R() * 0.18; blue = 1;
    }
    STAR_TINT[j] = red; STAR_TINT[j + 1] = green; STAR_TINT[j + 2] = blue;
    DENSITY_RANDOM[i] = R(); SPARK_RANDOM[i] = R();
  }
  let coverage = 0;
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const u = (x + 0.5) / 96, v = (y + 0.5) / 96;
      coverage += densityAt(u, v, faceField(u, v), protectionWeight(u, v, maps.landmarks));
    }
  }
  coverage /= 96 * 96;
  if (!(coverage > 0)) throw new Error('Cannot place a face on an empty mask');
  let cells = Math.ceil(Math.sqrt(count / coverage * 1.04)), candidates;
  do {
    candidates = [];
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const u = (x + 0.08 + R() * 0.84) / cells;
        const v = (y + 0.08 + R() * 0.84) / cells;
        const field = faceField(u, v), protect = protectionWeight(u, v, maps.landmarks);
        const density = densityAt(u, v, field, protect);
        if (density > 0.0001) candidates.push({ u, v, field, protect, priority: R() / density });
      }
    }
    if (candidates.length < count) cells = Math.ceil(cells * 1.15);
  } while (candidates.length < count);
  // A common threshold retains exact count and soft mask thinning. Even the
  // darkest noise trough has substantial occupancy, so there are no large holes.
  candidates.sort((a, b) => a.priority - b.priority);
  candidates.length = count;
  // Random membership avoids scan-order formation bands and keeps live density
  // and sparkle controls spatially even without changing the sampled plate.
  for (let i = count - 1; i > 0; i--) {
    const k = Math.floor(R() * (i + 1)), temp = candidates[i];
    candidates[i] = candidates[k]; candidates[k] = temp;
  }
  for (let i = 0; i < count; i++) {
    const { u, v, field, protect } = candidates[i], j = i * 3;
    UV[i * 2] = u; UV[i * 2 + 1] = v;
    FIELD[i] = field; PROTECT[i] = protect;
    MAP_DEPTH[i] = sampleScalar(maps.depth, u, v);
    FACE[j] = (u - 0.5) * MAP_SCALE;
    FACE[j + 1] = (0.5 - v) * MAP_SCALE;
    FACE[j + 2] = (MAP_DEPTH[i] - 0.5) * 1.6;
    sampleRGB(maps.colour, u, v, FACE_COL, j);
    star(i, FACE_COL[j] / Math.max(0.001, FACE_COL[j] + FACE_COL[j + 2]));
    P1[i] = R() * Math.PI * 2;
  }

  // Find actual map coverage crossings, then start just inside them. Separate
  // top, jaw and side roots prevent a formulaic oval or a contour-following rim.
  function findRoot(kind, side) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const fixed = kind === 0 ? 0.25 + R() * 0.50
        : kind === 1 ? 0.13 + R() * 0.74 : 0.12 + R() * 0.69;
      for (let step = 0; step < 256; step++) {
        const along = (step + 0.5) / 256;
        let u = fixed, v = kind === 0 ? 1 - along : along;
        if (kind === 2) { u = side < 0 ? along : 1 - along; v = fixed; }
        if (sampleScalar(maps.mask, u, v) >= 0.30) {
          const inward = 0.005 + R() * 0.035;
          if (kind === 0) v -= inward;
          else if (kind === 1) v += inward;
          else u -= side * inward;
          return { u, v };
        }
      }
    }
    return { u: 0.5, v: kind === 0 ? 0.87 : 0.10 };
  }
  const strands = Math.max(42, Math.round(Math.sqrt(N) * 0.72));
  const FLOW_STEPS = 64;
  const FLOW_PATHS = new Float32Array(strands * 3 * (FLOW_STEPS + 1) * 4);
  const FLOW_IDS = new Uint16Array(N), FLOW_PHASE = new Float32Array(N);
  const FLOW_RATE = new Float32Array(N), FLOW_OFFSET = new Float32Array(N * 3);
  let cursor = count;
  for (let strand = 0; strand < strands; strand++) {
    const amount = Math.round((filamentEnd - cursor) / (strands - strand));
    const region = R(), kind = region < 0.42 ? 0 : region < 0.67 ? 1 : 2;
    const side = R() < 0.5 ? -1 : 1, root = findRoot(kind, side);
    const rx = (root.u - 0.5) * MAP_SCALE, ry = (0.5 - root.v) * MAP_SCALE;
    const rz = (sampleScalar(maps.depth, root.u, root.v) - 0.5) * 1.6;
    sampleRGB(maps.colour, root.u, root.v, rootColour);
    const peak = Math.max(rootColour[0], rootColour[1], rootColour[2], 0.05);
    const warmth = rootColour[0] / Math.max(0.001, rootColour[0] + rootColour[2]);
    let ox = kind === 2 ? side : (root.u - 0.5) * (kind === 0 ? 1.4 : 0.9);
    let oy = kind === 0 ? -1 : kind === 1 ? 1 : (0.48 - root.v) * 0.55;
    const magnitude = Math.hypot(ox, oy); ox /= magnitude; oy /= magnitude;
    const length = kind === 0 ? 1.8 + Math.pow(R(), 0.7) * 4.4
      : kind === 1 ? 1.3 + R() * 3.5 : 1.0 + R() * 2.8;
    const curl = (R() < 0.5 ? -1 : 1) * (0.34 + R() * 0.66) * length;
    const phase = R() * Math.PI * 2, frequency = 0.75 + R() * 1.2;
    const speed = 0.014 + R() * 0.012, depthCurl = (R() - 0.5) * 0.8;
    const fork = 0.19 + R() * 0.19;
    // Three precomputed daughter paths share a broad root, then separate into
    // finer curls. Animation only interpolates these tables: no per-star noise.
    for (let branch = 0; branch < 3; branch++) {
      const branchSide = branch - 1, pathStart = (strand * 3 + branch) * (FLOW_STEPS + 1) * 4;
      for (let step = 0; step <= FLOW_STEPS; step++) {
        const t = step / FLOW_STEPS, q = Math.max(0, (t - 0.44) / 0.56);
        const split = q * q * (3 - 2 * q);
        const radial = length * (t * 0.62 + t * t * 0.38);
        const bend = curl * t * (Math.sin(phase + t * Math.PI * frequency) - Math.sin(phase)) * 0.62
          + branchSide * length * fork * split * (0.76 + 0.24 * Math.sin(t * 4.5 + phase));
        const p = pathStart + step * 4;
        FLOW_PATHS[p] = rx + ox * radial - oy * bend;
        FLOW_PATHS[p + 1] = ry + oy * radial + ox * bend;
        FLOW_PATHS[p + 2] = rz - t * 0.6 + depthCurl * Math.sin(t * Math.PI)
          + branchSide * split * 0.19;
        FLOW_PATHS[p + 3] = (0.065 + Math.sin(t * Math.PI) * 0.10) * (1 - split * 0.70);
      }
    }
    for (let k = 0; k < amount; k++, cursor++) {
      const i = cursor, j = i * 3;
      const flowPhase = R(), t = flowPhase * (0.65 + flowPhase * 0.35);
      const path = strand * 3 + Math.floor(R() * 3);
      FLOW_IDS[i] = path; FLOW_PHASE[i] = flowPhase; FLOW_RATE[i] = speed;
      const across = R() + R() - 1, along = (R() - 0.5) * 0.65;
      FLOW_OFFSET[j] = ox * along - oy * across;
      FLOW_OFFSET[j + 1] = oy * along + ox * across;
      FLOW_OFFSET[j + 2] = (R() - 0.5) * 1.5;
      const sample = t * FLOW_STEPS, lower = Math.min(FLOW_STEPS - 1, Math.floor(sample));
      const blend = sample - lower, p = (path * (FLOW_STEPS + 1) + lower) * 4;
      const spread = FLOW_PATHS[p + 3] + (FLOW_PATHS[p + 7] - FLOW_PATHS[p + 3]) * blend;
      for (let c = 0; c < 3; c++) {
        FACE[j + c] = FLOW_PATHS[p + c] + (FLOW_PATHS[p + c + 4] - FLOW_PATHS[p + c]) * blend
          + FLOW_OFFSET[j + c] * spread;
      }
      UV[i * 2] = root.u; UV[i * 2 + 1] = root.v;
      FIELD[i] = faceField(root.u + t * ox * 0.18, root.v - t * oy * 0.18);
      star(i, warmth);
      const rootMix = 0.28;
      const light = (0.16 + peak * 0.50 + R() * 0.22) * 2.88 * (0.66 + FIELD[i] * 0.55);
      for (let c = 0; c < 3; c++) {
        const tint = STAR_TINT[j + c] * (1 - rootMix) + rootColour[c] / peak * rootMix;
        FACE_COL[j + c] = tint * light;
      }
      P1[i] = phase;
      P2[i] = 0.012 + t * t * (0.10 + length * 0.023);
      P3[i] = speed;
      P4[i] = t;
    }
  }
  for (let i = filamentEnd; i < N; i++) {
    const j = i * 3, escape = R();
    FACE[j] = (R() + R() - 1) * 6.1;
    FACE[j + 1] = (R() + R() - 1) * 7.7;
    FACE[j + 2] = -0.35 - R() * 2.7;
    FIELD[i] = R(); star(i);
    const light = (0.09 + R() * 0.22) * (1 - escape * 0.42);
    FACE_COL[j] = STAR_TINT[j] * light;
    FACE_COL[j + 1] = STAR_TINT[j + 1] * light;
    FACE_COL[j + 2] = STAR_TINT[j + 2] * light;
    P1[i] = R() * Math.PI * 2;
    P2[i] = 0.05 + escape * 0.14;
    P3[i] = 0.05 + R() * 0.09;
    P4[i] = escape;
    FLOW_PHASE[i] = R(); FLOW_RATE[i] = 0.010 + R() * 0.010;
    const radius = Math.hypot(FACE[j], FACE[j + 1]) || 1;
    FLOW_OFFSET[j] = FACE[j] / radius * (0.35 + escape * 0.65);
    FLOW_OFFSET[j + 1] = FACE[j + 1] / radius * (0.35 + escape * 0.65);
    FLOW_OFFSET[j + 2] = (R() - 0.5) * 0.5;
  }
  // A handful of additional beacons live away from eyes and lips. This does
  // not change particle count or the size attributes used by other forms.
  const extraStars = Math.max(2, Math.round(N * 0.0005));
  for (let n = 0; n < extraStars; n++) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const i = Math.floor(R() * N);
      if (PROTECT[i] > 0.08 || STAR_SIZE[i] >= 3) continue;
      STAR_SIZE[i] = 5.1 + R() * 0.9;
      break;
    }
  }
  const BASE = new Float32Array(FACE), BASE_COL = new Float32Array(FACE_COL);
  const CORE_LOOP = new Float32Array(count * 6), CORE_GROUP = new Uint8Array(count);
  const CORE_EDGE = new Float32Array(count), detached = [], departures = [];
  const edgeStars = [], edgePaths = [];
  for (let i = 0; i < count; i++) {
    const u = UV[i * 2], v = UV[i * 2 + 1], k = i * 6;
    const left = sampleScalar(maps.mask, u - 0.018, v), right = sampleScalar(maps.mask, u + 0.018, v);
    const top = sampleScalar(maps.mask, u, v - 0.018), bottom = sampleScalar(maps.mask, u, v + 0.018);
    const edge = 1 - Math.min(left, right, top, bottom), free = 1 - PROTECT[i];
    CORE_EDGE[i] = edge;
    const amplitude = 0.0008 + free * free * (0.004 + FIELD[i] * 0.005 + edge * 0.022);
    const phase = R() * Math.PI * 2, angle = R() * Math.PI * 2;
    const a = amplitude, b = amplitude * (0.38 + R() * 0.38);
    const cp = Math.cos(phase), sp = Math.sin(phase), ca = Math.cos(angle), sa = Math.sin(angle);
    CORE_LOOP[k] = a * ca * cp - b * sa * sp;
    CORE_LOOP[k + 1] = a * ca * sp + b * sa * cp;
    CORE_LOOP[k + 2] = a * sa * cp + b * ca * sp;
    CORE_LOOP[k + 3] = a * sa * sp - b * ca * cp;
    CORE_LOOP[k + 4] = amplitude * 0.26 * cp;
    CORE_LOOP[k + 5] = amplitude * 0.26 * sp;
    CORE_GROUP[i] = Math.floor(R() * 32);
    const flowingEdge = edge > 0.32 && PROTECT[i] < 0.10 && R() < 0.62;
    // A subset of mask-edge stars travels along short outgoing curls. Their
    // home UV never moves; fade at each end hides the return to the same root.
    if (flowingEdge) {
      let nx = left - right, ny = bottom - top;
      if (Math.hypot(nx, ny) < 0.001) { nx = u - 0.5; ny = 0.5 - v; }
      const length = Math.hypot(nx, ny) || 1;
      nx /= length; ny /= length;
      const distance = 0.16 + edge * 0.42 + R() * 0.12;
      const curl = (R() - 0.5) * 0.35;
      edgeStars.push(i);
      edgePaths.push(nx * distance, ny * distance, -ny * curl, nx * curl, (R() - 0.6) * 0.18);
      FLOW_PHASE[i] = R(); FLOW_RATE[i] = 1 / (24 + R() * 18);
    // Only a few other unprotected edge stars ever depart and return visibly.
    } else if (edge > 0.12 && PROTECT[i] < 0.08 && R() < 0.016) {
      let nx = left - right, ny = bottom - top;
      const length = Math.hypot(nx, ny) || 1;
      nx /= length; ny /= length;
      const distance = 0.35 + R() * 0.85;
      detached.push(i);
      departures.push(R(), 1 / (72 + R() * 75), nx * distance, ny * distance, (R() - 0.5) * 0.5);
    }
  }
  // Paired departures overlap by half their active arc: one star moves out
  // while its partner is already returning. They share a slow period, so the
  // exchange stays continuous without spawning or removing a particle.
  if (detached.length % 2) { detached.pop(); departures.length -= 5; }
  for (let pair = 0; pair < detached.length; pair += 2) {
    const a = pair * 5, b = (pair + 1) * 5;
    departures[b] = (departures[a] + 0.09) % 1;
    departures[b + 1] = departures[a + 1];
  }
  const RECYCLED = new Uint8Array(N);
  const MOTION = {
    CORE_LOOP, CORE_GROUP, CORE_EDGE, DETACH_INDEX: new Uint32Array(detached),
    DETACH_DATA: new Float32Array(departures), EDGE_INDEX: new Uint32Array(edgeStars),
    EDGE_DATA: new Float32Array(edgePaths), FLOW_STEPS, FLOW_PATHS,
    FLOW_IDS, FLOW_PHASE, FLOW_RATE, FLOW_OFFSET
  };
  return {
    I, FEATURE_END: count, FACE_COUNT: count, FACE, BASE, FACE_COL,
    BASE_COL, UV, MAP_DEPTH, DENSITY_RANDOM, SPARK_RANDOM, STAR_SIZE, STAR_TINT,
    FIELD, PROTECT, P1, P2, P3, P4, MOTION, RECYCLED,
    MAPS: maps, MAP_SCALE
  };
}
