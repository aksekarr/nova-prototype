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
const timingStatus = document.getElementById('timing-status');
let timingVersion = 'approved', timingChoice = 'thoughtful', timingWithSpeech = false, expressiveEdges = true;
let timingPending = false, timingError = '';
const timingActive = () => mode.startsWith('timing-');
let mode = 'neutral', began = 0, tuning, flowing = true, travelling = true, updatedTags = true;
let eyeStyle = 'auto', eyeMoments = true, expressiveMoods = true;
let metricsAt = 0, maxAccent = 0, frames = 0, nonfinite = 0, occurrence = 0;
const tagExamples = { curious: 'curious', thoughtful: 'thoughtful', chuckle: 'chuckles', laughing: 'laughing', sighs: 'sighs',
  confidently: 'confidently', warmly: 'warmly', cheerful: 'cheerful', excited: 'excited' };
const labelFor = name => name[0].toUpperCase() + name.slice(1);
const expressionTuning = () => ({
  sustainMoods: !timingActive() || timingVersion === 'approved',
  moodEdgeAmount: expressiveEdges ? 1 : 0
});
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
  timingPending = false;
  timingError = '';
  face.applyTuning(expressionTuning());
}

async function playTiming(name = timingChoice) {
  timingChoice = name;
  choose(`timing-${name}`);
  if (!timingWithSpeech) return;
  const request = occurrence;
  timingPending = true;
  try {
    await voice.activate();
    await voice.preload(['lab-slow']);
    if (!timingActive() || occurrence !== request) return;
    timingPending = false;
    face.setReplyText(voice.getLabLine('lab-slow').text);
    await voice.speak('lab-slow');
  } catch {
    if (occurrence !== request) return;
    timingPending = false;
    timingError = 'Cached speech could not play. Switch off “With cached speech” to try silently.';
  }
}

startStage({
  shapes, reduce, state, nebulaEnhancement: true,
  applyFaceTuning(value) {
    tuning = value;
    face.applyTuning({ ...value, ...tagTuning(), formAmount: flowing ? 1 : 0,
      speechFlowAmount: travelling ? 1 : 0, eyeStyle, eyeMoments,
      moodPerformanceAmount: expressiveMoods ? 1 : 0,
      ...expressionTuning() });
  },
  onFrame(dt) { voice.update(dt); },
  updateFace(dt, clock) {
    const age = clock - began, testingTiming = timingActive();
    const speech = mode === 'speech' || (testingTiming && timingWithSpeech);
    const played = speech ? voice.currentCues() : null;
    const tag = tagExamples[testingTiming ? timingChoice : mode];
    const synthetic = [{ id: 'preview-tag', type: 'tag', name: tag, start: 0, end: .5 }];
    // Both timing versions use one recording and the real audio clock/mouth.
    // Replace its delivery tags with the selected test cue; the audio is unchanged.
    const cues = testingTiming && timingWithSpeech ? played && {
      ...played, cues: [...synthetic, ...played.cues.filter(cue => cue.type !== 'tag')]
    } : tag && age < 10 ? {
      replyId: `preview:${occurrence}`, position: age, state: 'speaking', cues: synthetic
    } : played;
    const listening = mode === 'listening';
    const input = listening && age < 9 ? .18 : 0;
    state.speaking = speech && Boolean(played);
    face.update(dt, clock, cues, speech ? voice.currentEnvelope() : 0,
      voice.currentShape(), state.speaking, voice.lastReplyEnd(), listening, null, input);
    frames++;
    maxAccent = Math.max(maxAccent, Math.abs(shapes.headDisplay.diagnostics.accent.value));
    for (const value of Object.values(face.diagnostics.rendered)) {
      if (typeof value === 'number' && !Number.isFinite(value)) nonfinite++;
    }
    if (clock - metricsAt > .2) {
      metricsAt = clock;
      if (testingTiming) {
        const label = `${labelFor(timingChoice)} · ${timingVersion === 'approved' ? 'Approved timing' : 'Previous timing'}`;
        const position = timingWithSpeech ? played?.position : Math.min(age, 10);
        timingStatus.textContent = timingError || `${label} · ${timingPending ? 'Loading speech…'
          : position === undefined || (!timingWithSpeech && age >= 10) ? 'Finished — replay or switch timing'
          : `${timingWithSpeech ? 'Cached speech' : 'Silent'} · ${position.toFixed(1)} s`}`;
      } else timingStatus.textContent = 'Choose an expression. Switching timing replays your choice.';
      metrics.textContent = JSON.stringify({ mode, frames, nonfinite, reduced: reduce,
        timingVersion: testingTiming ? timingVersion : null, cues: face.diagnostics.cues,
        accentStarts: shapes.headDisplay.diagnostics.accent.starts, maxAccent,
        head: face.diagnostics.head, form: face.diagnostics.form,
        eyes: face.diagnostics.eyes,
        performance: face.diagnostics.performance, moodEdges: face.diagnostics.moodEdges,
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

for (const name of ['neutral', 'listening', ...Object.keys(tagExamples)]) {
  document.getElementById(name).onclick = () => choose(name);
}
document.getElementById('stop').onclick = () => choose('neutral');
for (const name of Object.keys(tagExamples)) {
  document.getElementById(`timing-${name}`).onclick = () => playTiming(name);
}
for (const input of document.querySelectorAll('input[name="mood-timing"]')) {
  input.onchange = () => {
    timingVersion = input.value;
    if (timingActive()) playTiming();
  };
}
document.getElementById('expressive-edges').onchange = event => {
  expressiveEdges = event.target.checked;
  face.applyTuning(expressionTuning());
};
document.getElementById('timing-speech').onchange = event => {
  timingWithSpeech = event.target.checked;
  if (timingActive()) playTiming();
};
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

document.getElementById('expressive-moods').onchange = event => {
  expressiveMoods = event.target.checked;
  face.applyTuning({ moodPerformanceAmount: expressiveMoods ? 1 : 0 });
};

document.getElementById('eye-style').onchange = event => {
  eyeStyle = event.target.value;
  face.applyTuning({ eyeStyle });
};
document.getElementById('eye-moments').onchange = event => {
  eyeMoments = event.target.checked;
  face.applyTuning({ eyeMoments });
};
