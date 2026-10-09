import { guardElevenSetup } from './eleven-setup.js';
import { createAgentReplies } from './agent-replies.js';

function errorMessage(error) {
  if (error?.name === 'NotAllowedError') return 'Microphone access was denied. Allow it in your browser, then try again.';
  if (error?.name === 'NotFoundError' || error?.name === 'NotReadableError') return 'Your microphone is unavailable. Check it, then try again.';
  if (error?.code === 'BUSY') return 'Seni is busy right now. Please try again shortly.';
  if (error?.code === 'TIMEOUT') return 'The connection took too long. Please try again.';
  return 'Seni could not connect. Please try again.';
}

// The provider owns conversation; the existing local player owns all audible
// output, mouth timing and effects. Never display or log provider payloads.
export function createAgentSession({ voice, onReplyText = () => {}, onChange = () => {},
  clientLoader = null, host = window, media = navigator.mediaDevices, connectionTimeoutMs = 30000 }) {
  let current = null, pendingSetup = null, clientPromise = null;
  let state = { status: 'idle', speaking: false, micMuted: false, error: null };
  const replies = createAgentReplies({ stream: voice.stream, onReplyText });
  function publish(next) {
    const changed = Object.keys(next).some(key => state[key] !== next[key]);
    state = { ...state, ...next };
    if (changed) onChange({ ...state });
  }
  function loadClient() {
    if (!clientPromise) {
      clientPromise = (clientLoader ? Promise.resolve().then(clientLoader) : new Promise((resolve, reject) => {
        if (host.ElevenLabsClient) { resolve(host.ElevenLabsClient); return; }
        const script = host.document.createElement('script');
        script.src = new URL('./vendor/elevenlabs-client-1.27.0.iife.js', import.meta.url).href;
        script.onload = () => resolve(host.ElevenLabsClient);
        script.onerror = () => { script.remove(); reject(new Error('Client unavailable')); };
        host.document.head.appendChild(script);
      })).catch(error => { clientPromise = null; throw error; });
    }
    return clientPromise;
  }
  function closeResources(session) {
    session.streams.forEach(stream => stream.getTracks().forEach(track => track.stop()));
    session.socket?.close();
    const closeLeftovers = () => {
      session.contexts.forEach(context => {
        if (context.state !== 'closed') context.close().catch(() => {});
      });
      session.audioElements.forEach(element => {
        element.pause();
        element.srcObject = null;
        element.remove();
      });
      session.audioElements.clear();
    };
    if (session.conversation) {
      if (!session.ending) {
        session.ending = true;
        // The SDK closes input before output. Closing its contexts first makes
        // input.close() reject and skips the output element/timer cleanup.
        session.conversation.endSession().catch(() => {}).finally(closeLeftovers);
      }
    } else closeLeftovers();
  }
  function stopSession(session, error = null) {
    session.stopped = true;
    clearTimeout(session.timer);
    // An in-flight guarded call rejects late permission/socket results. Between
    // guarded calls, keep hooks installed until the SDK continuation unwinds.
    if (!session.setupPending || !session.restoreSetup || session.guardedCalls > 0) {
      session.restoreSetup?.();
      if (pendingSetup === session) pendingSetup = null;
    }
    closeResources(session);
    session.cancel({ status: error ? 'unavailable' : 'stopped' });
    if (current !== session) return;
    current = null;
    replies.reset();
    publish({ status: error ? 'error' : 'idle', speaking: false, micMuted: false, error });
  }
  function start(config) {
    if (current) return current.done;
    if (pendingSetup) {
      publish({ status: 'error', error: 'The previous connection is still closing. Please try again shortly.' });
      return Promise.resolve({ status: 'unavailable' });
    }
    const agentId = config?.agentId;
    if (typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(agentId)) {
      publish({ status: 'error', error: 'Voice conversation is not available yet.' });
      return Promise.resolve({ status: 'unavailable' });
    }
    replies.reset();
    const session = { stopped: false, setupPending: true, guardedCalls: 0, connected: false,
      streams: new Set(), contexts: new Set(), audioElements: new Set(), conversation: null, cutoff: 0, micMuted: false };
    const cancelled = new Promise(resolve => { session.cancel = resolve; });
    current = pendingSetup = session;
    publish({ status: 'connecting', speaking: false, micMuted: false, error: null });
    const active = () => current === session && !session.stopped;
    const fail = error => { if (active()) stopSession(session, errorMessage(error)); };
    session.timer = setTimeout(() => fail({ code: 'TIMEOUT' }), connectionTimeoutMs);
    const setup = (async () => {
      try {
        const client = await loadClient();
        if (!active()) return { status: 'stopped' };
        if (!media?.getUserMedia) throw Object.assign(new Error('No microphone'), { name: 'NotFoundError' });
        session.restoreSetup = guardElevenSetup(session, client, { host, media });
        session.conversation = await client.Conversation.startSession({
          agentId, connectionType: 'websocket', useWakeLock: false,
          // The pinned local SDK must never fetch its optional resampler CDN.
          libsampleratePath: 'data:application/javascript,throw%20new%20Error(%22Unsupported%20live%20sample%20rate%22)',
          onConversationCreated(conversation) {
            session.conversation = conversation;
            conversation.onError = fail;
            conversation.input.onError = fail;
            conversation.setVolume({ volume: 0 });
            conversation.output.audioElement.muted = true;
            if (active()) {
              conversation.setMicMuted(state.micMuted);
              session.releaseOutput();
            } else closeResources(session);
          },
          onConnect() {
            if (!active()) return;
            session.connected = true;
            clearTimeout(session.timer);
            publish({ status: 'connected' });
          },
          onIncomingEvent(event) {
            if (!active()) return;
            if (event.type === 'queue_status' && event.queue_status_event?.status !== 'admitted') {
              fail({ code: 'BUSY' }); return;
            }
            if (event.type === 'interruption' && Number.isFinite(event.interruption_event?.event_id)) {
              session.cutoff = Math.max(session.cutoff, event.interruption_event.event_id);
            }
            replies.accept(event);
          },
          // Queue/listening notifications are not reply boundaries. Raw
          // agent_response_complete is consumed by the reply router instead.
          onDisconnect(details) {
            if (active()) stopSession(session, details?.reason === 'error' ? errorMessage() : null);
          },
          onError: fail
        });
        if (!active()) { closeResources(session); return { status: 'stopped' }; }
        return { status: 'connected' };
      } catch (error) {
        if (!active()) return { status: 'stopped' };
        fail(error);
        return { status: 'unavailable' };
      } finally {
        session.restoreSetup?.();
        session.setupPending = false;
        if (pendingSetup === session) pendingSetup = null;
      }
    })();
    session.done = Promise.race([setup, cancelled]);
    return session.done;
  }
  return {
    get state() { return { ...state }; },
    prepare() { return loadClient().then(() => ({ status: 'prepared' }), () => ({ status: 'unavailable' })); },
    start,
    stop() { if (current) stopSession(current); },
    setMicMuted(muted) {
      if (!current) return;
      const value = Boolean(muted);
      current.micMuted = value;
      // Disable tracks synchronously as well as the SDK worklet's input gate.
      current.streams.forEach(stream => stream.getTracks().forEach(track => { track.enabled = !value; }));
      current.conversation?.setMicMuted(value);
      publish({ micMuted: value });
    },
    // Read the SDK's existing analyser only during a genuine listening gap.
    // No microphone samples, text or levels are retained or published to UI.
    currentInputVolume() {
      if (!current?.connected || current.micMuted || replies.replyOpen
          || voice.stream.isActive?.() || voice.stream.isAudible()) return 0;
      const value = current.conversation?.getInputVolume?.();
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    },
    onFrame() {
      if (current?.connected) publish({ speaking: voice.stream.isAudible() });
    }
  };
}
