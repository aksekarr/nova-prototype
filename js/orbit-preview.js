// A visual study for future text chat. No face, speech or microphone lifecycle.
import { createShapes } from './shapes.js';
import { createOrbital } from './orbital.js';
import { startStage } from './stage.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const requested = new URLSearchParams(window.location.search).get('n');
const parsed = requested === null || requested.trim() === '' ? NaN : Number(requested);
// A narrow desktop panel should not be mistaken for a low-power device.
const N = Number.isFinite(parsed) ? Math.max(4000, Math.min(64000, Math.round(parsed))) : 48000;
document.getElementById('orbit-count').textContent = N.toLocaleString('en-GB');
const shapes = createShapes(N);
const orbital = createOrbital(N, reduce);
const state = { mode: 'orbit', modeT: 0, clock: 0, speaking: false };
let reformAt = null;
startStage({
  shapes, orbital, reduce, state,
  updateFace() {}, applyFaceTuning() {},
  onFrame() {
    if (reformAt !== null && state.clock >= reformAt) {
      state.mode = 'orbit'; state.modeT = state.clock; reformAt = null;
    }
  }
});
document.getElementById('reform').addEventListener('click', () => {
  if (reduce) return;
  state.mode = 'nebula'; state.modeT = state.clock; reformAt = state.clock + 1.1;
});
document.getElementById('reform').hidden = reduce;
