// A self-contained, analytic particle target. Its private RNG never advances the
// face/nebula generators; particle membership is scattered for a clean morph.
const TAU = Math.PI * 2;
const BANDS = [
  { a: 3.35, b: 2.72, tilt: 1.02, turn: -.96, phase: .48, speed: .46, colour: [.20, .78, .95] },
  { a: 3.18, b: 2.68, tilt: 1.08, turn: .97, phase: 2.68, speed: -.39, colour: [.63, .77, 1] },
  { a: 3.48, b: 2.57, tilt: 1.04, turn: .06, phase: 4.63, speed: .34, colour: [.57, .34, .95] }
];

function rngFrom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createOrbital(N, reduce = false) {
  if (!Number.isInteger(N) || N < 0) throw new RangeError('Particle count must be a nonnegative integer.');
  const R = rngFrom(0x6F726269);
  // Small-screen pools retain luminous coverage without adding particles.
  const densityGain = N < 32000 ? Math.sqrt(32000 / Math.max(9000, N)) : 1;
  const positions = new Float32Array(N * 3), colours = new Float32Array(N * 3);
  const local = new Float32Array(N * 3), tint = new Float32Array(N * 3);
  const light = new Float32Array(N), phase = new Float32Array(N * 2);
  const kind = new Uint8Array(N), band = new Uint8Array(N), output = new Uint32Array(N);
  const matrix = new Float64Array(27), spin = new Float64Array(12), wave = new Float64Array(6);
  const ringEnd = Math.floor(N * .65), cometEnd = Math.floor(N * .72), coreEnd = Math.floor(N * .94);
  for (let i = 0; i < N; i++) output[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const q = Math.floor(R() * (i + 1)), tmp = output[i];
    output[i] = output[q]; output[q] = tmp;
  }
  // The triangular scatter is bounded, with no rejection loop or extreme tails.
  const scatter = () => R() + R() + R() - 1.5;
  for (let i = 0; i < N; i++) {
    const j = i * 3, b = i % 3, palette = BANDS[b].colour;
    const twinkle = R() * TAU;
    band[i] = b;
    phase[i * 2] = Math.cos(twinkle); phase[i * 2 + 1] = Math.sin(twinkle);
    if (i < cometEnd) {
      const comet = i >= ringEnd;
      kind[i] = comet ? 1 : 0;
      // Continuous fine bands carry a much shorter, denser travelling wake.
      // Negative-speed bands reverse the wake so it always trails its head.
      const lag = comet ? Math.pow(R(), 1.85) * 1.08 : 0;
      const angle = comet ? -Math.sign(BANDS[b].speed) * lag : R() * TAU;
      // Five close filaments give each plane a rich, fine-grained ribbon.
      const lane = (i % 5 - 2) * .012;
      const width = comet ? .014 + lag * .047 : .010 + R() * .012;
      const radial = 1 + (comet ? 0 : lane) + scatter() * width;
      local[j] = Math.cos(angle) * radial;
      local[j + 1] = Math.sin(angle) * radial;
      local[j + 2] = scatter() * (comet ? .029 + lag * .065 : .045) + lane * .8;
      const head = comet ? Math.exp(-lag * 6.5) : 0;
      light[i] = comet ? (.08 + head * .68) * (.8 + R() * .3) : .16 + R() * .34;
      const ice = comet ? .22 + head * .76 : .12 + R() * .18;
      tint[j] = palette[0] + (.91 - palette[0]) * ice;
      tint[j + 1] = palette[1] + (.97 - palette[1]) * ice;
      tint[j + 2] = palette[2] + (1 - palette[2]) * ice;
    } else if (i < coreEnd) {
      kind[i] = 2;
      const region = R();
      if (region < .34) {
        // A tightly packed white-blue heart anchors the much larger corona.
        // Its irregular lobes stay small enough to read as a star, not a ball.
        const lobe = i % 3;
        let x = scatter() * .19 + (lobe === 0 ? -.052 : .035);
        let y = scatter() * .18 + (lobe === 1 ? .038 : -.014);
        let z = scatter() * .17;
        const radius = Math.hypot(x, y, z), limit = .34;
        if (radius > limit) { const scale = limit / radius; x *= scale; y *= scale; z *= scale; }
        local[j] = x; local[j + 1] = y; local[j + 2] = z;
        light[i] = R() < .09 ? .68 + R() * .23 : .22 + R() * .30;
        tint[j] = .76 + R() * .15; tint[j + 1] = .9 + R() * .08; tint[j + 2] = 1;
      } else if (region < .86) {
        // A mottled cyan/violet shell surrounds a visible white nucleus.
        // Bright curled wisps and darker gaps retain detail in additive light.
        const angle = R() * TAU, height = R() * 2 - 1;
        const radius = .28 + .56 * Math.pow(R(), .8), plane = Math.sqrt(1 - height * height);
        const curl = angle + height * 2.4;
        local[j] = radius * plane * Math.cos(curl);
        local[j + 1] = radius * height * .93;
        local[j + 2] = radius * plane * Math.sin(curl) * .9;
        const filament = .4 + .6 * Math.pow(.5 + .5 * Math.sin(angle * 5 + height * 7), 2);
        light[i] = (.08 + R() * .22) * filament * (1.35 - radius * .7);
        const violet = .5 + .5 * Math.sin(angle * 2 + height * 3);
        tint[j] = .20 + violet * .40;
        tint[j + 1] = .89 - violet * .43;
        tint[j + 2] = 1;
      } else {
        // Short, narrow radial filaments taper to luminous needle tips.
        // Slightly different depths keep the star dimensional while it turns.
        const ray = i % 12, angle = ray * TAU / 12 + .13;
        const progress = Math.pow(R(), .7), radius = .25 + progress * .83;
        const width = .004 + (1 - progress) * .021;
        local[j] = Math.cos(angle) * radius + scatter() * width;
        local[j + 1] = Math.sin(angle) * radius + scatter() * width;
        local[j + 2] = Math.sin(ray * 2.4) * radius * .32 + scatter() * width;
        light[i] = .022 + (.16 + R() * .48) * Math.pow(1 - progress, 1.2);
        tint[j] = .43 + (1 - progress) * .32;
        tint[j + 1] = .80 + (1 - progress) * .15;
        tint[j + 2] = 1;
      }
    } else {
      kind[i] = 3;
      const angle = R() * TAU, height = R() * 2 - 1;
      const radial = .76 + 3.13 * Math.pow(R(), 1.35), plane = Math.sqrt(1 - height * height);
      local[j] = radial * plane * Math.cos(angle);
      local[j + 1] = radial * height * .84;
      local[j + 2] = radial * plane * Math.sin(angle);
      light[i] = .002 + Math.pow(R(), 3) * .016;
      tint[j] = .32; tint[j + 1] = .58; tint[j + 2] = .82;
    }
  }

  function update(clock) {
    // Absolute time makes returning from the face and seeking deterministic.
    const t = reduce || !Number.isFinite(clock) ? 0 : clock;
    const pulseC = Math.cos(t * .73), pulseS = Math.sin(t * .73);
    const breath = 1 + .012 * Math.sin(t * .47);
    const coreC = Math.cos(t * .12), coreS = Math.sin(t * .12);
    const dustC = Math.cos(t * .023), dustS = Math.sin(t * .023);
    for (let b = 0; b < 3; b++) {
      const spec = BANDS[b], j = b * 9, s = b * 4, w = b * 2;
      const tilt = spec.tilt + .055 * Math.sin(t * .13 + b * 1.7);
      const turn = spec.turn + .045 * Math.sin(t * .10 + b * 2.1);
      const ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(turn), sr = Math.sin(turn);
      // Rz(turn) Rx(tilt). The three ring planes only precess a few degrees.
      matrix[j] = cr; matrix[j + 1] = -sr * ct; matrix[j + 2] = sr * st;
      matrix[j + 3] = sr; matrix[j + 4] = cr * ct; matrix[j + 5] = -cr * st;
      matrix[j + 6] = 0; matrix[j + 7] = st; matrix[j + 8] = ct;
      const ringAngle = spec.phase + t * spec.speed * .23;
      const cometAngle = spec.phase + t * spec.speed;
      spin[s] = Math.cos(ringAngle); spin[s + 1] = Math.sin(ringAngle);
      spin[s + 2] = Math.cos(cometAngle); spin[s + 3] = Math.sin(cometAngle);
      wave[w] = Math.cos(cometAngle - ringAngle);
      wave[w + 1] = Math.sin(cometAngle - ringAngle);
    }
    for (let i = 0; i < N; i++) {
      const j = i * 3, out = output[i] * 3, k = kind[i], b = band[i];
      const x = local[j], y = local[j + 1], z = local[j + 2];
      const shimmer = 1 + .10 * (phase[i * 2] * pulseC - phase[i * 2 + 1] * pulseS);
      let intensity = light[i] * shimmer;
      if (k < 2) {
        const spec = BANDS[b], m = b * 9, s = b * 4 + k * 2;
        const u = (x * spin[s] - y * spin[s + 1]) * spec.a * breath;
        const v = (x * spin[s + 1] + y * spin[s]) * spec.b * breath;
        positions[out] = matrix[m] * u + matrix[m + 1] * v + matrix[m + 2] * z;
        positions[out + 1] = matrix[m + 3] * u + matrix[m + 4] * v + matrix[m + 5] * z;
        positions[out + 2] = matrix[m + 7] * v + matrix[m + 8] * z;
        if (k === 0) {
          // A soft light wave links the moving knot to its quieter full orbit.
          let glow = Math.max(0, x * wave[b * 2] + y * wave[b * 2 + 1]);
          glow *= glow; glow *= glow; glow *= glow;
          intensity *= .76 + glow * .48;
        }
        // The back arc stays visible but gently recedes from the front arc.
        intensity *= .82 + .18 * (positions[out + 2] / 3 + 1) * .5;
      } else if (k === 2) {
        const scale = 1 + (breath - 1) * 2;
        positions[out] = (x * coreC + z * coreS) * scale;
        positions[out + 1] = y * scale;
        positions[out + 2] = (-x * coreS + z * coreC) * scale;
        intensity *= 1 + (breath - 1) * 5;
      } else {
        positions[out] = x * dustC + z * dustS;
        positions[out + 1] = y;
        positions[out + 2] = -x * dustS + z * dustC;
      }
      intensity *= densityGain;
      colours[out] = Math.min(.98, tint[j] * intensity);
      colours[out + 1] = Math.min(.98, tint[j + 1] * intensity);
      colours[out + 2] = Math.min(.98, tint[j + 2] * intensity);
    }
  }
  update(0);
  return { positions, colours, update, bounds: { radius: 4.05 } };
}
