import { resolveLandingRoute } from './landing-route.js';

// Legacy studies own their own stage. Route before loading the landing engine.
const redirect = resolveLandingRoute(window.location.href);
if (redirect) window.location.replace(redirect);
else startLanding();

async function startLanding() {
  const el = Object.fromEntries(['stage', 'meet', 'meet-label', 'arrival', 'entry-hint', 'entry-error',
    'presence', 'presence-title', 'presence-note', 'form-error', 'return', 'replay', 'back-face', 'surprise', 'sound', 'sound-label', 'status']
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
    const [{ createShapes }, { createFace }, { createVoice }, { startStage }, { loadFaceMap }, { createLandingFlow }, { createLandingForms }] = await Promise.all([
      import('./shapes.js'), import('./face.js'), import('./voice.js'), import('./stage.js'),
      import('./facemap.js'), import('./landing-flow.js'), import('./landing-forms.js')
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
    const forms = maps ? createLandingForms({ shapes, reduce, idleCount: Number.isFinite(parsed) ? N : 48000 }) : null;
    // Build correspondence during setup, before animation and audio start.
    // Optional form setup must not prevent meeting Seni if it fails.
    try { forms?.prepare(window.innerWidth / window.innerHeight); } catch { /* Selecting a form will offer a retry. */ }
    const state = { mode: 'nebula', modeT: 0, clock: 0, speaking: false };
    // Retain word timing without putting speech text into the page.
    const voice = createVoice({ caption: document.createElement('p'), readout: document.createElement('span') });
    function setMode(mode) {
      if (state.mode === mode) return;
      forms?.select(mode, state.clock);
      state.mode = mode;
      state.modeT = state.clock;
    }
    let previousPhase = 'booting', viewState = null;
    function render(view) {
      viewState = view;
      const focused = document.activeElement;
      const { phase, form, busy, error } = view;
      const entry = phase === 'arrival' || phase === 'error';
      const present = phase === 'present';
      const changing = phase === 'changing-form';
      const exploring = present || changing;
      const alternate = form === 'orbit' || form === 'jelly';
      const formName = form === 'orbit' ? 'Atom' : 'Jellyfish';
      document.body.dataset.phase = phase;
      document.body.dataset.form = form;
      el.stage.setAttribute('aria-label', entry ? 'A living nebula of light' : alternate
        ? `Seni's particles ${changing ? 'becoming' : 'forming'} ${form === 'orbit' ? 'an atom' : 'a jellyfish'}` : "Seni's face, made of light particles");
      el.arrival.hidden = !entry;
      el.meet.disabled = busy;
      el['meet-label'].textContent = error ? 'Try again' : 'Meet Seni';
      el['entry-hint'].hidden = Boolean(error);
      el['entry-hint'].textContent = soundOn ? 'Sound on for the introduction' : 'Sound is off. You can still meet Seni.';
      el['entry-error'].hidden = !entry || !error;
      el['entry-error'].textContent = error || '';
      el['form-error'].hidden = entry || !error;
      el['form-error'].textContent = error || '';
      el.presence.hidden = entry;
      el['return'].hidden = phase === 'arrival';
      el.replay.hidden = !exploring || alternate;
      el.replay.disabled = busy;
      el['back-face'].hidden = !exploring || !alternate;
      el.surprise.hidden = !exploring;
      el.surprise.disabled = busy;
      el.surprise.setAttribute('aria-busy', String(changing));
      const title = phase === 'forming' ? 'Taking form' : phase === 'loading' ? 'Preparing your introduction'
        : phase === 'greeting' ? 'An introduction' : changing ? (alternate ? 'Changing form' : 'Returning to Seni')
          : alternate ? formName : 'Seni is here';
      el['presence-title'].textContent = title;
      el['presence-note'].textContent = present ? (alternate ? 'Explore another form or return to Seni' : 'Live conversation is coming soon')
        : changing && alternate ? formName
        : phase === 'greeting' ? (soundOn ? 'A voice from the light' : 'Sound is off') : 'A moment, just for you';
      announce(error || (entry ? 'Ready to meet Seni.' : present && !alternate ? 'Seni is here. Live conversation is coming soon.' : title + '.'));
      if (previousPhase !== 'booting' && (phase !== previousPhase || focused?.hidden)) {
        if (phase === 'arrival' || phase === 'error') focus(el.meet);
        else if (previousPhase === 'arrival' || previousPhase === 'error' || focused === el.replay || focused?.hidden || focused === el.surprise && busy) {
          focus(alternate && exploring ? el['back-face'] : el['return']);
        }
      }
      previousPhase = phase;
    }
    flow = createLandingFlow({ voice, setMode, setReplyText: text => face.setReplyText?.(text),
      getClock: () => state.clock, isTransitioning: () => forms?.transitioning ?? false, onChange: render });
    viewState = flow.state;
    startStage({ shapes, reduce, state, landingForms: forms, nebulaEnhancement: params.get('nebula') !== 'original',
      applyFaceTuning: face.applyTuning,
      onFrame(dt) {
        voice.update(dt);
        flow.onFrame();
        state.speaking = viewState.speaking;
      },
      updateFace(dt, clock) {
        if (state.mode === 'face' || state.mode === 'nebula') face.update(dt, clock, voice.currentCues(), voice.currentEnvelope(), voice.currentShape(),
          state.speaking, voice.lastReplyEnd(), viewState.phase === 'present');
      }
    });
    el.meet.addEventListener('click', () => flow.meet());
    el['return'].addEventListener('click', () => { flow.returnToNebula(); face.setPose?.('neutral'); });
    el.replay.addEventListener('click', () => flow.repeatGreeting());
    el.surprise.addEventListener('click', () => flow.surprise());
    el['back-face'].addEventListener('click', () => flow.showFace());
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
