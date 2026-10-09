// A single analytic particle body: a layered living bell, luminous canals and
// flexible trailing filaments. Construction and seeking share no global state.
const TAU = Math.PI * 2;

function rngFrom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createJellyfish(N, reduce = false) {
  if (!Number.isInteger(N) || N < 0) throw new RangeError('Particle count must be a nonnegative integer.');
  const R = rngFrom(0x6A656C6C);
  const positions = new Float32Array(N * 3), colours = new Float32Array(N * 3);
  const local = new Float32Array(N * 3), tint = new Float32Array(N * 3);
  const kind = new Uint8Array(N), output = new Uint32Array(N);
  const light = new Float32Array(N), extent = new Float32Array(N);
  // Angular and longitudinal waves are factored at construction. Animation has
  // no per-particle trigonometry, sorting, allocations or numerical integration.
  const waves = new Float32Array(N * 6);
  const bellEnd = Math.floor(N * .40), rimEnd = Math.floor(N * .54);
  const canalEnd = Math.floor(N * .61), organEnd = Math.floor(N * .64);
  const armEnd = Math.floor(N * .76), filamentEnd = Math.floor(N * .97);
  const densityGain = N < 32000 ? Math.sqrt(32000 / Math.max(9000, N)) : 1;
  const scatter = () => R() + R() + R() - 1.5;
  for (let i = 0; i < N; i++) output[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const q = Math.floor(R() * (i + 1)), tmp = output[i];
    output[i] = output[q]; output[q] = tmp;
  }

  for (let i = 0; i < N; i++) {
    const j = i * 3, w = i * 6;
    let angle = R() * TAU, u = R();
    if (i < bellEnd || (i >= rimEnd && i < canalEnd)) {
      const canal = i >= rimEnd;
      kind[i] = canal ? 2 : 0;
      // Surface area sampling spreads material over the dome instead of
      // concentrating it in a bright ball at its pole. Thin secondary sheets
      // and broad shaded gaps let the bell read as translucent, not solid.
      if (canal) angle = (i % 12) * TAU / 12 + scatter() * .010;
      const height = .035 + u * .965;
      let radial = Math.sqrt(1 - height * height);
      const layer = canal ? .985 : .94 + R() * .064;
      radial *= 1.72 * layer * (.9 + radial * .1);
      radial *= 1 + .020 * Math.cos(angle * 12);
      local[j] = radial * Math.cos(angle);
      local[j + 1] = .58 + height * 1.53 * layer;
      local[j + 2] = radial * Math.sin(angle) * .74;
      extent[i] = 1 - height;
      if (canal) {
        light[i] = .11 + R() * .14;
        tint[j] = .98; tint[j + 1] = .66 + height * .20; tint[j + 2] = .38 + height * .23;
      } else {
        const cell = .5 + .5 * Math.cos(angle * 12 + height * 9);
        const veil = .48 + .52 * cell * cell;
        light[i] = (.102 + R() * .381) * veil;
        // The upper membrane carries warm pearl. Teal and violet emerge lower
        // down and along its far side, keeping colour attached to anatomy.
        const warm = Math.min(1, Math.max(0, (height - .12) * 1.4));
        const lilac = .5 + .5 * Math.cos(angle * 2 - height * 3);
        tint[j] = (.22 + lilac * .32) * (1 - warm) + warm;
        tint[j + 1] = (.72 - lilac * .22) * (1 - warm) + .69 * warm;
        tint[j + 2] = .96 * (1 - warm) + .55 * warm;
      }
    } else if (i < rimEnd) {
      kind[i] = 1;
      // Rolled scalloped edge: two fine luminous lips enclose a softer ruffle.
      const lane = i % 3, section = R() * TAU;
      const radius = 1.68 + Math.cos(section) * (lane === 0 ? .021 : .065);
      local[j] = radius * Math.cos(angle);
      local[j + 1] = .58 + Math.sin(section) * .055 + (lane - 1) * .047;
      local[j + 2] = radius * Math.sin(angle) * .74;
      extent[i] = 1;
      light[i] = lane === 0 ? .17 + R() * .20 : .055 + R() * .09;
      const warm = .62 + .28 * Math.sin(angle * 2 + .6);
      tint[j] = .48 + warm * .50; tint[j + 1] = .88 - warm * .10; tint[j + 2] = 1 - warm * .50;
    } else if (i < organEnd) {
      kind[i] = 3;
      // Four small folded energy chambers hang inside the bell. Their hollow
      // lobes leave dark space between them rather than whitening its centre.
      const lobe = i % 4, a = lobe * TAU / 4 + .4;
      const radius = .10 + .09 * R();
      local[j] = .32 * Math.cos(a) + Math.cos(angle) * radius;
      local[j + 1] = .65 + u * .65 + scatter() * .026;
      local[j + 2] = .25 * Math.sin(a) + Math.sin(angle) * radius * .7;
      extent[i] = u;
      light[i] = .15 + R() * .30;
      tint[j] = 1; tint[j + 1] = .49 + u * .24; tint[j + 2] = .27 + u * .22;
    } else if (i < filamentEnd) {
      const arm = i < armEnd;
      kind[i] = arm ? 4 : 5;
      const strand = arm ? i % 5 : i % 22;
      angle = arm ? strand * TAU / 5 + .28 : strand * TAU / 22;
      const rootRadius = arm ? .48 : 1.54;
      const length = arm ? 2.10 + .21 * Math.sin(strand * 2.7) : 2.65 + .62 * (.5 + .5 * Math.sin(strand * 2.3));
      const wave = u * (arm ? 12 : 7.5) + angle * 1.9;
      const ribbon = arm ? (R() * 2 - 1) * (.09 + .10 * u) : scatter() * (.010 + (1 - u) * .017);
      const fan = arm ? .18 : .20;
      const radius = rootRadius + fan * Math.sin(u * Math.PI) - .24 * u * u;
      local[j] = radius * Math.cos(angle) + ribbon * Math.cos(wave);
      local[j + 1] = .53 - length * u + (arm ? ribbon * Math.sin(wave) : scatter() * .007);
      local[j + 2] = radius * Math.sin(angle) * .74 + ribbon * Math.sin(wave);
      extent[i] = u;
      const pearl = Math.pow(.5 + .5 * Math.cos(u * 24 - angle * 2), 6);
      light[i] = arm ? (.084 + R() * .173) * (1 - .30 * u) : (.132 + R() * .215 + pearl * .215) * (1 - .46 * u);
      const lilac = .5 + .5 * Math.sin(angle * 2 + u * 2);
      const warm = arm ? Math.max(0, 1 - u * 2.4) : Math.max(0, 1 - u * 5) * .7;
      tint[j] = (.24 + lilac * .42) * (1 - warm) + .98 * warm;
      tint[j + 1] = (.87 - lilac * .30) * (1 - warm) + .68 * warm;
      tint[j + 2] = .98 * (1 - warm) + .41 * warm;
      // Two travelling waves share each strand's phase. Tips trail more than
      // roots, so motion travels down the body rather than moving rigid rods.
      waves[w] = Math.sin(u * 5.2 + angle * 1.9);
      waves[w + 1] = Math.cos(u * 5.2 + angle * 1.9);
      waves[w + 2] = Math.sin(u * 9.4 - angle * 1.3);
      waves[w + 3] = Math.cos(u * 9.4 - angle * 1.3);
      waves[w + 4] = Math.sin(u * 2.7);
      waves[w + 5] = Math.cos(u * 2.7);
      continue;
    } else {
      kind[i] = 6;
      const radius = .6 + R() * 1.35;
      local[j] = Math.cos(angle) * radius;
      local[j + 1] = -2.4 + u * 4.5;
      local[j + 2] = Math.sin(angle) * radius * .7;
      extent[i] = u;
      light[i] = .002 + R() * .010;
      tint[j] = .40; tint[j + 1] = .65; tint[j + 2] = .89;
    }
    waves[w] = Math.sin(angle * 6);
    waves[w + 1] = Math.cos(angle * 6);
    waves[w + 2] = Math.sin(angle * 11 + u * 3);
    waves[w + 3] = Math.cos(angle * 11 + u * 3);
    waves[w + 4] = Math.sin(angle * 2 + u * 4);
    waves[w + 5] = Math.cos(angle * 2 + u * 4);
  }

  function update(clock) {
    const t = reduce || !Number.isFinite(clock) ? 0 : clock;
    const beatS = Math.sin(t * 1.65), beatC = Math.cos(t * 1.65);
    const beat = .5 + .5 * beatS, squeeze = beat * beat * beat;
    const radiusScale = 1 - .04 * squeeze, heightScale = 1 + .03 * squeeze;
    const rippleS = Math.sin(t * 1.2), rippleC = Math.cos(t * 1.2);
    const waveS = Math.sin(t * 1.35), waveC = Math.cos(t * 1.35);
    const curlS = Math.sin(t * 1.08), curlC = Math.cos(t * 1.08);
    const lightS = Math.sin(t * .83), lightC = Math.cos(t * .83);
    // Locomotion bends and orients the body along its direction of travel.
    // Keep the local long axis upright so its head and trailing slices agree.
    const yaw = .12 * Math.sin(t * .19), cy = Math.cos(yaw), sy = Math.sin(yaw);
    for (let i = 0; i < N; i++) {
      const j = i * 3, out = output[i] * 3, w = i * 6, k = kind[i], u = extent[i];
      let x = local[j], y = local[j + 1], z = local[j + 2];
      let intensity = light[i];
      if (k <= 2) {
        const ripple = waves[w] * rippleC - waves[w + 1] * rippleS;
        const fine = waves[w + 2] * curlC - waves[w + 3] * curlS;
        const width = radiusScale + (ripple * .025 + fine * .009) * u * u;
        x *= width; z *= width;
        y = .58 + (y - .58) * heightScale + (.065 * ripple + .022 * fine) * u * u;
        intensity *= .85 + .15 * (z / 1.4 + 1) * .5;
        if (k === 2) intensity *= 1 + .25 * squeeze;
      } else if (k === 3) {
        x *= 1 - .09 * squeeze; z *= 1 - .09 * squeeze;
        y += .06 * squeeze * (1 - u);
        intensity *= 1 + .22 * squeeze;
      } else if (k <= 5) {
        const wave = waves[w] * waveC - waves[w + 1] * waveS;
        const curl = waves[w + 2] * curlC - waves[w + 3] * curlS;
        const lag = waves[w + 5] * beatS - waves[w + 4] * beatC;
        const amplitude = u * (.06 + u * .22);
        x *= 1 - .04 * squeeze * (1 - u);
        z *= 1 - .04 * squeeze * (1 - u);
        x += wave * amplitude + curl * .07 * u * u;
        z += curl * amplitude * .66;
        y += .075 * lag * u + .04 * wave * u * u;
        intensity *= .94 + .13 * wave;
      } else {
        x += .025 * (waves[w] * waveC - waves[w + 1] * waveS);
        y += .035 * (waves[w + 2] * curlC - waves[w + 3] * curlS);
      }
      const turnedX = x * cy + z * sy;
      positions[out] = turnedX;
      positions[out + 1] = y;
      positions[out + 2] = -x * sy + z * cy;
      const shimmer = 1 + .09 * (waves[w + 4] * lightC - waves[w + 5] * lightS);
      intensity *= shimmer * densityGain;
      colours[out] = Math.min(.94, tint[j] * intensity);
      colours[out + 1] = Math.min(.94, tint[j + 1] * intensity);
      colours[out + 2] = Math.min(.94, tint[j + 2] * intensity);
    }
  }
  update(0);
  return { positions, colours, update, bounds: { radius: 3.75 }, inlet: new Float32Array([-.5, .8, .08]) };
}
