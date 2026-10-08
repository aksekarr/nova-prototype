import { createShapes } from './shapes.js';
import { createFace } from './face.js';
import { createVoice } from './voice.js';
import { startStage } from './stage.js';
import { loadFaceMap } from './facemap.js';
import { loadReferenceClips, playReferenceClip, stopReferenceClip } from './flanger.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(window.location.search);
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
const state = { mode: 'nebula', modeT: 0, clock: 0, exprName: 'neutral', speaking: false };
const el = {
  state: document.getElementById('r-state'), expr: document.getElementById('r-expr'),
  voice: document.getElementById('r-voice'), caption: document.getElementById('caption'),
  wake: document.getElementById('wake'), sound: document.getElementById('sound'),
  line: document.getElementById('line')
};
const LABEL = { nebula: 'Nebula', face: 'Face', tree: 'Tree' };
let soundOn = true;
const voice = createVoice({
  caption: el.caption,
  readout: el.voice
});
voice.preload(['hello', 'intro', 'trees', 'tree', 'back', 'test']).then(() => {
  el.wake.disabled = false;
  el.line.disabled = false;
}).catch(() => {
  // Voice reports the failure; shape and expression controls remain available.
});

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

function setExpr(n) {
  state.exprName = n;
  el.expr.textContent = n.charAt(0).toUpperCase() + n.slice(1);
  document.querySelectorAll('[data-expr]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.expr === n));
  });
}

function restCaption(text) {
  el.caption.className = 'caption rest';
  el.caption.textContent = text;
}

if (!faceMaps) restCaption(FACE_UNAVAILABLE);

startStage({
  shapes, reduce, state,
  speechLab: {
    play: playLabLine,
    references: {
      load: loadReferenceClips,
      play(kind) { stopAll(); return playReferenceClip(kind); }
    }
  },
  applyFaceTuning: face.applyTuning,
  onFrame: dt => voice.update(dt),
  updateFace: (dt, clock) => {
    face.update(dt, clock, state.exprName, voice.currentEnvelope(), voice.currentShape());
  }
});

// Each new interaction invalidates the pending steps of the scripted sequence.
let seqId = 0, speechId = 0;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function stopAll() { seqId++; speechId++; state.speaking = false; voice.stop(); }
async function speakLine(lineId) {
  const id = ++speechId;
  state.speaking = true;
  try {
    await voice.speak(lineId);
  } finally {
    if (id === speechId) state.speaking = false;
  }
}
async function playLabLine(lineId) {
  stopAll();
  const id = seqId;
  if (state.mode !== 'face') {
    if (!setMode('face')) return;
    restCaption('Forming…');
  }
  const formationWait = Math.max(0, 2800 - (state.clock - state.modeT) * 1000);
  await Promise.all([voice.preload([lineId]), sleep(formationWait)]);
  if (id !== seqId) return;
  await speakLine(lineId);
}
async function runSequence() {
  stopReferenceClip();
  const id = ++seqId; function alive() { return id === seqId; }
  setExpr('neutral'); if (!setMode('face')) return; restCaption('Forming…');
  await sleep(3000); if (!alive()) return;
  setExpr('warm'); await speakLine('hello'); if (!alive()) return;
  await sleep(350); if (!alive()) return;
  setExpr('neutral'); await speakLine('intro'); if (!alive()) return;
  setExpr('curious'); await speakLine('trees'); if (!alive()) return;
  setMode('tree'); await sleep(1400); if (!alive()) return;
  await speakLine('tree'); if (!alive()) return;
  await sleep(1600); if (!alive()) return;
  setExpr('warm'); setMode('face'); restCaption('Returning…');
  await sleep(2600); if (!alive()) return;
  await speakLine('back'); if (!alive()) return;
  setExpr('thinking'); restCaption('Listening.');
  await sleep(1800); if (!alive()) return;
  setExpr('neutral');
}

el.wake.addEventListener('click', function () {
  if (state.mode === 'nebula') runSequence();
  else { stopAll(); setExpr('neutral'); setMode('nebula'); restCaption('At rest. Press Wake Nova to watch it form, speak and change shape.'); }
});
document.querySelectorAll('[data-mode]').forEach(function (b) {
  b.addEventListener('click', function () {
    stopAll(); if (!setMode(b.dataset.mode)) return;
    restCaption(b.dataset.mode === 'nebula' ? 'At rest.' : b.dataset.mode === 'tree' ? 'Showing a tree.' : 'Listening.');
  });
});
document.querySelectorAll('[data-expr]').forEach(function (b) {
  b.addEventListener('click', function () { setExpr(b.dataset.expr); });
});
el.line.addEventListener('click', async function () {
  stopAll(); const id = seqId;
  if (state.mode !== 'face') { if (!setMode('face')) return; restCaption('Forming…'); await sleep(2800); if (id !== seqId) return; }
  speakLine('test');
});
el.sound.addEventListener('click', function () {
  soundOn = !soundOn;
  voice.setSoundOn(soundOn);
  el.sound.setAttribute('aria-pressed', String(soundOn));
  el.sound.textContent = soundOn ? 'Sound on' : 'Sound off';
});
