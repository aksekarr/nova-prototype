// Compare illumination on the same running galaxy; no voice connection or idle timer.
import { createShapes } from './shapes.js';
import { createFace } from './face.js';
import { loadFaceMap } from './facemap.js';
import { startStage } from './stage.js';

const params = new URLSearchParams(location.search);
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const requested = params.get('n');
const parsed = requested === null || requested.trim() === '' ? NaN : Number(requested);
const defaultN = Math.min(innerWidth, innerHeight) < 600 ? 9000 : 32000;
const N = Number.isFinite(parsed) ? Math.max(4000, Math.min(64000, Math.round(parsed))) : defaultN;
const status = document.getElementById('form-status');
const buttons = [...document.querySelectorAll('[data-view]')];
try {
  const maps = await loadFaceMap();
  const designs = createShapes(N, maps);
  const shapes = { ...designs, ...designs.FACE_V3 };
  const face = createFace(shapes, reduce);
  const state = { mode: 'nebula', modeT: 0, clock: 0, speaking: false };
  const rest = { w: 1, h: 1, round: 0, close: 0 };
  const stage = startStage({
    shapes, reduce, state, nebulaEnhancement: true,
    applyFaceTuning: face.applyTuning,
    updateFace(dt, clock) {
      if (state.mode === 'face') face.update(dt, clock, null, 0, rest, false, null, false);
    },
    onFrame() {}
  });
  function select(view) {
    const mode = view === 'face' ? 'face' : 'nebula';
    stage.setNebulaEnhanced(view === 'enhanced');
    if (state.mode !== mode) { state.mode = mode; state.modeT = state.clock; }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  status.textContent = `${N.toLocaleString('en-GB')} particles`;
  for (const button of buttons) {
    button.disabled = false;
    button.addEventListener('click', () => select(button.dataset.view));
  }
  select(params.get('nebula') === 'original' ? 'original' : 'enhanced');
} catch (error) {
  status.textContent = 'Seni could not load. Please reload to try again.';
  console.error('Nebula preview could not start.', error);
}
