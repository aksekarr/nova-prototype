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

export function createFormMorph(sourceTemplate, targetTemplate, { duration = 3.2, reduce = false } = {}) {
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
  const arcs = new Float32Array(length), delay = new Float32Array(count);
  const R = rngFrom(0x666C6F77);
  const durationSeconds = reduce ? Math.min(duration, .42) : duration;
  const cx = (sourceBox.low[0] + sourceBox.high[0]) * .5;
  const cy = (sourceBox.low[1] + sourceBox.high[1]) * .5;
  const height = Math.max(sourceBox.high[1] - sourceBox.low[1], 1e-6);
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
    const down = 1 - (sourceTemplate[j + 1] - sourceBox.low[1]) / height;
    const radial = Math.min(1, radius / (sourceBox.span * .5));
    // Give the face a short readable hold, then release neighbouring patches
    // together. All particles still arrive at the same overall end time.
    delay[i] = reduce ? 0 : Math.min(duration * .12, .16 + .14 * (.65 * down + .35 * radial));
  }

  let started = false, startTime = 0, progress = 0, reverseTarget = false;
  function begin(sourcePositions, sourceColours, clock, { reverse = false } = {}) {
    checkPool(sourcePositions, length); checkPool(sourceColours, length);
    // Snapshot first: callers may pass our own output when interrupting a move.
    startPositions.set(sourcePositions); startColours.set(sourceColours);
    positions.set(startPositions); colours.set(startColours);
    startTime = Number.isFinite(clock) ? clock : 0;
    started = true; progress = 0; reverseTarget = reverse;
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
      const u = Math.max(0, Math.min(1, (elapsed - delay[i]) / (durationSeconds - delay[i])));
      const ease = u * u * u * (10 + u * (-15 + u * 6));
      // Both the travel and the excursion have zero endpoint velocity. There
      // is no detached cloud, brightness dip, or white flash between the forms.
      const excursion = reduce ? 0 : 16 * ease * ease * (1 - ease) * (1 - ease);
      for (let c = 0; c < 3; c++) {
        positions[j + c] = startPositions[j + c]
          + (targetPositions[destination + c] - startPositions[j + c]) * ease
          + arcs[j + c] * excursion;
        colours[j + c] = startColours[j + c]
          + (targetColours[destination + c] - startColours[j + c]) * ease;
      }
    }
    return api;
  }

  const api = { positions, colours, mapping, begin, sample,
    get active() { return started && progress < 1; },
    get progress() { return progress; }
  };
  return api;
}
