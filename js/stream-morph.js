// A single living pool drains through one outlet before building its next body.
// Correspondence and release order are prepared once; sampling allocates nothing.
const clamp01 = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);
function fraction(index, salt) {
  let value = Math.imul(index + 1, 0x45d9f3b) ^ salt;
  value = Math.imul(value ^ value >>> 16, 0x45d9f3b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}
function checkPool(values, length) {
  if (!values || values.length !== length) throw new RangeError('Particle buffers must have matching lengths.');
}
function checkPoint(point) {
  if (!point || point.length !== 3 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(point[2])) {
    throw new RangeError('Stream gates must contain three finite coordinates.');
  }
}
function robustBox(template) {
  const count = template.length / 3;
  const low = [0, 0, 0], high = [0, 0, 0];
  const axisValues = new Float32Array(count);
  for (let axis = 0; axis < 3; axis++) {
    for (let i = 0; i < count; i++) {
      const value = template[i * 3 + axis];
      if (!Number.isFinite(value)) throw new RangeError('Particle templates must be finite.');
      axisValues[i] = value;
    }
    axisValues.sort();
    if (count) {
      low[axis] = axisValues[Math.floor((count - 1) * .025)];
      high[axis] = axisValues[Math.floor((count - 1) * .975)];
    }
  }
  return { low, high };
}

export function createStreamMorph(sourceTemplate, targetTemplate, { duration = 2.35, reduce = false } = {}) {
  if (!sourceTemplate || sourceTemplate.length % 3) throw new RangeError('Particle templates must contain xyz triples.');
  checkPool(targetTemplate, sourceTemplate.length);
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Transition duration must be positive and finite.');
  const length = sourceTemplate.length, count = length / 3;
  const sourceBox = robustBox(sourceTemplate);
  robustBox(targetTemplate);
  const defaultOutlet = new Float64Array(3);
  for (let c = 0; c < 3; c++) {
    defaultOutlet[c] = (sourceBox.low[c] + sourceBox.high[c]) * .5
      + (sourceBox.high[c] - sourceBox.low[c]) * (c === 2 ? .05 : .28);
  }
  const defaultInlet = new Float64Array([2.8, 2.25, 0]);
  const outlet = new Float64Array(defaultOutlet), inlet = new Float64Array(defaultInlet);
  const axis = new Float64Array(3), side = new Float64Array(3), up = new Float64Array(3);
  const sourceOrder = new Uint32Array(count), targetOrder = new Uint32Array(count);
  const releaseScores = new Float32Array(count), targetScores = new Float32Array(count);
  const scale = Math.max(sourceBox.high[0] - sourceBox.low[0], sourceBox.high[1] - sourceBox.low[1], 1e-6);
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    sourceOrder[i] = targetOrder[i] = i;
    const x = sourceTemplate[j] - defaultOutlet[0];
    const y = sourceTemplate[j + 1] - defaultOutlet[1];
    const z = sourceTemplate[j + 2] - defaultOutlet[2];
    // Neighbours leave together, but the loose grain order softens the edge
    // of the draining face. Bell-first arrival grows a body above its tendrils.
    releaseScores[i] = Math.hypot(x, y, z * .35) / scale + fraction(i, 17) * .025;
    targetScores[i] = targetTemplate[j + 1] + (fraction(i, 29) - .5) * .08;
  }
  sourceOrder.sort((a, b) => releaseScores[a] - releaseScores[b] || a - b);
  targetOrder.sort((a, b) => targetScores[b] - targetScores[a] || a - b);
  const mapping = new Uint32Array(count), release = new Float32Array(count), travel = new Float32Array(count);
  const offsetX = new Float32Array(count), offsetY = new Float32Array(count);
  for (let rank = 0; rank < count; rank++) {
    const i = sourceOrder[rank], order = count > 1 ? rank / (count - 1) : 0;
    mapping[i] = targetOrder[rank];
    release[i] = Math.pow(order, .8) * .54;
    travel[i] = .39 + .07 * fraction(i, 41);
    const angle = fraction(i, 53) * Math.PI * 2;
    // A visible bundle of grains, rather than a subpixel laser.
    const radius = Math.sqrt(fraction(i, 67)) * .14;
    offsetX[i] = Math.cos(angle) * radius;
    offsetY[i] = Math.sin(angle) * radius;
  }
  const positions = new Float32Array(sourceTemplate), colours = new Float32Array(length);
  const startPositions = new Float32Array(length), startColours = new Float32Array(length);
  const durationSeconds = reduce ? Math.min(duration, .42) : duration;
  let started = false, startTime = 0, progress = 0, reverseTarget = false;
  let streamLength = 1;

  function begin(sourcePositions, sourceColours, clock, options = {}) {
    checkPool(sourcePositions, length); checkPool(sourceColours, length);
    const nextOutlet = options.outlet || defaultOutlet, nextInlet = options.inlet || defaultInlet;
    checkPoint(nextOutlet); checkPoint(nextInlet);
    startPositions.set(sourcePositions); startColours.set(sourceColours);
    positions.set(startPositions); colours.set(startColours);
    outlet.set(nextOutlet); inlet.set(nextInlet);
    streamLength = Math.hypot(inlet[0] - outlet[0], inlet[1] - outlet[1], inlet[2] - outlet[2]);
    const denominator = Math.max(streamLength, 1e-6);
    for (let c = 0; c < 3; c++) axis[c] = (inlet[c] - outlet[c]) / denominator;
    if (streamLength < 1e-6) { axis[0] = 1; axis[1] = 0; axis[2] = 0; }
    const planeLength = Math.hypot(axis[0], axis[1]);
    side[0] = planeLength > 1e-6 ? -axis[1] / planeLength : 1;
    side[1] = planeLength > 1e-6 ? axis[0] / planeLength : 0;
    side[2] = 0;
    up[0] = -axis[2] * side[1];
    up[1] = axis[2] * side[0];
    up[2] = axis[0] * side[1] - axis[1] * side[0];
    startTime = Number.isFinite(clock) ? clock : 0;
    started = true; progress = 0; reverseTarget = Boolean(options.reverse);
    return api;
  }

  function sample(clock, targetPositions, targetColours) {
    checkPool(targetPositions, length); checkPool(targetColours, length);
    if (!started) return api;
    const elapsed = Number.isFinite(clock) ? Math.max(0, clock - startTime) : 0;
    progress = Math.min(1, elapsed / durationSeconds);
    for (let i = 0; i < count; i++) {
      const j = i * 3, destination = reverseTarget ? j : mapping[i] * 3;
      if (progress === 0) {
        positions[j] = startPositions[j]; positions[j + 1] = startPositions[j + 1]; positions[j + 2] = startPositions[j + 2];
        colours[j] = startColours[j]; colours[j + 1] = startColours[j + 1]; colours[j + 2] = startColours[j + 2];
        continue;
      }
      const u = reduce || reverseTarget ? progress : clamp01((progress - release[i]) / travel[i]);
      if (u === 1 || progress === 1) {
        // This mapping remains active after arrival, so every grain continues
        // following the living body instead of freezing at a sampled pose.
        for (let c = 0; c < 3; c++) {
          positions[j + c] = targetPositions[destination + c];
          colours[j + c] = targetColours[destination + c];
        }
        continue;
      }
      if (reduce || reverseTarget) {
        const weight = reduce ? progress ** 3 * (10 + progress * (-15 + progress * 6))
          : 1 - (1 - progress) ** (3.2 + fraction(i, 79) * 1.6);
        for (let c = 0; c < 3; c++) {
          positions[j + c] = startPositions[j + c] + (targetPositions[destination + c] - startPositions[j + c]) * weight;
          colours[j + c] = startColours[j + c] + (targetColours[destination + c] - startColours[j + c]) * weight;
        }
        continue;
      }
      if (u === 0) {
        // Unreleased grains still describe the face while leading grains
        // already describe the jellyfish. Nothing dissolves or respawns.
        positions[j] = startPositions[j]; positions[j + 1] = startPositions[j + 1]; positions[j + 2] = startPositions[j + 2];
        colours[j] = startColours[j]; colours[j + 1] = startColours[j + 1]; colours[j + 2] = startColours[j + 2];
        continue;
      }
      const colourWeight = smooth(u);
      // Additive overlap concentrates thousands of grains inside the channel.
      // Compensate only that local crowding so their colour remains visible;
      // every grain stays lit, and both bodies retain their full brightness.
      const packed = smooth(clamp01((u - .12) / .23)) * smooth(clamp01((.92 - u) / .17));
      const densityLight = 1 - .82 * packed;
      const segment = u < .43 ? 0 : u < .67 ? 1 : 2;
      const local = segment === 0 ? u / .43 : segment === 1 ? (u - .43) / .24 : (u - .67) / .33;
      const inverse = 1 - local;
      const b0 = inverse * inverse * inverse, b1 = 3 * inverse * inverse * local;
      const b2 = 3 * inverse * local * local, b3 = local * local * local;
      // Match velocities across both gates. Keep grains moving through the
      // constriction instead of accumulating into two overexposed knots.
      const tangent = Math.min(streamLength * 2.4, 3.2);
      for (let c = 0; c < 3; c++) {
        const offset = side[c] * offsetX[i] + up[c] * offsetY[i];
        const a = outlet[c] + offset, b = inlet[c] + offset;
        const start = startPositions[j + c], target = targetPositions[destination + c];
        let p0, p1, p2, p3;
        if (segment === 0) {
          p0 = start; p1 = start + (a - start) * .035;
          p2 = a - axis[c] * tangent * .43 / 3; p3 = a;
        } else if (segment === 1) {
          p0 = a; p1 = a + axis[c] * tangent * .24 / 3;
          p2 = b - axis[c] * tangent * .24 / 3; p3 = b;
        } else {
          p0 = b; p1 = b + axis[c] * tangent * .33 / 3;
          p2 = target; p3 = target;
        }
        positions[j + c] = b0 * p0 + b1 * p1 + b2 * p2 + b3 * p3;
        colours[j + c] = (startColours[j + c] + (targetColours[destination + c] - startColours[j + c]) * colourWeight) * densityLight;
      }
    }
    return api;
  }
  const api = { positions, colours, mapping, begin, sample,
    get active() { return started && progress < 1; },
    get progress() { return progress; },
    get blend() {
      return reduce ? progress ** 3 * (10 + progress * (-15 + progress * 6))
        : reverseTarget ? 1 - (1 - progress) ** 4 : smooth(progress);
    }
  };
  return api;
}
