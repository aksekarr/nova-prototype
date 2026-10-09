import { createShapes } from './shapes.js';
import { loadFaceMap } from './facemap.js';
import { createFace } from './face.js';
import { createVoice } from './voice.js';
import { startStage } from './stage.js';

// This page uses cached audio and synthetic input only. It never opens a mic.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  || new URLSearchParams(location.search).has('reduce');
const maps = await loadFaceMap();
const designs = createShapes(32000, maps);
const shapes = { ...designs, ...designs.FACE_V3 };
const face = createFace(shapes, reduce);
const state = { mode: 'face', modeT: -10, clock: 10, speaking: false };
const voice = createVoice({ caption: document.createElement('p'), readout: document.createElement('span') });
const metrics = document.getElementById('metrics');
let mode = 'neutral', began = 0, tuning, flowing = true, travelling = true, updatedTags = true;
let eyeStyle = 'relaxed', eyeMoments = true;
let metricsAt = 0, maxAccent = 0, frames = 0, nonfinite = 0, occurrence = 0;
const tagExamples = { chuckle: 'chuckles', laughing: 'laughing', sighs: 'sighs',
  confidently: 'confidently', warmly: 'warmly' };
function tagTuning() {
  const cueMap = { ...tuning.cueMap };
  if (!updatedTags) Object.assign(cueMap, {
    sigh: { kind: 'sigh', pose: 'concern', amount: .8 },
    sighs: { kind: 'sigh', pose: 'concern', amount: .8 },
    confidently: { kind: 'mood', pose: 'delighted', amount: .5 },
    warm: { kind: 'mood', pose: 'content', amount: 1 },
    warmly: { kind: 'mood', pose: 'content', amount: 1 }
  });
  return { cueMap, sighAmount: updatedTags ? 1 : 0 };
}

function choose(next) {
  voice.stop();
  face.setPose('neutral');
  mode = next;
  began = state.clock;
  occurrence++;
  maxAccent = 0;
  if (next === 'curious' || next === 'thoughtful') {
    const cue = tuning.cueMap[next];
    face.setPose(cue.pose, cue.amount);
  }
}

startStage({
  shapes, reduce, state, nebulaEnhancement: true,
  applyFaceTuning(value) {
    tuning = value;
    face.applyTuning({ ...value, ...tagTuning(), formAmount: flowing ? 1 : 0,
      speechFlowAmount: travelling ? 1 : 0, eyeStyle, eyeMoments });
  },
  onFrame(dt) { voice.update(dt); },
  updateFace(dt, clock) {
    const age = clock - began, speech = mode === 'speech';
    const tag = tagExamples[mode];
    const cues = tag && age < 4.8 ? {
      replyId: `preview:${occurrence}`, position: age, state: 'speaking',
      cues: [{ id: 'preview-tag', type: 'tag', name: tag, start: 0, end: .5 }]
    } : speech ? voice.currentCues() : null;
    const listening = mode === 'listening';
    const input = listening && age < 9 ? .18 : 0;
    state.speaking = speech && Boolean(voice.currentCues());
    face.update(dt, clock, cues, speech ? voice.currentEnvelope() : 0,
      voice.currentShape(), state.speaking, voice.lastReplyEnd(), listening, null, input);
    frames++;
    maxAccent = Math.max(maxAccent, Math.abs(shapes.headDisplay.diagnostics.accent.value));
    for (const value of Object.values(face.diagnostics.rendered)) {
      if (typeof value === 'number' && !Number.isFinite(value)) nonfinite++;
    }
    if (clock - metricsAt > .2) {
      metricsAt = clock;
      metrics.textContent = JSON.stringify({ mode, frames, nonfinite, reduced: reduce,
        accentStarts: shapes.headDisplay.diagnostics.accent.starts, maxAccent,
        head: face.diagnostics.head, form: face.diagnostics.form,
        eyes: face.diagnostics.eyes,
        speechFlow: shapes.headDisplay.diagnostics.accent.flow,
        gesture: { kind: shapes.headDisplay.diagnostics.gesture.kind,
          value: shapes.headDisplay.diagnostics.gesture.value,
          starts: shapes.headDisplay.diagnostics.gesture.starts },
        expression: { browL: face.diagnostics.expression.browL,
          browKnit: face.diagnostics.expression.browKnit,
          mouthOpen: face.diagnostics.expression.mouthOpen }
      }, null, 2);
    }
  }
});

for (const name of ['neutral', 'curious', 'thoughtful', 'listening', ...Object.keys(tagExamples)]) {
  document.getElementById(name).onclick = () => choose(name);
}
document.getElementById('stop').onclick = () => choose('neutral');
document.getElementById('speech').onclick = async () => {
  choose('speech');
  const request = began;
  await voice.activate();
  await voice.preload(['intro']);
  // A later button press cancels this request even while audio is loading.
  if (mode !== 'speech' || began !== request) return;
  face.setReplyText(voice.getLabLine('intro').text);
  await voice.speak('intro');
};
document.getElementById('flow').onchange = event => {
  flowing = event.target.checked;
  face.applyTuning({ formAmount: flowing ? 1 : 0 });
};

document.getElementById('speech-flow').onchange = event => {
  travelling = event.target.checked;
  face.applyTuning({ speechFlowAmount: travelling ? 1 : 0 });
};

document.getElementById('tag-expressions').onchange = event => {
  updatedTags = event.target.checked;
  face.applyTuning(tagTuning());
};

document.getElementById('eye-style').onchange = event => {
  eyeStyle = event.target.value;
  face.applyTuning({ eyeStyle });
};
document.getElementById('eye-moments').onchange = event => {
  eyeMoments = event.target.checked;
  face.applyTuning({ eyeMoments });
};
