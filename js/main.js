import { createShapes } from './shapes.js';
import { createFace } from './face.js';
import { createVoice } from './voice.js';
import { startStage } from './stage.js';

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const N = Math.min(window.innerWidth, window.innerHeight) < 600 ? 9000 : 16000;
document.getElementById('r-n').textContent = N.toLocaleString('en-GB');

const shapes = createShapes(N);
const face = createFace(shapes, reduce);
const state = { mode: 'nebula', modeT: 0, clock: 0, exprName: 'neutral' };
const el = {
  state: document.getElementById('r-state'), expr: document.getElementById('r-expr'),
  voice: document.getElementById('r-voice'), caption: document.getElementById('caption'),
  wake: document.getElementById('wake'), sound: document.getElementById('sound')
};
const LABEL = { nebula: 'Nebula', face: 'Face', tree: 'Tree' };
let soundOn = true;
let updateVoice, renderVoice;
const voice = createVoice({
  caption: el.caption,
  readout: el.voice,
  getClock: () => state.clock,
  onFrame: update => { updateVoice = update; },
  onRender: render => { renderVoice = render; }
});

function setMode(m) {
  if (m === state.mode) return;
  state.mode = m;
  state.modeT = state.clock;
  el.state.textContent = LABEL[m];
  document.querySelectorAll('[data-mode]').forEach(function (b) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  });
  el.wake.textContent = m === 'nebula' ? 'Wake Nova' : 'Dissolve';
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

startStage({
  shapes, reduce, state,
  onFrame: (dt, clock) => updateVoice(dt, clock),
  updateFace: (dt, clock) => face.update(dt, clock, state.exprName, voice.currentEnvelope()),
  onRender: () => renderVoice()
});

// Each new interaction invalidates the pending steps of the scripted sequence.
let seqId = 0;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function stopAll() { seqId++; voice.stop(); }
async function runSequence() {
  const id = ++seqId; function alive() { return id === seqId; }
  setExpr('neutral'); setMode('face'); restCaption('Forming…');
  await sleep(3000); if (!alive()) return;
  setExpr('warm'); await voice.speak("Hello. I'm Nova."); if (!alive()) return;
  await sleep(350); if (!alive()) return;
  setExpr('neutral'); await voice.speak("I'm not a person. I'm a voice, and a cloud of light that takes whatever shape helps."); if (!alive()) return;
  setExpr('curious'); await voice.speak("Say we're talking about trees."); if (!alive()) return;
  setMode('tree'); await sleep(1400); if (!alive()) return;
  await voice.speak("Roots below. A trunk to carry the weight. A canopy reaching for the light."); if (!alive()) return;
  await sleep(1600); if (!alive()) return;
  setExpr('warm'); setMode('face'); restCaption('Returning…');
  await sleep(2600); if (!alive()) return;
  await voice.speak("And then I come back to you."); if (!alive()) return;
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
    stopAll(); setMode(b.dataset.mode);
    restCaption(b.dataset.mode === 'nebula' ? 'At rest.' : b.dataset.mode === 'tree' ? 'Showing a tree.' : 'Listening.');
  });
});
document.querySelectorAll('[data-expr]').forEach(function (b) {
  b.addEventListener('click', function () { setExpr(b.dataset.expr); });
});
document.getElementById('line').addEventListener('click', async function () {
  stopAll(); const id = seqId;
  if (state.mode !== 'face') { setMode('face'); restCaption('Forming…'); await sleep(2800); if (id !== seqId) return; }
  voice.speak("This is a test line, so you can watch the mouth follow the voice.");
});
el.sound.addEventListener('click', function () {
  soundOn = !soundOn;
  voice.setSoundOn(soundOn);
  el.sound.setAttribute('aria-pressed', String(soundOn));
  el.sound.textContent = soundOn ? 'Sound on' : 'Sound off';
});
