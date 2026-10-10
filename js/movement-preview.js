import { createShapes } from './shapes.js';
import { loadFaceMap } from './facemap.js';
import { createFace } from './face.js';
import { createVoice } from './voice.js';
import { startStage } from './stage.js';

// Cached audio and synthetic cues only. This page never opens a microphone.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  || new URLSearchParams(location.search).has('reduce');
const maps = await loadFaceMap();
const designs = createShapes(32000, maps);
const shapes = { ...designs, ...designs.FACE_V3 };
const face = createFace(shapes, reduce);
const state = { mode: 'face', modeT: -10, clock: 10, speaking: false };
const voice = createVoice({ caption: document.createElement('p'), readout: document.createElement('span') });
const metrics = document.getElementById('metrics');
const status = document.getElementById('timing-status');
const examples = { confidently: 'confidently', concerned: 'concerned', curious: 'curious',
  thoughtful: 'thoughtful', warmly: 'warmly', chuckle: 'chuckles', laughing: 'laughing',
  sighs: 'sighs', cheerful: 'cheerful', excited: 'excited' };
const sequence = Object.keys(examples);
const labelFor = name => name[0].toUpperCase() + name.slice(1);
let mode = 'neutral', choice = 'confidently', began = 0, occurrence = 0;
let withSpeech = false, pending = false, error = '', sequenceIndex = -1;
let metricsAt = 0, maxAccent = 0, frames = 0, nonfinite = 0;
let eyeStyle = 'auto', eyeMoments = true;

function choose(next, inSequence = false) {
  if (!inSequence) sequenceIndex = -1;
  voice.stop();
  face.setPose('neutral');
  mode = next;
  began = state.clock;
  occurrence++;
  maxAccent = 0; pending = false; error = '';
}

function nextExample() {
  if (sequenceIndex < 0) return;
  if (++sequenceIndex < sequence.length) playExpression(sequence[sequenceIndex], true);
  else sequenceIndex = -1;
}

async function playExpression(name = choice, inSequence = false) {
  choice = name;
  choose('expression', inSequence);
  if (!withSpeech) return;
  const request = occurrence;
  pending = true;
  try {
    await voice.activate();
    await voice.preload(['lab-slow']);
    if (mode !== 'expression' || occurrence !== request) return;
    pending = false;
    face.setReplyText(voice.getLabLine('lab-slow').text);
    await voice.speak('lab-slow');
    if (occurrence === request) nextExample();
  } catch {
    if (occurrence !== request) return;
    pending = false;
    sequenceIndex = -1;
    error = 'Cached speech could not play. Switch off “With cached speech” to try silently.';
  }
}

startStage({
  shapes, reduce, state, nebulaEnhancement: true,
  applyFaceTuning(value) { face.applyTuning({ ...value, eyeStyle, eyeMoments }); },
  onFrame(dt) { voice.update(dt); },
  updateFace(dt, clock) {
    const age = clock - began, expression = mode === 'expression';
    const speech = mode === 'speech' || (expression && withSpeech);
    const played = speech ? voice.currentCues() : null;
    const synthetic = [{ id: 'preview-tag', type: 'tag', name: examples[choice], start: 0, end: .5 }];
    // Speech always uses the real playback clock and mouth. Only the selected
    // delivery tag is substituted; no recording is generated or modified.
    const cues = expression ? withSpeech ? played && {
      ...played, cues: [...synthetic, ...played.cues.filter(cue => cue.type !== 'tag')]
    } : age < 12 ? {
      replyId: `preview:${occurrence}`, position: age, state: 'speaking', cues: synthetic
    } : null : played;
    const listening = mode === 'listening';
    state.speaking = speech && Boolean(played);
    face.update(dt, clock, cues, speech ? voice.currentEnvelope() : 0,
      voice.currentShape(), state.speaking, voice.lastReplyEnd(), listening, null,
      listening && age < 9 ? .18 : 0);
    frames++;
    maxAccent = Math.max(maxAccent, Math.abs(shapes.headDisplay.diagnostics.accent.value));
    for (const value of Object.values(face.diagnostics.rendered)) {
      if (typeof value === 'number' && !Number.isFinite(value)) nonfinite++;
    }
    if (clock - metricsAt > .2) {
      metricsAt = clock;
      const position = withSpeech ? played?.position : age;
      status.textContent = error || (expression ? `${labelFor(choice)}${sequenceIndex >= 0
        ? ` · ${sequenceIndex + 1} / ${sequence.length}` : ''} · ${pending ? 'Loading speech…'
        : position === undefined || (!withSpeech && age >= 12) ? 'Finished — replay or choose another'
        : `${withSpeech ? 'Cached speech' : 'Silent'} · ${position.toFixed(1)} s`}`
        : 'Choose an expression or Watch all.');
      metrics.textContent = JSON.stringify({ mode, choice, frames, nonfinite, reduced: reduce,
        cues: face.diagnostics.cues, accentStarts: shapes.headDisplay.diagnostics.accent.starts,
        maxAccent, head: face.diagnostics.head, form: face.diagnostics.form,
        eyes: face.diagnostics.eyes, performance: face.diagnostics.performance,
        moodEdges: face.diagnostics.moodEdges,
        speechFlow: shapes.headDisplay.diagnostics.accent.flow,
        gesture: { kind: shapes.headDisplay.diagnostics.gesture.kind,
          value: shapes.headDisplay.diagnostics.gesture.value,
          starts: shapes.headDisplay.diagnostics.gesture.starts },
        expression: face.diagnostics.expression
      }, null, 2);
    }
    if (expression && !withSpeech && age >= 12) nextExample();
  }
});

for (const name of ['neutral', 'listening']) document.getElementById(name).onclick = () => choose(name);
document.getElementById('stop').onclick = () => choose('neutral');
for (const name of sequence) document.getElementById(`timing-${name}`).onclick = () => playExpression(name);
document.getElementById('replay').onclick = () => playExpression();
document.getElementById('watch-all').onclick = () => { sequenceIndex = 0; playExpression(sequence[0], true); };
document.getElementById('timing-speech').onchange = event => {
  withSpeech = event.target.checked;
  if (mode === 'expression') playExpression();
};
document.getElementById('speech').onclick = async () => {
  choose('speech');
  const request = occurrence;
  try {
    await voice.activate();
    await voice.preload(['intro']);
    if (mode !== 'speech' || occurrence !== request) return;
    face.setReplyText(voice.getLabLine('intro').text);
    await voice.speak('intro');
  } catch {
    if (occurrence === request) error = 'Cached speech could not play.';
  }
};
document.getElementById('eye-style').onchange = event => {
  eyeStyle = event.target.value;
  face.applyTuning({ eyeStyle });
};
document.getElementById('eye-moments').onchange = event => {
  eyeMoments = event.target.checked;
  face.applyTuning({ eyeMoments });
};

// Enable controls only after assets, stage and every handler are ready.
document.getElementById('preview-controls').disabled = false;
