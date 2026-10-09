// A lotus assembled from thin, cupped petal sheets. Its private particle pool
// and analytic clock are independent of the face and every other preview.
const TAU = Math.PI * 2;
const TIERS = [
  { count: 8, length: 3.00, width: .99, root: -.68, rise: .97, cup: .29, turn: .12, delay: .22 },
  { count: 7, length: 2.30, width: .86, root: -.46, rise: 1.46, cup: .25, turn: .53, delay: 1.12 },
  { count: 6, length: 1.40, width: .67, root: -.23, rise: 1.81, cup: .19, turn: .12, delay: 1.96 }
];
const PETALS = 21;
const VIEW = .53, VIEW_C = Math.cos(VIEW), VIEW_S = Math.sin(VIEW);

function rngFrom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function smooth(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

export function createLotus(N, reduce = false) {
  if (!Number.isInteger(N) || N < 0) throw new RangeError('Particle count must be a nonnegative integer.');
  const R = rngFrom(0x6C6F7475);
  const positions = new Float32Array(N * 3), colours = new Float32Array(N * 3);
  const local = new Float32Array(N * 6), tint = new Float32Array(N * 3);
  const light = new Float32Array(N), along = new Float32Array(N);
  const wave = new Float32Array(N * 2), kind = new Uint8Array(N), petal = new Uint8Array(N);
  const output = new Uint32Array(N), petalTier = new Uint8Array(PETALS);
  const petalAngle = new Float64Array(PETALS), petalPhase = new Float64Array(PETALS);
  // Per-petal opening, yaw, breath, curl and travelling-light coefficients.
  const pose = new Float64Array(PETALS * 7);
  const flash = new Float64Array(PETALS);
  const densityGain = N < 32000 ? Math.sqrt(32000 / Math.max(9000, N)) : 1;
  const petalEnd = Math.floor(N * .965), coreEnd = Math.floor(N * .988);
  const scatter = () => R() + R() + R() - 1.5;
  let epoch = 0, openness = 0;
  for (let p = 0, tier = 0; tier < TIERS.length; tier++) {
    const spec = TIERS[tier];
    for (let k = 0; k < spec.count; k++, p++) {
      petalTier[p] = tier;
      petalAngle[p] = k * TAU / spec.count + spec.turn;
      petalPhase[p] = p * 2.399963229728653;
    }
  }
  for (let i = 0; i < N; i++) output[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const q = Math.floor(R() * (i + 1)), tmp = output[i];
    output[i] = output[q]; output[q] = tmp;
  }
  for (let i = 0; i < N; i++) {
    const j = i * 3, l = i * 6, w = i * 2;
    if (i < petalEnd) {
      const p = i % PETALS, tier = petalTier[p], spec = TIERS[tier];
      petal[i] = p;
      const material = R();
      let u, v;
      if (material < .255) {
        kind[i] = 1;
        u = .008 + R() * .987;
        // A pair of fine lips, not a thick tube, bounds each translucent sheet.
        v = (R() < .5 ? -1 : 1) * (.984 + scatter() * .012);
        light[i] = .237 + R() * .275;
      } else if (material < .405) {
        kind[i] = 2;
        u = .055 + R() * .92;
        const lane = i % 7 - 3;
        v = lane * .247 + scatter() * .009;
        light[i] = (lane === 0 ? .164 : .082) + R() * .128;
      } else {
        kind[i] = 0;
        // Approximate area sampling avoids accumulating the sheet at its tip.
        u = .025 + (R() + R()) * .475;
        v = R() * 2 - 1;
        const mottling = .66 + .34 * Math.cos(u * 15 + v * 4 + p);
        light[i] = (.15 + R() * .258) * mottling;
      }
      along[i] = u;
      const blade = Math.pow(Math.sin(Math.PI * u), .82);
      const lateral = v * spec.width * blade;
      const ridge = (1 - v * v) * blade;
      const tip = u * u * u;
      const variation = 1 + .025 * Math.sin(p * 2.7);
      // Open petals form three nested bowls, with raised sides and pointed
      // upturned tips. The broad outer tier establishes a lotus silhouette.
      local[l] = .18 + spec.length * u * variation + scatter() * .005;
      local[l + 1] = spec.root + spec.rise * (u * .34 + u * u * .66)
        + spec.cup * v * v * blade - .13 * ridge + .10 * tip + scatter() * .008;
      local[l + 2] = lateral;
      // The closed pose is a tapered upright bud, not a scaled open flower.
      local[l + 3] = .065 + (.59 - tier * .12) * blade + .09 * (1 - u);
      local[l + 4] = -.73 + (2.66 - tier * .13) * u + .04 * v * v * blade;
      local[l + 5] = lateral * (.27 - tier * .035);
      const violet = .5 + .5 * Math.sin(petalAngle[p] * 1.8 + v * 1.25 + tier * .8);
      const pearl = kind[i] === 1 ? .06 + .11 * u : 0;
      tint[j] = .14 + violet * .47 + pearl;
      tint[j + 1] = .86 - violet * .51 + pearl * .6;
      tint[j + 2] = 1;
      wave[w] = Math.sin(u * TAU * 1.12);
      wave[w + 1] = Math.cos(u * TAU * 1.12);
    } else if (i < coreEnd) {
      kind[i] = 3;
      const strand = i % 31, angle = strand * 2.399963229728653;
      const radius = .10 + .31 * Math.sqrt((strand + .5) / 31);
      const head = R() < .24;
      const u = head ? .96 + R() * .04 : R();
      const height = .28 + .15 * (.5 + .5 * Math.sin(strand * 1.7));
      local[l] = Math.cos(angle) * radius * (.82 + .18 * u) + scatter() * (head ? .019 : .006);
      local[l + 1] = -.30 + height * u + scatter() * (head ? .018 : .004);
      local[l + 2] = Math.sin(angle) * radius * (.82 + .18 * u) + scatter() * (head ? .019 : .006);
      light[i] = head ? .204 + R() * .192 : .063 + R() * .080;
      tint[j] = 1; tint[j + 1] = .63 + R() * .14; tint[j + 2] = .23 + R() * .10;
      wave[w] = Math.sin(angle); wave[w + 1] = Math.cos(angle);
    } else {
      kind[i] = 4;
      const angle = R() * TAU;
      local[l] = Math.cos(angle); local[l + 1] = R(); local[l + 2] = Math.sin(angle);
      local[l + 3] = .6 + R() * 1.7;
      local[l + 4] = .017 + R() * .013;
      local[l + 5] = R() * TAU;
      light[i] = R() < .1 ? .102 + R() * .087 : .020 + R() * .046;
      const gold = R() < .30;
      tint[j] = gold ? 1 : .47; tint[j + 1] = gold ? .74 : .77; tint[j + 2] = gold ? .35 : 1;
    }
  }

  if (!reduce) {
    // Reuse a small part of the dim sheet pool for life around the flower.
    // A second private seed preserves all retained petal geometry and colour.
    const lifeRandom = rngFrom(0x77697370), donors = [], anchors = new Int32Array(PETALS).fill(-1);
    for (let i = 0; i < N; i++) {
      if (kind[i] === 0) donors.push(i);
      if (kind[i] === 1 && along[i] > .62 && along[i] < .9 && anchors[petal[i]] < 0) anchors[petal[i]] = i;
    }
    const filamentCount = Math.min(donors.length, Math.floor(N * .028));
    const lifeCount = Math.min(donors.length, filamentCount + Math.floor(N * .035));
    for (let q = 0; q < lifeCount; q++) {
      const i = donors[q], j = i * 3, l = i * 6, w = i * 2;
      if (q < filamentCount) {
        const p = q % PETALS, anchor = anchors[p];
        if (anchor < 0) continue;
        kind[i] = 5; petal[i] = p; along[i] = along[anchor];
        for (let c = 0; c < 6; c++) local[l + c] = local[anchor * 6 + c];
        for (let c = 0; c < 3; c++) tint[j + c] = tint[anchor * 3 + c] * .75 + .20;
        wave[w] = lifeRandom(); wave[w + 1] = (lifeRandom() - .5) * .025;
        light[i] = .18 + lifeRandom() * .22;
      } else {
        kind[i] = 6;
        const lane = q % 7;
        local[l] = lifeRandom(); local[l + 1] = lane * TAU / 7;
        local[l + 2] = .18 + lane * .009;
        local[l + 3] = (lifeRandom() - .5) * .065;
        local[l + 4] = (lifeRandom() - .5) * .065;
        light[i] = .28 + lifeRandom() * .27;
        const gold = lifeRandom() < .10;
        tint[j] = gold ? 1 : .66; tint[j + 1] = gold ? .8 : .80; tint[j + 2] = gold ? .42 : 1;
      }
    }
  }

  function update(clock) {
    const t = reduce ? 0 : Math.max(0, (Number.isFinite(clock) ? clock : 0) - epoch);
    const yaw = .085 * Math.sin(t * .11) + .035 * Math.sin(t * .073);
    const yawC = Math.cos(yaw), yawS = Math.sin(yaw);
    const heart = 1 + .06 * Math.sin(t * .72);
    let opened = 0;
    for (let p = 0; p < PETALS; p++) {
      const spec = TIERS[petalTier[p]], phase = petalPhase[p], s = p * 7;
      const open = reduce ? 1 : smooth((t - spec.delay - .10 * Math.sin(phase)) / 5.05);
      const turn = petalAngle[p] + yaw + open * .012 * Math.sin(t * .37 + phase);
      pose[s] = open;
      pose[s + 1] = Math.cos(turn); pose[s + 2] = Math.sin(turn);
      pose[s + 3] = open * .022 * Math.sin(t * .62 + phase);
      pose[s + 4] = open * (.054 * Math.sin(t * .57 + phase) + .018 * Math.sin(t * .93 + phase * .7));
      const travelling = t * 1.66 - phase * .27;
      pose[s + 5] = Math.cos(travelling); pose[s + 6] = Math.sin(travelling);
      opened += open;
    }
    openness = opened / PETALS;
    // Two short edge chases, then several seconds of quiet. The chosen petals
    // and start delay vary deterministically without a scheduler or new RNG.
    flash.fill(-1);
    if (!reduce && t >= 4.4) {
      const cycle = Math.floor((t - 4.4) / 6.7);
      const delay = cycle === 0 ? 0 : ((Math.imul(cycle, 1597334677) >>> 0) / 4294967296) * 1.1;
      const age = t - 4.4 - cycle * 6.7 - delay;
      const first = (cycle * 8 + 3) % PETALS;
      for (let chase = 0; chase < 2; chase++) {
        const progress = (age - chase * .29) / .84;
        if (progress >= 0 && progress <= 1) flash[(first + chase * 9) % PETALS] = progress;
      }
    }
    const risingAge = Math.max(0, t - 2.25);
    const streamGain = smooth((openness - .12) / .58);
    for (let i = 0; i < N; i++) {
      const j = i * 3, l = i * 6, w = i * 2, out = output[i] * 3, k = kind[i];
      let x, y, z, spark = 0, intensity = light[i];
      if (k < 3 || k === 5) {
        const s = petal[i] * 7, open = pose[s], u = along[i];
        const radial = (local[l + 3] + (local[l] - local[l + 3]) * open) * (1 + pose[s + 3] * u);
        const width = local[l + 5] + (local[l + 2] - local[l + 5]) * open;
        y = local[l + 4] + (local[l + 1] - local[l + 4]) * open + pose[s + 4] * u * u * u;
        x = radial * pose[s + 1] - width * pose[s + 2];
        z = radial * pose[s + 2] + width * pose[s + 1];
        if (k === 5) {
          // Coherent curls stay rooted at petal lips; grains drift through them
          // and go dark at both ends before their lifetime wraps.
          const age = wave[w] + t * (.12 + (petal[i] % 6) * .007);
          const life = age - Math.floor(age), reach = life * open;
          const curl = Math.sin(life * 5.5 + t * .31 + petalPhase[petal[i]]) * .20 * reach;
          const outward = (.60 + .13 * (petal[i] % 3)) * reach;
          const side = (local[l + 2] < 0 ? -1 : 1) * outward * .8 + curl;
          x += pose[s + 1] * outward * .6 - pose[s + 2] * side + wave[w + 1] * reach;
          z += pose[s + 2] * outward * .6 + pose[s + 1] * side;
          y += .43 * reach + .11 * Math.sin(life * 4.2 + petal[i]) * reach;
          const fade = Math.sin(Math.PI * life);
          intensity *= fade * fade * open;
        } else {
          // A slower underlying light wave supports the occasional fast chase.
          let crest = Math.max(0, wave[w] * pose[s + 5] - wave[w + 1] * pose[s + 6]);
          crest *= crest; crest *= crest; crest *= crest;
          intensity *= (k === 0 ? .88 + crest * .34 : .78 + crest * .86);
          if (k === 1 && flash[petal[i]] >= 0) {
            const head = flash[petal[i]];
            const path = local[l + 2] < 0 ? u * .5 : 1 - u * .5;
            const lag = head - path;
            const hot = Math.exp(-lag * lag / .00075);
            const tail = lag >= 0 ? Math.exp(-lag / .085) : 0;
            spark = (hot * .88 + tail * .36) * smooth(head / .08) * (1 - smooth((head - .86) / .14)) * open;
          }
          intensity *= .64 + open * .36;
          intensity *= .80 + .20 * Math.max(0, Math.min(1, (z + 3.2) / 6.4));
        }
      } else if (k === 3) {
        x = local[l] * yawC - local[l + 2] * yawS;
        y = local[l + 1] + .012 * Math.sin(t * .72);
        z = local[l] * yawS + local[l + 2] * yawC;
        intensity *= (.12 + .88 * openness * openness) * heart;
      } else if (k === 6) {
        // Thin winding lanes rise from the heart and gently fan out overhead.
        const age = local[l] + risingAge * local[l + 2], life = age - Math.floor(age);
        const angle = local[l + 1] + life * 4.7 + t * .19;
        const radius = .07 + .30 * life;
        x = Math.cos(angle) * radius + .22 * Math.sin(life * 3.5 + t * .32) * life + local[l + 3];
        y = -.24 + life * 3.6;
        z = Math.sin(angle) * radius + .10 * Math.cos(life * 4 + t * .26) * life + local[l + 4];
        const front = smooth((risingAge * .24 - life) * 5);
        const fade = smooth(life / .07) * (1 - smooth((life - .70) / .30));
        const breath = .82 + .18 * Math.sin(t * .63);
        intensity *= front * fade * streamGain * breath;
      } else {
        // Pollen fades fully before a deterministic reset at its birthplace.
        const age = local[l + 1] + t * local[l + 4], life = age - Math.floor(age);
        const drift = Math.sin(t * .29 + local[l + 5]);
        const radial = .20 + local[l + 3] * life;
        x = local[l] * radial + .13 * drift * life;
        y = -.24 + life * 2.82;
        z = local[l + 2] * radial + .09 * Math.cos(t * .23 + local[l + 5]) * life;
        const fade = Math.sin(Math.PI * life);
        intensity *= fade * fade * (.18 + .82 * openness);
      }
      // A fixed elevated viewpoint exposes petal interiors and a front/back
      // overlap. Only a restrained yaw changes; the flower never tumbles.
      positions[out] = x;
      positions[out + 1] = y * VIEW_C - z * VIEW_S - .05;
      positions[out + 2] = y * VIEW_S + z * VIEW_C;
      intensity *= densityGain;
      colours[out] = Math.min(.98, tint[j] * intensity + spark * .68);
      colours[out + 1] = Math.min(.98, tint[j + 1] * intensity + spark * .88);
      colours[out + 2] = Math.min(.98, tint[j + 2] * intensity + spark);
    }
  }
  function replay(clock) {
    epoch = Number.isFinite(clock) ? clock : 0;
    update(epoch);
  }
  update(0);
  return { positions, colours, update, replay, bounds: { radius: 4.1 }, get openness() { return openness; } };
}
