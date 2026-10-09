// Spatial correspondence is built once. A source particle keeps the same live
// orbital destination throughout the transition and after it has settled.
function rngFrom(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function bounds(positions) {
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < positions.length; j++) {
    const value = positions[j], axis = j % 3;
    if (!Number.isFinite(value)) throw new RangeError('Particle templates must be finite.');
    low[axis] = Math.min(low[axis], value);
    high[axis] = Math.max(high[axis], value);
  }
  if (!positions.length) return { low: [0, 0, 0], high: [0, 0, 0], span: 1 };
  return { low, high, span: Math.max(high[0] - low[0], high[1] - low[1], 1e-6) };
}

function spreadBits(value) {
  value = (value | value << 8) & 0x00FF00FF;
  value = (value | value << 4) & 0x0F0F0F0F;
  value = (value | value << 2) & 0x33333333;
  return (value | value << 1) & 0x55555555;
}

function spatialOrder(positions, box) {
  const count = positions.length / 3;
  const keys = new Uint32Array(count), order = new Uint32Array(count);
  // Pair visible neighbourhoods in the front-facing xy plane. Using depth as
  // a primary sort axis would split the face across the front and back rings.
  // Shared xy scale preserves aspect ratio; depth only breaks coincident ties.
  const scale = 4095 / box.span;
  const cx = (box.low[0] + box.high[0]) * .5;
  const cy = (box.low[1] + box.high[1]) * .5;
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    const x = Math.max(0, Math.min(4095, Math.floor((positions[j] - cx) * scale + 2047.5)));
    const y = Math.max(0, Math.min(4095, Math.floor((positions[j + 1] - cy) * scale + 2047.5)));
    keys[i] = spreadBits(x) | spreadBits(y) << 1;
    order[i] = i;
  }
  order.sort((a, b) => keys[a] - keys[b] || positions[a * 3 + 2] - positions[b * 3 + 2] || a - b);
  return order;
}

function checkPool(values, length) {
  if (!values || values.length !== length) throw new RangeError('Particle buffers must have matching lengths.');
}

export function createFormMorph(sourceTemplate, targetTemplate, { duration = 2, reduce = false } = {}) {
  if (!sourceTemplate || sourceTemplate.length % 3) throw new RangeError('Particle templates must contain xyz triples.');
  checkPool(targetTemplate, sourceTemplate.length);
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Transition duration must be positive and finite.');
  const length = sourceTemplate.length, count = length / 3;
  const sourceBox = bounds(sourceTemplate), targetBox = bounds(targetTemplate);
  const sourceOrder = spatialOrder(sourceTemplate, sourceBox);
  const targetOrder = spatialOrder(targetTemplate, targetBox);
  const mapping = new Uint32Array(count);
  for (let rank = 0; rank < count; rank++) mapping[sourceOrder[rank]] = targetOrder[rank];

  const positions = new Float32Array(sourceTemplate), colours = new Float32Array(length);
  const startPositions = new Float32Array(length), startColours = new Float32Array(length);
  const arcs = new Float32Array(length), speedPower = new Float32Array(count);
  const R = rngFrom(0x666C6F77);
  const durationSeconds = reduce ? Math.min(duration, .42) : duration;
  const cx = (sourceBox.low[0] + sourceBox.high[0]) * .5;
  const cy = (sourceBox.low[1] + sourceBox.high[1]) * .5;
  for (let i = 0; i < count; i++) {
    const j = i * 3, x = sourceTemplate[j] - cx, y = sourceTemplate[j + 1] - cy;
    const radius = Math.hypot(x, y), norm = Math.max(radius, sourceBox.span * .08);
    const nx = x / norm, ny = y / norm;
    // Most particles follow a small shared curl. A fifth take a wider outward
    // arc; their direction is a smooth spatial field, never independent noise.
    const flare = R() < .2;
    const amount = flare ? .4 + R() * .28 : .09 + R() * .14;
    let ax = flare ? nx - ny * .28 : nx * .3 - ny * .7;
    let ay = flare ? ny + nx * .28 : ny * .3 + nx * .7;
    let az = .25 * Math.sin(x * 1.15 + y * .8) + .12 * Math.cos(y * 1.6);
    const arcLength = Math.max(Math.hypot(ax, ay, az), 1e-6);
    arcs[j] = ax / arcLength * amount;
    arcs[j + 1] = ay / arcLength * amount;
    arcs[j + 2] = az / arcLength * amount;
    // Move on the first frame, like the original nebula gathering. Different
    // response speeds loosen facial patches instead of stretching them as a
    // sheet, while the destination identity remains fixed. A shared spatial
    // field keeps some local rhythm; index variation lets grains arrive apart.
    const variation = (Math.imul(i + 1, 0x9e3779b1) >>> 0) / 4294967296;
    const field = .5 + .5 * Math.sin(x * 1.2 + y * .8);
    speedPower[i] = 2.6 + 2.8 * (.65 * variation + .35 * field);
  }

  let started = false, startTime = 0, progress = 0, reverseTarget = false, centreGather = false;
  function begin(sourcePositions, sourceColours, clock, { reverse = false, gather = false } = {}) {
    checkPool(sourcePositions, length); checkPool(sourceColours, length);
    // Snapshot first: callers may pass our own output when interrupting a move.
    startPositions.set(sourcePositions); startColours.set(sourceColours);
    positions.set(startPositions); colours.set(startColours);
    startTime = Number.isFinite(clock) ? clock : 0;
    started = true; progress = 0; reverseTarget = reverse;
    centreGather = gather && !reverse && !reduce;
    return api;
  }

  function sample(clock, targetPositions, targetColours) {
    checkPool(targetPositions, length); checkPool(targetColours, length);
    if (!started) return api;
    const elapsed = Number.isFinite(clock) ? Math.max(0, clock - startTime) : 0;
    progress = Math.min(1, elapsed / durationSeconds);
    for (let i = 0; i < count; i++) {
      const j = i * 3, destination = reverseTarget ? j : mapping[i] * 3;
      if (progress === 1) {
        // Continue reading the live target after completion; its index identity
        // stays fixed even while orbital geometry and light animate. Returning
        // to the face uses its original particle indices instead of the mapping.
        positions[j] = targetPositions[destination];
        positions[j + 1] = targetPositions[destination + 1];
        positions[j + 2] = targetPositions[destination + 2];
        colours[j] = targetColours[destination];
        colours[j + 1] = targetColours[destination + 1];
        colours[j + 2] = targetColours[destination + 2];
        continue;
      }
      const u = progress;
      const ease = reduce ? u * u * u * (10 + u * (-15 + u * 6))
        : 1 - Math.pow(1 - u, speedPower[i]);
      // Immediate travel, followed by a soft landing. The bounded excursion
      // vanishes at both endpoints; no detached cloud or blank replacement.
      const excursion = reduce ? 0 : 16 * ease * ease * (1 - ease) * (1 - ease);
      // The jellyfish rushes into the atom's origin before its rings unfold.
      // Overlapping arrival/release times keep a lit flow through the centre.
      let pull = ease, release = ease, curl = excursion;
      if (centreGather) {
        const stagger = (speedPower[i] - 2.6) / 2.8;
        pull = 1 - Math.pow(1 - Math.min(1, u / (.5 + .13 * stagger)), 3);
        const releaseStart = .34 + .1 * stagger;
        const time = Math.max(0, (u - releaseStart) / (1 - releaseStart));
        release = time ** 3 * (10 + time * (-15 + time * 6));
        curl = .12 * 4 * pull * (1 - pull);
      }
      for (let c = 0; c < 3; c++) {
        positions[j + c] = centreGather
          ? startPositions[j + c] * (1 - pull) + targetPositions[destination + c] * release + arcs[j + c] * curl
          : startPositions[j + c] + (targetPositions[destination + c] - startPositions[j + c]) * ease + arcs[j + c] * excursion;
        colours[j + c] = startColours[j + c]
          + (targetColours[destination + c] - startColours[j + c]) * ease;
      }
    }
    return api;
  }

  const api = { positions, colours, mapping, begin, sample,
    get active() { return started && progress < 1; },
    get progress() { return progress; },
    // Appearance and framing follow the same front-loaded gathering rhythm.
    get blend() { return reduce ? progress ** 3 * (10 + progress * (-15 + progress * 6))
      : 1 - (1 - progress) ** 4; }
  };
  return api;
}
