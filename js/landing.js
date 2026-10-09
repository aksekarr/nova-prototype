import { resolveLandingRoute } from './landing-route.js';

// Legacy studies own their own stage. Route before loading the landing engine.
const redirect = resolveLandingRoute(window.location.href);
if (redirect) window.location.replace(redirect);
else startLanding();

async function startLanding() {
  const el = Object.fromEntries(['meet', 'meet-label', 'arrival', 'entry-hint', 'entry-error',
    'presence', 'presence-title', 'presence-note', 'return', 'replay', 'sound', 'sound-label', 'status']
    .map(id => [id, document.getElementById(id)]));
  let flow = null, soundOn = true, pageGone = false;
  const announce = text => { if (el.status.textContent !== text) el.status.textContent = text; };
  const focus = element => { if (!element.hidden && !element.disabled) element.focus({ preventScroll: true }); };
  window.addEventListener('pagehide', event => {
    if (event.persisted) flow?.returnToNebula();
    else { pageGone = true; flow?.dispose(); }
  });

  function showBootFailure() {
    flow?.dispose();
    document.body.dataset.phase = 'error';
    el['meet-label'].textContent = 'Try again';
    el.meet.disabled = false;
    el.sound.disabled = true;
    el['entry-hint'].hidden = true;
    el['entry-error'].hidden = false;
    el['entry-error'].textContent = 'Seni could not load. Please try again.';
    el.meet.onclick = () => window.location.reload();
    announce('Seni could not load. Try again.');
  }

  try {
    const [{ createShapes }, { createFace }, { createVoice }, { startStage }, { loadFaceMap }, { createLandingFlow }] = await Promise.all([
      import('./shapes.js'), import('./face.js'), import('./voice.js'), import('./stage.js'),
      import('./facemap.js'), import('./landing-flow.js')
    ]);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const params = new URLSearchParams(window.location.search);
    let maps = null;
    try { maps = await loadFaceMap(); } catch { /* Keep the nebula available with a reload action. */ }
    if (pageGone) return;
    const requested = params.get('n');
    const parsed = requested === null || requested.trim() === '' ? NaN : Number(requested);
    const defaultN = Math.min(window.innerWidth, window.innerHeight) < 600 ? 9000 : maps ? 32000 : 16000;
    const N = Number.isFinite(parsed) ? Math.max(4000, Math.min(64000, Math.round(parsed))) : defaultN;
    const designs = createShapes(N, maps);
    const shapes = { ...designs, ...designs.FACE_V3 };
    const face = maps ? createFace(shapes, reduce) : { update() {}, applyTuning() {} };
    const state = { mode: 'nebula', modeT: 0, clock: 0, speaking: false };
    // Retain word timing without putting speech text into the page.
    const voice = createVoice({ caption: document.createElement('p'), readout: document.createElement('span') });
    function setMode(mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      state.modeT = state.clock;
    }
    let previousPhase = 'booting', viewState = null;
    function render(view) {
      viewState = view;
      const focused = document.activeElement;
      const { phase, busy, error } = view;
      const entry = phase === 'arrival' || phase === 'error';
      const present = phase === 'present';
      document.body.dataset.phase = phase;
      el.arrival.hidden = !entry;
      el.meet.disabled = busy;
      el['meet-label'].textContent = error ? 'Try again' : 'Meet Seni';
      el['entry-hint'].hidden = Boolean(error);
      el['entry-hint'].textContent = soundOn ? 'Sound on for the introduction' : 'Sound is off. You can still meet Seni.';
      el['entry-error'].hidden = !error;
      el['entry-error'].textContent = error || '';
      el.presence.hidden = entry;
      el['return'].hidden = phase === 'arrival';
      el.replay.hidden = !present;
      const title = phase === 'forming' ? 'Taking form' : phase === 'loading' ? 'Preparing your introduction'
        : phase === 'greeting' ? 'An introduction' : 'Seni is here';
      el['presence-title'].textContent = title;
      el['presence-note'].textContent = present ? 'Live conversation is coming soon'
        : phase === 'greeting' ? (soundOn ? 'A voice from the light' : 'Sound is off') : 'A moment, just for you';
      announce(error || (entry ? 'Ready to meet Seni.' : present ? 'Seni is here. Live conversation is coming soon.' : title + '.'));
      if (phase !== previousPhase && previousPhase !== 'booting') {
        if (phase === 'arrival' || phase === 'error') focus(el.meet);
        else if (previousPhase === 'arrival' || previousPhase === 'error' || focused === el.replay) focus(el['return']);
      }
      previousPhase = phase;
    }
    flow = createLandingFlow({ voice, setMode, setReplyText: text => face.setReplyText?.(text),
      getClock: () => state.clock, onChange: render });
    viewState = flow.state;
    startStage({ shapes, reduce, state, nebulaEnhancement: params.get('nebula') !== 'original',
      applyFaceTuning: face.applyTuning,
      onFrame(dt) {
        voice.update(dt);
        flow.onFrame();
        state.speaking = viewState.speaking;
      },
      updateFace(dt, clock) {
        face.update(dt, clock, voice.currentCues(), voice.currentEnvelope(), voice.currentShape(),
          state.speaking, voice.lastReplyEnd(), viewState.phase === 'present');
      }
    });
    el.meet.addEventListener('click', () => flow.meet());
    el['return'].addEventListener('click', () => { flow.returnToNebula(); face.setPose?.('neutral'); });
    el.replay.addEventListener('click', () => flow.repeatGreeting());
    el.sound.addEventListener('click', () => {
      soundOn = !soundOn;
      voice.setSoundOn(soundOn);
      el.sound.setAttribute('aria-pressed', String(!soundOn));
      el['sound-label'].textContent = soundOn ? 'Sound on' : 'Sound off';
      render(flow.state);
    });
    if (maps) { el.sound.disabled = false; render(flow.state); flow.prepare(); }
    else { flow.dispose(); showBootFailure(); }
  } catch {
    if (!pageGone) showBootFailure();
  }
}
