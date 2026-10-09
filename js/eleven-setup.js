// Pinned 1.27.0 integration. setupWebSocketIO attaches output before creating the
// conversation; defer addListener's queued-audio flush until output is muted.
// Also retain the SDK's otherwise unabortable setup resources for Stop/deadline.
export function guardElevenSetup(session, client, { host, media }) {
  // Optional ownership tracking closes worklet contexts even if one half of
  // the SDK's parallel input/output setup fails before returning a controller.
  const contextHooks = [];
  if (session.contexts) for (const name of ['AudioContext', 'webkitAudioContext']) {
    const NativeContext = host[name];
    if (!NativeContext) continue;
    const guardedContext = new Proxy(NativeContext, {
      construct(Target, args) {
        if (session.stopped) throw new DOMException('Live stopped', 'AbortError');
        const context = new Target(...args);
        session.contexts.add(context);
        return context;
      }
    });
    host[name] = guardedContext;
    contextHooks.push({ name, NativeContext, guardedContext });
  }
  // Production opts into retaining only elements constructed during its SDK
  // setup; the legacy study does not install this hook or touch other elements.
  const NativeAudio = session.audioElements ? host.Audio : null;
  const guardedAudio = NativeAudio ? new Proxy(NativeAudio, {
    construct(Target, args) {
      if (session.stopped) throw new DOMException('Live stopped', 'AbortError');
      const element = new Target(...args);
      session.audioElements.add(element);
      return element;
    }
  }) : null;
  if (guardedAudio) host.Audio = guardedAudio;
  const getUserMedia = media.getUserMedia;
  const createConnection = client.WebSocketConnection.create;
  const guardedMedia = async function (constraints) {
    session.guardedCalls++;
    try {
      if (session.stopped) throw new DOMException('Live stopped', 'AbortError');
      const stream = await getUserMedia.call(media, constraints);
      session.streams.add(stream);
      if (session.micMuted !== undefined) stream.getTracks().forEach(track => { track.enabled = !session.micMuted; });
      if (session.stopped) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Live stopped', 'AbortError');
      }
      return stream;
    } finally { session.guardedCalls--; }
  };
  const guardedConnection = async function (config) {
    session.guardedCalls++;
    try {
      if (session.stopped) throw new DOMException('Live stopped', 'AbortError');
      const NativeSocket = host.WebSocket;
      let pending;
      // create() constructs its socket synchronously, before its first await.
      host.WebSocket = new Proxy(NativeSocket, {
        construct(Target, args) {
          session.socket = new Target(...args);
          return session.socket;
        }
      });
      try { pending = createConnection.call(this, config); }
      finally { host.WebSocket = NativeSocket; }
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
    } finally { session.guardedCalls--; }
  };
  media.getUserMedia = guardedMedia;
  client.WebSocketConnection.create = guardedConnection;
  return () => {
    if (guardedAudio && host.Audio === guardedAudio) host.Audio = NativeAudio;
    for (const { name, NativeContext, guardedContext } of contextHooks) {
      if (host[name] === guardedContext) host[name] = NativeContext;
    }
    // A stopped setup may settle after a new one has acquired these hooks.
    if (media.getUserMedia === guardedMedia) media.getUserMedia = getUserMedia;
    if (client.WebSocketConnection.create === guardedConnection) client.WebSocketConnection.create = createConnection;
  };
}

