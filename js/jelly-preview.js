// Explicit visual study only: no speech, microphone, inactivity timer or chat UI.
import { createShapes } from './shapes.js';
import { createFace } from './face.js';
import { loadFaceMap } from './facemap.js';
import { createJellyfish } from './jellyfish.js';
import { createJellyMotion } from './jelly-motion.js';
import { createStreamMorph } from './stream-morph.js';
import { startStage } from './stage.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const requested = new URLSearchParams(location.search).get('n');
const parsed = requested === null || requested.trim() === '' ? NaN : Number(requested);
const N = Number.isFinite(parsed) ? Math.max(4000, Math.min(64000, Math.round(parsed))) : 48000;
const status = document.getElementById('form-status');
const buttons = [...document.querySelectorAll('[data-form]')];
try {
  const maps = await loadFaceMap();
  const designs = createShapes(N, maps);
  const shapes = { ...designs, ...designs.FACE_V3 };
  const face = createFace(shapes, reduce);
  const jelly = createJellyfish(N, reduce);
  const motion = createJellyMotion(reduce);
  const state = { mode: 'face', modeT: 0, clock: 0, speaking: false };
  let jellyEpoch = 0;
  const outlet = new Float32Array([.95, 1.25, .2]);
  const idleForm = {
    positions: jelly.positions, colours: jelly.colours, bounds: motion.bounds,
    cameraDepth: motion.cameraDepth,
    morphOptions() { return { outlet, inlet: motion.inlet }; },
    update(clock) {
      const t = Math.max(0, clock - jellyEpoch);
      jelly.update(t);
      // The bell leads; every trailing slice follows its earlier route.
      motion.apply(jelly.positions, t, innerWidth / innerHeight);
      outlet[0] = Math.min(.95, Math.max(.35, motion.inlet[0] * .5));
    }
  };
  idleForm.update(0);
  const formMorph = createStreamMorph(shapes.BASE, idleForm.positions, { reduce });
  const rest = { w: 1, h: 1, round: 0, close: 0 };
  startStage({
    shapes, idleForm, formMorph, reduce, state,
    applyFaceTuning: face.applyTuning,
    updateFace(dt, clock) {
      if (state.mode === 'face') face.update(dt, clock, null, 0, rest, false, null, false);
    },
    onFrame() {}
  });
  status.textContent = `${N.toLocaleString('en-GB')} living particles`;
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener('click', () => {
      const next = button.dataset.form;
      if (state.mode === next) return;
      if (next === 'jelly') { jellyEpoch = state.clock; idleForm.update(state.clock); }
      state.mode = next; state.modeT = state.clock;
      for (const choice of buttons) choice.setAttribute('aria-pressed', String(choice === button));
    });
  }
} catch (error) {
  status.textContent = 'Seni could not load. Please reload to try again.';
  console.error('Jellyfish preview could not start.', error);
}
