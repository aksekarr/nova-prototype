// Existing form-study interactions, kept separate from the page bootstrap.
// No live provider is loaded or microphone requested by this flow.
export function createStudyFlow({ voice, face, state, setMode, restCaption, el,
  isTuning = false, captureTools = null, stopLive = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let liveSimulation = null, captureReplay = null, liveSpeaking = false;
  let mouthLab = null, mouthPlayback = null;
  // Each new interaction invalidates the pending steps of the scripted sequence.
  let seqId = 0, speechId = 0;
  // The lock belongs to the whole requested session, not to an audible frame.
  // Formation, loading, transport gaps and pauses between lines stay suspended.
  function beginMouthPlayback() {
    const token = {};
    mouthPlayback = token;
    mouthLab?.setPlaybackActive(true);
    return token;
  }
  function finishMouthPlayback(token) {
    if (mouthPlayback !== token) return;
    mouthPlayback = null;
    mouthLab?.setPlaybackActive(false);
  }
  async function withMouthPlayback(action) {
    const token = beginMouthPlayback();
    try { return await action(); }
    finally { finishMouthPlayback(token); }
  }
  function stopAll() {
    seqId++; speechId++;
    stopLive();
    if (liveSimulation) liveSimulation.interrupt();
    liveSimulation = null;
    if (captureReplay) captureReplay.interrupt();
    captureReplay = null;
    voice.stream.interrupt();
    liveSpeaking = false;
    state.speaking = false;
    voice.stop();
    if (mouthPlayback) finishMouthPlayback(mouthPlayback);
  }
  async function speakLine(lineId) {
    const id = ++speechId;
    state.speaking = true;
    try {
      await voice.preload([lineId]);
      if (id !== speechId) return;
      const line = await voice.getLabLine(lineId);
      if (id !== speechId) return;
      face.setReplyText?.(line?.text ?? null);
      const result = await voice.speak(lineId);
      if (id === speechId && result?.status === 'unavailable') throw result.error;
    } finally {
      if (id === speechId) state.speaking = false;
    }
  }
  async function playLabLine(lineId) {
    stopAll();
    const activated = voice.activate();
    return withMouthPlayback(async () => {
      const id = seqId;
      await activated;
      if (id !== seqId) return;
      if (state.mode !== 'face') {
        if (!setMode('face')) return;
        restCaption('Forming…');
      }
      const formationWait = Math.max(0, 2800 - (state.clock - state.modeT) * 1000);
      await Promise.all([voice.preload([lineId]), sleep(formationWait)]);
      if (id !== seqId) return;
      await speakLine(lineId);
    });
  }
  async function simulateLabLine(lineId, options) {
    if (!isTuning) return;
    stopAll();
    const activated = voice.activate();
    return withMouthPlayback(async () => {
      const id = seqId;
      await activated;
      if (id !== seqId) return;
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
      face.setReplyText?.(line.text);
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
    });
  }
  async function runSequence() {
    stopAll();
    const activated = voice.activate();
    return withMouthPlayback(async () => {
      const id = ++seqId; function alive() { return id === seqId; }
      await activated; if (!alive()) return;
      await voice.preload(['hello']); if (!alive()) return;
      if (!setMode('face')) return; restCaption('Forming…');
      await sleep(3000); if (!alive()) return;
      await speakLine('hello'); if (!alive()) return;
      await sleep(350); if (!alive()) return;
      await speakLine('intro'); if (!alive()) return;
      await speakLine('trees'); if (!alive()) return;
      setMode('tree'); await sleep(1400); if (!alive()) return;
      await speakLine('tree'); if (!alive()) return;
      await sleep(1600); if (!alive()) return;
      setMode('face'); restCaption('Returning…');
      await sleep(2600); if (!alive()) return;
      await speakLine('back'); if (!alive()) return;
      restCaption('Listening.');
      await sleep(1800); if (!alive()) return;
    });
  }

  async function replayCapture(reply) {
    if (!isTuning) return;
    stopAll();
    const activated = voice.activate();
    return withMouthPlayback(async () => {
      const id = seqId;
      await activated;
      if (id !== seqId) return;
      if (state.mode !== 'face') {
        if (!setMode('face')) return;
        restCaption('Forming…');
      }
      await sleep(Math.max(0, 2800 - (state.clock - state.modeT) * 1000));
      if (id !== seqId) return;
      face.setReplyText?.(reply.text);
      const replay = captureTools.startCaptureReplay(voice, reply);
      captureReplay = replay;
      liveSpeaking = true;
      try {
        const metrics = await replay.done;
        return { interrupted: metrics.interrupted };
      } finally {
        if (captureReplay === replay) {
          captureReplay = null;
          liveSpeaking = false;
          state.speaking = false;
        }
      }
    });
  }

  async function playTestLine() {
    stopAll();
    const activated = voice.activate();
    return withMouthPlayback(async () => {
      const id = seqId;
      await activated;
      if (id !== seqId) return;
      if (state.mode !== 'face') { if (!setMode('face')) return; restCaption('Forming…'); await sleep(2800); if (id !== seqId) return; }
      await speakLine('test');
    });
  }

  // A rejected preload enables the same button as a retry; unrelated demo lines
  // must never gate the greeting or the standalone test line.
  function prepare() {
    const ready = (line, button) => voice.preload([line], { background: line !== 'hello' }).catch(() => {}).finally(() => {
      button.disabled = false;
    });
    const greeting = ready('hello', el.wake);
    const test = ready('test', el.line);
    // Keep the existing sequence warm, without making these lines prerequisites.
    voice.preload(['intro', 'trees', 'tree', 'back'], { background: true }).catch(() => {});
    return { greeting, test };
  }

  function reportFailure(error, interaction) {
    if (interaction !== seqId) return;
    state.speaking = false;
    setMode('nebula');
    restCaption(error?.code === 'AUDIO_UNAVAILABLE'
      ? 'Audio could not start. Press Wake Nova or Test line to try again.'
      : 'Voice unavailable. Press Wake Nova or Test line to try again.');
  }

  function runFromControl(action) {
    const pending = action();
    const interaction = seqId;
    return pending.catch(error => reportFailure(error, interaction));
  }

  return {
    prepare, runSequence: () => runFromControl(runSequence),
    playTestLine: () => runFromControl(playTestLine),
    playLabLine, simulateLabLine, replayCapture, stopAll,
    beginMouthPlayback, finishMouthPlayback,
    connectMouthLab(lab) { mouthLab = lab; lab.setPlaybackActive(Boolean(mouthPlayback)); },
    playReference(action) { stopAll(); return withMouthPlayback(action); },
    onFrame() {
      if (liveSpeaking) {
        state.speaking = voice.stream.isAudible();
        if (!voice.stream.isActive()) liveSpeaking = false;
      }
    }
  };
}
