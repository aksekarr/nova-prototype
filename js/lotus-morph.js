import { createFormMorph } from './form-morph.js';

const smooth = value => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

// Keep the atom's live ring/comet identities while winding them into the bud.
// The shared morph still owns correspondence, reduced motion and direct returns.
export function createLotusMorph(sourceTemplate, budTemplate, { duration = 2.2, reduce = false } = {}) {
  const direct = createFormMorph(sourceTemplate, budTemplate, { duration, reduce });
  const { positions, colours, mapping } = direct;
  const length = positions.length;
  const startPositions = new Float32Array(length), startColours = new Float32Array(length);
  const sourceOffset = new Float32Array(length), colourOffset = new Float32Array(length);
  let orbit = null, sourceMapping = null, startTime = 0, progress = 0;

  function begin(sourcePositions, sourceColours, clock, options = {}) {
    direct.begin(sourcePositions, sourceColours, clock, options);
    orbit = !reduce && !options.reverse ? options.orbit || null : null;
    sourceMapping = options.sourceMapping;
    if (orbit && (!sourceMapping || sourceMapping.length !== mapping.length)) {
      throw new RangeError('The live atom needs a matching particle mapping.');
    }
    startTime = Number.isFinite(clock) ? clock : 0;
    progress = 0;
    if (orbit) {
      startPositions.set(positions); startColours.set(colours);
      orbit.update(startTime);
      // Preserve the last displayed frame even if the renderer clock advanced
      // between the click and this frame. Its tiny residual fades as we travel.
      for (let i = 0; i < mapping.length; i++) {
        const j = i * 3, k = sourceMapping[i] * 3;
        for (let c = 0; c < 3; c++) {
          sourceOffset[j + c] = startPositions[j + c] - orbit.positions[k + c];
          colourOffset[j + c] = startColours[j + c] - orbit.colours[k + c];
        }
      }
    }
    return api;
  }

  function sample(clock, targetPositions, targetColours) {
    if (!orbit) { direct.sample(clock, targetPositions, targetColours); return api; }
    if (targetPositions?.length !== length || targetColours?.length !== length) {
      throw new RangeError('Particle buffers must have matching lengths.');
    }
    const elapsed = Number.isFinite(clock) ? Math.max(0, clock - startTime) : 0;
    progress = Math.min(1, elapsed / duration);
    if (progress === 0) {
      positions.set(startPositions); colours.set(startColours);
      return api;
    }
    if (progress === 1) {
      for (let i = 0; i < mapping.length; i++) {
        const j = i * 3, k = mapping[i] * 3;
        for (let c = 0; c < 3; c++) {
          positions[j + c] = targetPositions[k + c];
          colours[j + c] = targetColours[k + c];
        }
      }
      return api;
    }
    const turn = smooth(progress), residual = 1 - turn;
    // The three light knots make a final quicker sweep in their own planes.
    orbit.update(startTime + elapsed + duration * 1.8 * turn);
    const scale = 1 - .78 * smooth(progress / .76);
    const dock = smooth((progress - .30) / .70), free = 1 - dock;
    const angle = Math.PI * .9 * turn, cosine = Math.cos(angle), sine = Math.sin(angle);
    // Compensate ring overlap without a white flare at the centre. The upright
    // bud arrives progressively; the entire pool never collapses to one point.
    const density = .20 + .80 * scale * scale;
    for (let i = 0; i < mapping.length; i++) {
      const j = i * 3, k = sourceMapping[i] * 3, target = mapping[i] * 3;
      const x = orbit.positions[k] + sourceOffset[j] * residual;
      const y = orbit.positions[k + 1] + sourceOffset[j + 1] * residual;
      const z = orbit.positions[k + 2] + sourceOffset[j + 2] * residual;
      positions[j] = (x * cosine + z * sine) * scale * free + targetPositions[target] * dock;
      positions[j + 1] = y * scale * free + targetPositions[target + 1] * dock;
      positions[j + 2] = (z * cosine - x * sine) * scale * free + targetPositions[target + 2] * dock;
      for (let c = 0; c < 3; c++) {
        const source = Math.max(0, Math.min(.98, orbit.colours[k + c] + colourOffset[j + c] * residual));
        colours[j + c] = source * density * free + targetColours[target + c] * dock;
      }
    }
    return api;
  }

  const api = { positions, colours, mapping, begin, sample, duration: reduce ? Math.min(duration, .42) : duration,
    get active() { return orbit ? progress < 1 : direct.active; },
    get progress() { return orbit ? progress : direct.progress; },
    get blend() { return orbit ? smooth(progress) : direct.blend; }
  };
  return api;
}
