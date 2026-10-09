import { resolveLandingRoute } from './landing-route.js';

const FORM_LABELS = {
  orbit: { name: 'Atom', description: 'an atom' },
  jelly: { name: 'Jellyfish', description: 'a jellyfish' },
  lotus: { name: 'Celestial Lotus', description: 'a celestial lotus' }
};

// Legacy studies own their own stage. Route before loading the landing engine.
const redirect = resolveLandingRoute(window.location.href);
if (redirect) window.location.replace(redirect);
else startLanding();

async function startLanding() {
  const el = Object.fromEntries(['stage', 'meet', 'meet-label', 'arrival', 'entry-hint', 'entry-error',
    'presence', 'presence-title', 'presence-note', 'form-error', 'return', 'replay', 'talk', 'end-conversation', 'mic', 'mic-label', 'back-face', 'surprise', 'sound', 'sound-label', 'status']
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
    const [{ createShapes }, { createFace }, { createVoice }, { startStage }, { loadFaceMap }, { createLandingFlow }, { createLandingForms }, { createAgentSession }, { loadAgentConfig }] = await Promise.all([
      import('./shapes.js'), import('./face.js'), import('./voice.js'), import('./stage.js'),
      import('./facemap.js'), import('./landing-flow.js'), import('./landing-forms.js'),
      import('./agent-session.js'), import('./agent-config.js')
    ]);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const params = new URLSearchParams(window.location.search);
    const [maps, agentConfig] = await Promise.all([
      loadFaceMap().catch(() => null), loadAgentConfig().catch(() => null)
    ]);
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
    const agent = agentConfig ? createAgentSession({ voice,
      onReplyText: text => face.setReplyText?.(text), onChange: () => flow?.agentChanged() }) : null;
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
      const { phase, form, busy, error, live = false, micMuted = false } = view;
      const entry = phase === 'arrival' || phase === 'error';
      const present = phase === 'present';
      const changing = phase === 'changing-form';
      const inSession = phase === 'connecting' || phase === 'listening' || phase === 'speaking';
      const exploring = present || changing || inSession;
      const formLabel = FORM_LABELS[form];
      const alternate = Boolean(formLabel);
      const formName = formLabel?.name;
      document.body.dataset.phase = phase;
      document.body.dataset.form = form;
      el.stage.setAttribute('aria-label', entry ? 'A living nebula of light' : alternate
        ? `Seni's particles ${changing ? 'becoming' : 'forming'} ${formLabel.description}` : "Seni's face, made of light particles");
      el.arrival.hidden = !entry;
      el.meet.disabled = busy;
      el['meet-label'].textContent = error ? 'Try again' : 'Meet Seni';
      el['entry-hint'].hidden = Boolean(error);
      el['entry-hint'].textContent = live ? 'Allow your microphone to talk with Seni'
        : soundOn ? 'Sound on for the introduction' : 'Sound is off. You can still meet Seni.';
      el['entry-error'].hidden = !entry || !error;
      el['entry-error'].textContent = error || '';
      el['form-error'].hidden = entry || !error;
      el['form-error'].textContent = error || '';
      el.presence.hidden = entry;
      el['return'].hidden = phase === 'arrival';
      el.replay.hidden = live || !exploring || alternate;
      el.replay.disabled = busy;
      el.talk.hidden = !live || !present || alternate;
      el['end-conversation'].hidden = !inSession;
      el.mic.hidden = !inSession;
      el.mic.setAttribute('aria-pressed', String(micMuted));
      el.mic.setAttribute('aria-label', micMuted ? 'Unmute microphone' : 'Mute microphone');
      el['mic-label'].textContent = micMuted ? 'Mic off' : 'Mic on';
      el['back-face'].hidden = !exploring || !alternate;
      el.surprise.hidden = !exploring;
      el.surprise.disabled = busy && !inSession;
      const surpriseLabel = inSession ? 'End conversation and explore another form' : 'Explore another form';
      el.surprise.title = surpriseLabel;
      el.surprise.setAttribute('aria-label', inSession ? 'Surprise me — end conversation and explore another form' : 'Surprise me');
      el.surprise.setAttribute('aria-busy', String(changing));
      const title = phase === 'forming' ? 'Taking form' : phase === 'loading' ? (live ? 'Preparing your conversation' : 'Preparing your introduction')
        : phase === 'connecting' ? 'Connecting to Seni' : phase === 'speaking' ? 'Seni is speaking'
          : phase === 'listening' ? (micMuted ? 'Microphone muted' : 'Seni is listening')
            : phase === 'greeting' ? 'An introduction' : changing ? (alternate ? 'Changing form' : 'Returning to Seni')
              : error && live ? 'Conversation unavailable' : alternate ? formName : 'Seni is here';
      el['presence-title'].textContent = title;
      el['presence-note'].textContent = inSession ? (phase === 'connecting' ? 'Allow microphone access when asked'
        : micMuted ? 'Unmute your microphone when you are ready' : !soundOn ? 'Sound is off' : 'A conversation, just for you')
        : present ? (alternate ? 'Explore another form or return to Seni' : live ? 'Talk with Seni when you are ready' : 'Live conversation is coming soon')
          : changing && alternate ? formName
            : phase === 'greeting' ? (soundOn ? 'A voice from the light' : 'Sound is off') : 'A moment, just for you';
      announce(error || (entry ? 'Ready to meet Seni.' : title + '.'));
      if (previousPhase !== 'booting' && (phase !== previousPhase || focused?.hidden)) {
        if (phase === 'arrival' || phase === 'error') focus(el.meet);
        else if (previousPhase === 'arrival' || previousPhase === 'error' || focused === el.replay || focused?.hidden || focused === el.surprise && busy) {
          focus(inSession ? el['end-conversation'] : live && present && !alternate ? el.talk
            : alternate && exploring ? el['back-face'] : el['return']);
        }
      }
      previousPhase = phase;
    }
    flow = createLandingFlow({ voice, agent, agentConfig, setMode, setReplyText: text => face.setReplyText?.(text),
      getClock: () => state.clock, isTransitioning: () => forms?.transitioning ?? false, onChange: render });
    viewState = flow.state;
    startStage({ shapes, reduce, state, landingForms: forms, nebulaEnhancement: params.get('nebula') !== 'original',
      applyFaceTuning: face.applyTuning,
      onFrame(dt) {
        voice.update(dt);
        agent?.onFrame();
        flow.onFrame();
        state.speaking = viewState.speaking;
      },
      updateFace(dt, clock) {
        if (state.mode === 'face' || state.mode === 'nebula') face.update(dt, clock, voice.currentCues(), voice.currentEnvelope(), voice.currentShape(),
          state.speaking, voice.lastReplyEnd(), viewState.phase === 'present' || viewState.phase === 'listening',
          null, viewState.phase === 'listening' ? agent?.currentInputVolume() ?? 0 : 0);
      }
    });
    el.meet.addEventListener('click', () => flow.meet());
    el['return'].addEventListener('click', () => { flow.returnToNebula(); face.setPose?.('neutral'); });
    el.replay.addEventListener('click', () => flow.repeatGreeting());
    el.talk.addEventListener('click', () => flow.meet());
    el['end-conversation'].addEventListener('click', () => flow.endConversation());
    el.mic.addEventListener('click', () => flow.setMicMuted(!flow.state.micMuted));
    el.surprise.addEventListener('click', () => flow.surprise());
    el['back-face'].addEventListener('click', () => flow.showFace());
    el.sound.addEventListener('click', () => {
      soundOn = !soundOn;
      voice.setSoundOn(soundOn);
      el.sound.setAttribute('aria-pressed', String(!soundOn));
      el.sound.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Unmute sound');
      el['sound-label'].textContent = soundOn ? 'Sound on' : 'Sound off';
      render(flow.state);
    });
    if (maps) { el.sound.disabled = false; render(flow.state); flow.prepare(); }
    else { flow.dispose(); showBootFailure(); }
  } catch {
    if (!pageGone) showBootFailure();
  }
}
