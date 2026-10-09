// Explicit visual mode switch only. No voice connection, microphone or idle timer.
import { createShapes } from './shapes.js';
import { createFace } from './face.js';
import { loadFaceMap } from './facemap.js';
import { createOrbital } from './orbital.js';
import { createFormMorph } from './form-morph.js';
import { startStage } from './stage.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const requested = new URLSearchParams(window.location.search).get('n');
const parsed = requested === null || requested.trim() === '' ? NaN : Number(requested);
const N = Number.isFinite(parsed) ? Math.max(4000, Math.min(64000, Math.round(parsed))) : 48000;
const status = document.getElementById('form-status');
const buttons = [...document.querySelectorAll('[data-form]')];
try {
  const maps = await loadFaceMap();
  const designs = createShapes(N, maps);
  const shapes = { ...designs, ...designs.FACE_V3 };
  const face = createFace(shapes, reduce);
  const orbital = createOrbital(N, reduce);
  orbital.update(0);
  const formMorph = createFormMorph(shapes.BASE, orbital.positions, { reduce });
  const state = { mode: 'face', modeT: 0, clock: 0, speaking: false };
  const rest = { w: 1, h: 1, round: 0, close: 0 };
  startStage({
    shapes, orbital, formMorph, reduce, state,
    applyFaceTuning: face.applyTuning,
    updateFace(dt, clock) {
      // The static source snapshot owns the outward journey. Resume the live
      // face when returning; its displayed target includes the current pose.
      if (state.mode === 'face') face.update(dt, clock, null, 0, rest, false, null, false);
    },
    onFrame() {}
  });
  status.textContent = `${N.toLocaleString('en-GB')} living particles`;
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener('click', () => {
      if (state.mode === button.dataset.form) return;
      state.mode = button.dataset.form; state.modeT = state.clock;
      for (const choice of buttons) choice.setAttribute('aria-pressed', String(choice === button));
    });
  }
} catch (error) {
  status.textContent = 'Seni could not load. Please reload to try again.';
  console.error('Form preview could not start.', error);
}
