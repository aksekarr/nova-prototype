import { createShapes } from './shapes.js';
import { createOrbital } from './orbital.js';
import { createJellyfish } from './jellyfish.js';
import { createJellyMotion } from './jelly-motion.js';
import { createFormMorph } from './form-morph.js';
import { createStreamMorph } from './stream-morph.js';

const isIdle = mode => mode === 'orbit' || mode === 'jelly';
const validModes = new Set(['nebula', 'face', 'orbit', 'jelly']);

// The landing's face pool keeps its original density. A separate display pool
// admits the extra idle grains as dark duplicates, then gives every grain one
// of the existing form's live destinations. Returning fades only those extras.
export function createLandingForms({ shapes, reduce = false, idleCount = 48000 }) {
  const faceCount = shapes.N;
  if (!Number.isInteger(faceCount) || faceCount < 1 || !Number.isInteger(idleCount) || idleCount < 1) {
    throw new RangeError('Particle counts must be positive integers.');
  }
  const count = Math.max(faceCount, idleCount), length = count * 3;
  let ready = false, pending = false, active = false, selected = 'nebula', settled = 'nebula';
  let positions, colours, targetPositions, targetColours, sizes, orbit, jelly, motion;
  let orbitMorph, jellyMorph, morph, jellyEpoch = 0, aspect = 1;
  const outlet = new Float32Array([.95, 1.25, .2]);

  function extend(source, destination, colour = false) {
    const suppliedCount = source.length / 3;
    if (!Number.isInteger(suppliedCount) || suppliedCount < 1 || suppliedCount > count) {
      throw new RangeError('Source must be an xyz pool no larger than the display pool.');
    }
    destination.set(source);
    for (let i = suppliedCount; i < count; i++) {
      const j = i * 3, k = (i % suppliedCount) * 3;
      for (let c = 0; c < 3; c++) destination[j + c] = colour ? 0 : source[k + c];
    }
  }

  function prepare(initialAspect = 1) {
    if (ready) return;
    aspect = Number.isFinite(initialAspect) && initialAspect > 0 ? initialAspect : 1;
    positions = new Float32Array(length); colours = new Float32Array(length);
    targetPositions = new Float32Array(length); targetColours = new Float32Array(length);
    extend(shapes.BASE || shapes.FACE || shapes.NEB, positions);
    // Shapes uses a private generator; requesting the study's size distribution
    // cannot advance or alter the original face/nebula buffers.
    sizes = createShapes(count).SIZE;
    orbit = createOrbital(count, reduce);
    jelly = createJellyfish(count, reduce);
    motion = createJellyMotion(reduce);
    motion.apply(jelly.positions, 0, aspect);
    orbitMorph = createFormMorph(positions, orbit.positions, { reduce });
    jellyMorph = createStreamMorph(positions, jelly.positions, { reduce });
    ready = true;
  }

  function select(mode, clock) {
    if (!validModes.has(mode)) throw new RangeError(`Unknown landing form: ${mode}`);
    if (mode === selected) return;
    if (isIdle(mode)) prepare();
    selected = mode;
    if (isIdle(mode)) {
      if (mode === 'jelly') jellyEpoch = Number.isFinite(clock) ? clock : 0;
      pending = true;
    } else if (active || pending) pending = true;
    else settled = mode;
  }

  function updateTarget(clock, nextAspect) {
    aspect = nextAspect;
    if (selected === 'orbit') orbit.update(clock);
    else if (selected === 'jelly') {
      const time = Math.max(0, clock - jellyEpoch);
      jelly.update(time);
      motion.apply(jelly.positions, time, aspect);
      outlet[0] = Math.min(.95, Math.max(.35, motion.inlet[0] * .5));
    }
  }

  function begin(sourcePositions, sourceColours, clock, nextAspect) {
    if (!pending) return;
    prepare();
    // The renderer may pass the adapter's own output when changing direction.
    extend(sourcePositions, targetPositions);
    extend(sourceColours, targetColours, true);
    positions.set(targetPositions); colours.set(targetColours);
    updateTarget(clock, nextAspect);
    morph = selected === 'jelly' ? jellyMorph : isIdle(selected) ? orbitMorph : morph || orbitMorph;
    morph.begin(positions, colours, clock, {
      reverse: !isIdle(selected), outlet, inlet: motion.inlet
    });
    pending = false; active = true;
  }

  function sample(clock, nextAspect, normalPositions, normalColours) {
    if (!active) return;
    updateTarget(clock, nextAspect);
    const target = selected === 'orbit' ? orbit : selected === 'jelly' ? jelly : null;
    if (target) morph.sample(clock, target.positions, target.colours);
    else {
      extend(normalPositions, targetPositions);
      extend(normalColours, targetColours, true);
      morph.sample(clock, targetPositions, targetColours);
    }
    positions.set(morph.positions); colours.set(morph.colours);
    if (!morph.active) settled = selected;
  }

  function finish() {
    if (pending || morph?.active || isIdle(selected)) return false;
    active = false;
    return true;
  }

  return {
    count, faceCount, prepare, select, begin, sample, finish,
    get ready() { return ready; },
    get active() { return active; },
    get pending() { return pending; },
    get transitioning() { return pending || (active && Boolean(morph?.active)); },
    get settledMode() { return settled; },
    get mode() { return selected; },
    get positions() { return positions; },
    get colours() { return colours; },
    get sizes() { return sizes; },
    get blend() { return morph?.blend ?? 1; },
    get progress() { return morph?.progress ?? 1; },
    cameraDepth(nextAspect, slope) {
      if (selected === 'jelly') return motion.cameraDepth(nextAspect, slope);
      const fit = slope * Math.min(.84, nextAspect * .84);
      return orbit.bounds.radius * Math.sqrt(1 + 1 / (fit * fit));
    }
  };
}
