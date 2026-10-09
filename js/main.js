import { createShapes } from './shapes.js';
import { createFace, EXPR } from './face.js';
import { createVoice } from './voice.js';
import { startStage } from './stage.js';
import { loadFaceMap } from './facemap.js';
import { loadReferenceClips, playReferenceClip } from './flanger.js';
import { createStudyFlow } from './study-flow.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(window.location.search);
// Older Orbit links open the standalone preview; live and tuning retain priority.
if (params.get('orbit') === '1' && params.get('live') !== '1' && params.get('tune') !== '1') {
  const target = new URL('./orbit.html', window.location.href);
  if (params.has('n')) target.searchParams.set('n', params.get('n'));
  window.location.replace(target.href);
}
const requestedN = params.get('n');
const parsedN = requestedN === null || requestedN.trim() === '' ? NaN : Number(requestedN);

let faceMaps = null;
try {
  faceMaps = await loadFaceMap();
} catch (error) {
  console.warn('Face maps could not be loaded.', error);
}
const defaultN = Math.min(window.innerWidth, window.innerHeight) < 600 ? 9000 : faceMaps ? 32000 : 16000;
const N = Number.isFinite(parsedN) ? Math.max(4000, Math.min(64000, Math.round(parsedN))) : defaultN;
document.getElementById('r-n').textContent = N.toLocaleString('en-GB');
const designs = createShapes(N, faceMaps);
const shapes = { ...designs, ...designs.FACE_V3 };
const face = designs.FACE_V3 ? createFace(shapes, reduce) : { update() {}, applyTuning() {} };
const FACE_UNAVAILABLE = 'Face unavailable. Staying in nebula.';
const state = { mode: 'nebula', modeT: 0, clock: 0, speaking: false };
const el = {
  state: document.getElementById('r-state'), expr: document.getElementById('r-expr'),
  voice: document.getElementById('r-voice'), caption: document.getElementById('caption'),
  wake: document.getElementById('wake'), sound: document.getElementById('sound'),
  line: document.getElementById('line')
};
const LABEL = { nebula: 'Nebula', face: 'Face', tree: 'Tree' };
let soundOn = true;
let previewListening = false, mouthLab = null, live = null;
const voice = createVoice({
  caption: el.caption,
  readout: el.voice
});
const captureTools = params.get('live') === '1' || params.get('tune') === '1'
  ? await import('./capture.js') : null;
const flow = createStudyFlow({ voice, face, state, el, setMode, restCaption,
  isTuning: params.get('tune') === '1', captureTools, stopLive: () => live?.stop() });
flow.prepare();

// The provider adapter and its development controls stay behind the live flag.
if (params.get('live') === '1') {
  const { createLiveStudy } = await import('./live.js');
  live = createLiveStudy({ voice, face, state, el, setMode, setExpr, restCaption,
    stopAll: flow.stopAll, beginMouthPlayback: flow.beginMouthPlayback,
    finishMouthPlayback: flow.finishMouthPlayback, captureTools });
}

function setMode(m) {
  if (!faceMaps) { restCaption(FACE_UNAVAILABLE); return false; }
  if (m === state.mode) return true;
  state.mode = m;
  state.modeT = state.clock;
  el.state.textContent = LABEL[m];
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  });
  el.wake.textContent = m === 'nebula' ? 'Wake Nova' : 'Dissolve';
  return true;
}

const expressionButtons = [];
const expressionRow = document.querySelector('[data-expr]')?.parentElement;
if (expressionRow) {
  expressionRow.replaceChildren();
  expressionRow.style.maxWidth = 'min(540px, calc(100vw - 48px))';
  expressionRow.style.flexWrap = 'wrap';
  for (const name of ['neutral', ...Object.keys(EXPR)]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.expr = name;
    button.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    button.setAttribute('aria-pressed', String(name === 'neutral'));
    button.addEventListener('click', () => setExpr(name));
    expressionButtons.push(button);
    expressionRow.append(button);
  }
}

function renderExpressionSelection({ name, intensity, active }) {
  const title = active.charAt(0).toUpperCase() + active.slice(1);
  if (el.expr.textContent !== title) el.expr.textContent = title;
  for (const button of expressionButtons) {
    const pressed = String(button.dataset.expr === active);
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
  }
  // The tuning panel follows explicit face selections without feeding them
  // back into applyTuning or creating another writer for the main readout.
  document.dispatchEvent(new CustomEvent('nova-pose', { detail: { name, intensity } }));
}
face.onSelectionChange?.(renderExpressionSelection);
document.addEventListener('nova-pose-select', event => {
  setExpr(event.detail.name, event.detail.intensity);
});

function setExpr(name, intensity = 1) {
  face.setPose?.(name, intensity);
}

function restCaption(text) {
  el.caption.className = 'caption rest';
  el.caption.textContent = text;
}

if (!faceMaps) restCaption(FACE_UNAVAILABLE);

startStage({
  shapes, reduce, state,
  nebulaEnhancement: params.get('nebula') !== 'original',
  speechLab: {
    connectMouthLab(lab) {
      mouthLab = lab;
      flow.connectMouthLab(lab);
    },
    play: flow.playLabLine,
    simulate: flow.simulateLabLine,
    loadCapture: async file => captureTools.parseCapture(await file.text()),
    replay: flow.replayCapture,
    interrupt: flow.stopAll,
    setPreviewListening(value) {
      if (params.get('tune') === '1') previewListening = Boolean(value);
    },
    references: {
      load: loadReferenceClips,
      play(kind) { return flow.playReference(() => playReferenceClip(kind)); }
    }
  },
  applyFaceTuning: face.applyTuning,
  onFrame: dt => {
    voice.update(dt);
    flow.onFrame();
    live?.onFrame();
  },
  updateFace: (dt, clock) => {
    const envelope = voice.currentEnvelope(), shape = voice.currentShape();
    face.update(dt, clock, voice.currentCues(), envelope, shape,
      state.speaking, voice.lastReplyEnd(), previewListening
        || Boolean(live?.listening),
      mouthLab);
  }
});

el.wake.addEventListener('click', () => {
  if (state.mode === 'nebula') flow.runSequence();
  else { flow.stopAll(); setExpr('neutral'); setMode('nebula'); restCaption('At rest. Press Wake Nova to watch it form, speak and change shape.'); }
});
document.querySelectorAll('[data-mode]').forEach(b => {
  b.addEventListener('click', () => {
    flow.stopAll(); if (!setMode(b.dataset.mode)) return;
    restCaption(b.dataset.mode === 'nebula' ? 'At rest.' : b.dataset.mode === 'tree' ? 'Showing a tree.' : 'Listening.');
  });
});
el.line.addEventListener('click', flow.playTestLine);
el.sound.addEventListener('click', () => {
  soundOn = !soundOn;
  voice.setSoundOn(soundOn);
  el.sound.setAttribute('aria-pressed', String(soundOn));
  el.sound.textContent = soundOn ? 'Sound on' : 'Sound off';
});
