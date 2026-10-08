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
let liveSimulation = null;
let liveSpeaking = false;
let liveSession = null;
let liveSetupPending = false;
let liveClientPromise = null;
let liveControls = null;
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
    simulate: simulateLabLine,
    interrupt: stopAll,
    references: {
      load: loadReferenceClips,
      play(kind) { stopAll(); return playReferenceClip(kind); }
    }
  },
  applyFaceTuning: face.applyTuning,
  onFrame: dt => {
    voice.update(dt);
    if (liveSpeaking) {
      state.speaking = voice.stream.isAudible();
      if (!voice.stream.isActive()) liveSpeaking = false;
    }
    if (liveSession) {
      if (!el.voice.textContent.startsWith('Live ·') && el.voice.textContent !== 'Speaking') {
        liveSession.idleReadout = el.voice.textContent;
      }
      state.speaking = voice.stream.isAudible();
      el.voice.textContent = `Live · ${liveSession.connected ? state.speaking ? 'Speaking' : 'Listening' : 'Connecting'}`;
      el.voice.classList.toggle('live', state.speaking);
    }
  },
  updateFace: (dt, clock) => {
    face.update(dt, clock, state.exprName, voice.currentEnvelope(), voice.currentShape());
  }
});

// Each new interaction invalidates the pending steps of the scripted sequence.
let seqId = 0, speechId = 0;
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function stopAll() {
  seqId++; speechId++;
  if (liveSession) stopLive(liveSession, 'Live stopped. At rest.');
  if (liveSimulation) liveSimulation.interrupt();
  liveSimulation = null;
  liveSpeaking = false;
  state.speaking = false;
  voice.stop();
}
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
async function simulateLabLine(lineId, options) {
  if (params.get('tune') !== '1') return;
  stopAll();
  const id = seqId;
  if (state.mode !== 'face') {
    if (!setMode('face')) return;
    restCaption('Forming…');
  }
  const formationWait = Math.max(0, 2800 - (state.clock - state.modeT) * 1000);
  const [{ startLiveSimulation }] = await Promise.all([
    import('./livesim.js'), voice.preload([lineId]), sleep(formationWait)
  ]);
  if (id !== seqId) return;
  const line = await voice.getLabLine(lineId);
  if (id !== seqId) return;
  const simulation = startLiveSimulation(voice, line, options);
  liveSimulation = simulation;
  liveSpeaking = true;
  try {
    return await simulation.done;
  } finally {
    if (liveSimulation === simulation) {
      liveSimulation = null;
      liveSpeaking = false;
      state.speaking = false;
    }
  }
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

// Dev-only: no controls, client script, or SDK hooks without this exact flag.
if (params.get('live') === '1') {
  const group = document.createElement('div');
  group.id = 'live-group';
  group.className = 'group live-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Live');
  group.innerHTML = `<span>Live</span><div class="row">
    <input id="live-agent-id" type="text" autocomplete="off" spellcheck="false" aria-label="Agent ID" placeholder="Agent ID">
    <button id="live-start" type="button">Start</button>
    <button id="live-stop" type="button" disabled>Stop</button>
  </div>`;
  document.querySelector('.dock').appendChild(group);
  liveControls = {
    input: document.getElementById('live-agent-id'),
    start: document.getElementById('live-start'), stop: document.getElementById('live-stop')
  };
  liveControls.start.addEventListener('click', startLive);
  liveControls.stop.addEventListener('click', () => {
    if (liveSession) stopLive(liveSession, 'Live stopped. At rest.');
  });
  window.addEventListener('pagehide', () => {
    liveControls.input.value = '';
    if (liveSession) stopLive(liveSession, 'Live stopped. At rest.');
  });
}

function loadLiveClient() {
  if (!liveClientPromise) {
    liveClientPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './js/vendor/elevenlabs-client-1.27.0.iife.js';
      script.onload = () => resolve(window.ElevenLabsClient);
      script.onerror = () => {
        script.remove();
        liveClientPromise = null;
        reject(new Error('Live client unavailable'));
      };
      document.head.appendChild(script);
    });
  }
  return liveClientPromise;
}

function updateLiveControls() {
  liveControls.start.disabled = liveSetupPending || Boolean(liveSession);
  liveControls.stop.disabled = !liveSession;
}

// Use fixed captions only: SDK errors/context may contain IDs or transcripts.
function liveErrorCaption(error) {
  const message = typeof error === 'string' ? error : error?.message || '';
  if (error?.name === 'NotAllowedError' || /permission|denied/i.test(message)) {
    return 'Microphone permission denied. Allow microphone access, then Start again.';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'NotReadableError') {
    return 'Microphone unavailable. Check the microphone, then Start again.';
  }
  return 'Live connection failed. Check the agent and microphone, then Start again.';
}

function endLiveConversation(session) {
  if (!session.conversation || session.ending) return;
  session.ending = true;
  // Stop tracks synchronously, including while SDK teardown awaits detach().
  session.conversation.input.inputStream.getTracks().forEach(track => track.stop());
  session.conversation.endSession().catch(() => {});
}

function stopLive(session, caption) {
  session.stopped = true;
  clearTimeout(session.timer);
  session.pendingText = null;
  session.replyOpen = false;
  session.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
  session.socket?.close();
  endLiveConversation(session);
  if (liveSession !== session) return;
  liveSession = null;
  voice.stream.interrupt();
  if (el.voice.textContent.startsWith('Live ·')) {
    el.voice.textContent = session.idleReadout;
    el.voice.classList.remove('live');
  }
  liveSpeaking = false;
  state.speaking = false;
  setExpr('neutral');
  setMode('nebula');
  restCaption(caption);
  updateLiveControls();
}

// Pinned 1.27.0 integration. setupWebSocketIO attaches output before creating the
// conversation; defer addListener's queued-audio flush until output is muted.
// Also retain the SDK's otherwise unabortable setup resources for Stop/deadline.
function guardLiveSetup(session, client) {
  const media = navigator.mediaDevices;
  const getUserMedia = media.getUserMedia;
  const createConnection = client.WebSocketConnection.create;
  media.getUserMedia = async function (constraints) {
    if (session.stopped) throw new DOMException('Live stopped', 'AbortError');
    const stream = await getUserMedia.call(media, constraints);
    session.streams.add(stream);
    if (session.stopped) {
      stream.getTracks().forEach(track => track.stop());
      throw new DOMException('Live stopped', 'AbortError');
    }
    return stream;
  };
  client.WebSocketConnection.create = async function (config) {
    if (session.stopped) throw new DOMException('Live stopped', 'AbortError');
    const NativeSocket = window.WebSocket;
    let pending;
    // create() constructs its socket synchronously, before its first await.
    window.WebSocket = new Proxy(NativeSocket, {
      construct(Target, args) {
        session.socket = new Target(...args);
        return session.socket;
      }
    });
    try { pending = createConnection.call(this, config); }
    finally { window.WebSocket = NativeSocket; }
    const connection = await pending;
    if (session.stopped || connection.outputFormat.format !== 'pcm' || connection.outputFormat.sampleRate !== 44100) {
      connection.close();
      throw new Error('Live requires PCM 44100');
    }
    const addListener = connection.addListener.bind(connection);
    const removeListener = connection.removeListener.bind(connection);
    const listeners = new Set();
    connection.addListener = listener => listeners.add(listener);
    connection.removeListener = listener => {
      listeners.delete(listener);
      removeListener(listener);
    };
    session.releaseOutput = () => {
      connection.addListener = addListener;
      listeners.forEach(addListener);
      listeners.clear();
    };
    // WebSocketConnection.handleMessage otherwise sends even stale PCM to its
    // output queue. Keep its silent playback clock consistent with Nova's.
    const handleMessage = connection.handleMessage.bind(connection);
    connection.handleMessage = event => {
      if (session.stopped) return;
      if (event.type === 'interruption') {
        session.cutoff = Math.max(session.cutoff, event.interruption_event.event_id);
        connection.pendingAudioEvents = [];
      }
      if (event.type === 'audio' && event.audio_event.event_id < session.cutoff) return;
      handleMessage(event);
    };
    return connection;
  };
  return () => {
    media.getUserMedia = getUserMedia;
    client.WebSocketConnection.create = createConnection;
  };
}

async function startLive() {
  if (liveSession || liveSetupPending) return;
  let agentId = liveControls.input.value.trim();
  liveControls.input.value = '';
  if (!agentId) {
    restCaption('Enter an agent ID to start Live.');
    return;
  }
  stopAll();
  if (!setMode('face')) return;
  const session = {
    connected: false, stopped: false, conversation: null, streams: new Set(),
    cutoff: 0, audioAccepted: false, replyOpen: false, pendingText: null,
    idleReadout: el.voice.textContent
  };
  liveSession = session;
  liveSetupPending = true;
  updateLiveControls();
  restCaption('Live connecting…');
  session.timer = setTimeout(() => stopLive(session, 'Live ended after 120 seconds. At rest.'), 120000);
  const active = () => liveSession === session && !session.stopped;
  const fail = error => {
    if (active()) stopLive(session, liveErrorCaption(error));
  };
  const beginReply = () => {
    if (!session.replyOpen) {
      voice.stream.begin();
      session.replyOpen = true;
      if (session.pendingText !== null) voice.stream.setText(session.pendingText);
      session.pendingText = null;
    }
  };
  let restoreSetup = () => {};
  try {
    const client = await loadLiveClient();
    if (!active()) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable');
    restoreSetup = guardLiveSetup(session, client);
    const pending = client.Conversation.startSession({
      agentId, connectionType: 'websocket', useWakeLock: false,
      // Never fetch the SDK's optional, unvendored resampler CDN dependency.
      // Unsupported device rates fail closed instead of playing incorrect PCM.
      libsampleratePath: 'data:application/javascript,throw%20new%20Error(%22Unsupported%20live%20sample%20rate%22)',
      onConversationCreated(conversation) {
        session.conversation = conversation;
        // BaseConversation.onError otherwise logs raw message/context first.
        conversation.onError = fail;
        conversation.input.onError = fail;
        conversation.setVolume({ volume: 0 });
        // MediaDeviceOutput.interrupt ramps gain above zero; mute the sink too.
        conversation.output.audioElement.muted = true;
        // audioConcatProcessor first posts finished:true for its empty queue.
        // That task can arrive after queued onAudio callbacks: it is not a reply
        // boundary until the worklet has actually processed an audio buffer.
        const playback = conversation.playbackEventTarget;
        const handlePlayback = conversation.handlePlaybackEvent;
        playback.removeListener(handlePlayback);
        conversation.handlePlaybackEvent = event => {
          if (event.data.type === 'process') {
            if (event.data.finished && !session.outputStarted) return;
            session.outputStarted = !event.data.finished;
          }
          handlePlayback(event);
        };
        playback.addListener(conversation.handlePlaybackEvent);
        if (active()) session.releaseOutput();
      },
      onConnect() {
        if (!active()) return;
        session.connected = true;
        restCaption('Live listening.');
      },
      onIncomingEvent(event) {
        // BaseConversation.onMessage invokes this before handleAudio, whose
        // alignment callback precedes the SDK's own event_id interruption filter.
        if (event.type === 'audio') {
          session.audioAccepted = Number.isFinite(event.audio_event.event_id) && event.audio_event.event_id >= session.cutoff;
        }
      },
      onAudio(base64) {
        if (!active() || !session.audioAccepted) return;
        beginReply();
        voice.stream.addAudio(base64);
      },
      onAudioAlignment(alignment) {
        if (!active() || !session.audioAccepted) return;
        beginReply();
        voice.stream.addAlignment(alignment);
      },
      onMessage({ source, message, event_id }) {
        if (!active() || source !== 'ai' || event_id < session.cutoff) return;
        if (session.replyOpen) voice.stream.setText(message);
        else session.pendingText = message;
      },
      onModeChange({ mode }) {
        // handlePlaybackEvent(process.finished) reports the muted SDK queue's
        // end; Nova may still be audible while its own scheduled tail drains.
        if (!active() || mode !== 'listening' || !session.replyOpen) return;
        session.replyOpen = false;
        voice.stream.end();
      },
      onInterruption({ event_id }) {
        if (!active()) return;
        voice.stream.interrupt();
        session.cutoff = Math.max(session.cutoff, event_id);
        session.audioAccepted = false;
        session.outputStarted = false;
        session.replyOpen = false;
        session.pendingText = null;
        state.speaking = false;
      },
      onDisconnect(details) {
        if (active()) stopLive(session, details.reason === 'error' ? liveErrorCaption(details.message) : 'Live disconnected. At rest.');
      },
      onError: fail
    });
    agentId = '';
    session.conversation = await pending;
    if (!active()) endLiveConversation(session);
  } catch (error) {
    fail(error);
  } finally {
    agentId = '';
    restoreSetup();
    liveSetupPending = false;
    updateLiveControls();
  }
}
