// Standalone study of the Lotus used in the landing's Surprise Me cycle.
import { createShapes } from './shapes.js';
import { createLotus } from './lotus.js';
import { startStage } from './stage.js';

const status = document.getElementById('lotus-status');
const bloom = document.getElementById('bloom');
try {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const requested = new URLSearchParams(location.search).get('n');
  const parsed = requested === null || requested.trim() === '' ? NaN : Number(requested);
  const N = Number.isFinite(parsed) ? Math.max(4000, Math.min(64000, Math.round(parsed))) : 48000;
  const lotus = createLotus(N, reduce);
  // The existing generic orbital renderer accepts any live particle target.
  // Begin at the bud itself so this study opens without a nebula entrance.
  const shapes = { ...createShapes(N), NEB: lotus.positions.slice(), NEB_COL: lotus.colours.slice() };
  const state = { mode: 'orbit', modeT: 0, clock: 0, speaking: false };
  let lastOpen = null;
  function renderStatus() {
    const open = lotus.openness >= .999;
    if (open === lastOpen) return;
    lastOpen = open;
    status.textContent = open ? 'A quiet bloom in the light' : 'Unfolding';
    bloom.disabled = !open;
  }
  startStage({ shapes, orbital: lotus, reduce, state, updateFace() {}, applyFaceTuning() {}, onFrame: renderStatus });
  bloom.hidden = reduce;
  bloom.addEventListener('click', () => { lotus.replay(state.clock); lastOpen = null; renderStatus(); });
  renderStatus();
} catch (error) {
  status.textContent = 'The lotus could not load. Please reload to try again.';
  console.error('Lotus preview could not start.', error);
}
