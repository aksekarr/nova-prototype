import { guardElevenSetup } from './eleven-setup.js';

// Development-only integration for the locally vendored ElevenLabs 1.27.0 SDK.
// Imported only by the explicit ?live=1 route; the ordinary study stays local.
export function createLiveStudy({ voice, face, state, el, setMode, setExpr, restCaption,
  stopAll, beginMouthPlayback, finishMouthPlayback, captureTools,
  controls = null, clientLoader = null, host = window, media = navigator.mediaDevices }) {
  let liveSession = null, pendingSetup = null, liveClientPromise = null, liveControls = controls;
  const captureRecorder = captureTools?.createCaptureRecorder(voice.stream, { onChange: updateCaptureControls });
  // Dev-only: no controls, client script, or SDK hooks without this exact flag.
  if (!liveControls) {
    host.document.body.classList.add('live-chat');
    const group = host.document.createElement('div');
    group.id = 'live-group';
    group.className = 'group live-group';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Live');
    group.innerHTML = `<span>Live</span><div class="row">
      <input id="live-agent-id" type="text" autocomplete="off" spellcheck="false" aria-label="Agent ID" placeholder="Agent ID">
      <button id="live-start" type="button">Start</button>
      <button id="live-stop" type="button" disabled>Stop</button>
    </div><div class="row live-capture">
      <label><input id="live-capture" type="checkbox"> Capture replies</label>
      <button id="live-download" type="button" disabled>Download captures (0)</button>
    </div>`;
    host.document.querySelector('.dock').appendChild(group);
    liveControls = {
      input: host.document.getElementById('live-agent-id'),
      start: host.document.getElementById('live-start'), stop: host.document.getElementById('live-stop'),
      capture: host.document.getElementById('live-capture'), download: host.document.getElementById('live-download')
    };
    liveControls.capture.addEventListener('change', () => {
      captureRecorder.setEnabled(liveControls.capture.checked);
    });
    liveControls.download.addEventListener('click', () => {
      const session = captureRecorder.snapshot();
      const url = URL.createObjectURL(new Blob([JSON.stringify(session)], { type: 'application/json' }));
      const link = host.document.createElement('a');
      link.href = url;
      link.download = `nova-captures-${session.capturedAt.replace(/[:.]/g, '-')}.json`;
      host.document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    liveControls.start.addEventListener('click', startLive);
    liveControls.stop.addEventListener('click', () => {
      if (liveSession) stopLive(liveSession, 'Live stopped. At rest.');
    });
    host.addEventListener('pagehide', () => {
      liveControls.input.value = '';
      if (liveSession) stopLive(liveSession, 'Live stopped. At rest.');
    });
  }

  function updateCaptureControls() {
    if (!liveControls) return;
    liveControls.download.textContent = `Download captures (${captureRecorder.count})`;
    liveControls.download.disabled = captureRecorder.count === 0;
  }

  function loadLiveClient() {
    if (!liveClientPromise) {
      liveClientPromise = new Promise((resolve, reject) => {
        const script = host.document.createElement('script');
        script.src = './js/vendor/elevenlabs-client-1.27.0.iife.js';
        script.onload = () => resolve(host.ElevenLabsClient);
        script.onerror = () => {
          script.remove();
          liveClientPromise = null;
          reject(new Error('Live client unavailable'));
        };
        host.document.head.appendChild(script);
      });
    }
    return liveClientPromise;
  }

  function updateLiveControls() {
    liveControls.start.disabled = Boolean(liveSession || pendingSetup);
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
    // A pending guarded call checks this session again before the SDK can
    // continue. Between calls, however, the SDK may be awaiting its own delay
    // or worklet setup; retain the guard until that continuation fails closed.
    if (!session.setupPending || !session.restoreSetup || session.guardedCalls > 0) {
      session.restoreSetup?.();
      if (pendingSetup === session) pendingSetup = null;
    }
    session.pendingText = null;
    session.replyOpen = false;
    session.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    session.socket?.close();
    endLiveConversation(session);
    if (liveSession !== session) return;
    liveSession = null;
    finishMouthPlayback(session.mouthPlayback);
    voice.stream.interrupt();
    if (el.voice.textContent.startsWith('Live ·')) {
      el.voice.textContent = session.idleReadout;
      el.voice.classList.remove('live');
    }
    state.speaking = false;
    setExpr('neutral');
    setMode('nebula');
    restCaption(caption);
    updateLiveControls();
  }

  async function startLive() {
    if (liveSession || pendingSetup) return;
    let agentId = liveControls.input.value.trim();
    liveControls.input.value = '';
    if (!agentId) {
      restCaption('Enter an agent ID to start Live.');
      return;
    }
    stopAll();
    if (!setMode('face')) return;
    const session = {
      connected: false, listening: true, stopped: false, conversation: null, streams: new Set(),
      setupPending: true, guardedCalls: 0,
      cutoff: 0, audioAccepted: false, replyOpen: false, pendingText: null,
      idleReadout: el.voice.textContent, mouthPlayback: beginMouthPlayback()
    };
    liveSession = pendingSetup = session;
    updateLiveControls();
    restCaption('Live connecting…');
    session.timer = setTimeout(() => stopLive(session, 'Live ended after 120 seconds. At rest.'), 120000);
    const active = () => liveSession === session && !session.stopped;
    const fail = error => {
      if (active()) stopLive(session, liveErrorCaption(error));
    };
    const beginReply = () => {
      if (!session.replyOpen) {
        face.setReplyText?.(session.pendingText);
        voice.stream.begin();
        session.replyOpen = true;
        if (session.pendingText !== null) voice.stream.setText(session.pendingText);
        session.pendingText = null;
      }
    };
    let restoreSetup = () => {};
    try {
      const client = await (clientLoader ? clientLoader() : loadLiveClient());
      if (!active()) return;
      if (!media?.getUserMedia) throw new Error('Microphone unavailable');
      restoreSetup = guardElevenSetup(session, client, { host, media });
      session.restoreSetup = restoreSetup;
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
          else endLiveConversation(session);
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
          if (session.replyOpen) {
            face.setReplyText?.(message);
            voice.stream.setText(message);
          }
          else session.pendingText = message;
        },
        onModeChange({ mode }) {
          if (!active()) return;
          session.listening = mode === 'listening';
          // Known live-integration limitation: pinned 1.27.0 also emits listening
          // for temporary output underruns. It supplies no authoritative reply-end
          // callback. Preserve this legacy boundary until provider finality or a
          // resumable player/capture lifecycle is verified; never add a guessed
          // timeout here. Ordinary cached study playback does not use this path.
          if (mode !== 'listening' || !session.replyOpen) return;
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
      session.setupPending = false;
      if (pendingSetup === session) pendingSetup = null;
      updateLiveControls();
    }
  }

  return {
    start: startLive,
    stop() { if (liveSession) stopLive(liveSession, 'Live stopped. At rest.'); },
    get session() { return liveSession; },
    get listening() { return Boolean(liveSession?.connected && liveSession.listening); },
    onFrame() {
      if (!liveSession) return;
      if (!el.voice.textContent.startsWith('Live ·') && el.voice.textContent !== 'Speaking') {
        liveSession.idleReadout = el.voice.textContent;
      }
      state.speaking = voice.stream.isAudible();
      el.voice.textContent = `Live · ${liveSession.connected ? state.speaking ? 'Speaking' : 'Listening' : 'Connecting'}`;
      el.voice.classList.toggle('live', state.speaking);
    }
  };
}
