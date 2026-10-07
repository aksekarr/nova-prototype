// Throwaway spike; safe to delete.
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.27.0/dist/lib.iife.js';
const LIMIT_MS = 90_000;

// Own all SDK resources in a disposable browsing context: startSession has no abort API.
if (window.frameElement?.dataset.spikeSession === 'true') {
  installSessionRunner();
} else {
  installPage();
}

function installSessionRunner() {
  let conversation;
  let stopped = false;
  let report;
  let privateAgentId = '';

  // Error messages can embed the agent ID. Never retain it in logs or exports.
  function clean(value) {
    const serialized = JSON.stringify(value, (key, item) => {
      if (/^(agentId|agent_id)$/i.test(key)) return '[redacted]';
      if (key === 'audio_base_64') return '[audio omitted]';
      if (typeof item === 'string' && privateAgentId) return item.split(privateAgentId).join('[agent ID redacted]');
      if (item && Object.prototype.toString.call(item) === '[object Error]') {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      return item;
    });
    return serialized === undefined ? null : JSON.parse(serialized);
  }

  window.spikeSession = {
    start(agentId, connectionType, receive) {
      privateAgentId = agentId;
      report = (event, data, arrivedAt = window.parent.performance.now()) => receive(event, clean(data), arrivedAt);
      const callbacks = {};
      for (const event of ['onConnect', 'onDisconnect', 'onStatusChange', 'onModeChange',
        'onMessage', 'onAgentChatResponsePart', 'onInterruption', 'onAgentResponseCorrection']) {
        callbacks[event] = (data) => report(event, data);
      }
      callbacks.onError = (message, context) => report('onError', { message, context });
      callbacks.onIncomingEvent = (event) => report('onIncomingEvent', { type: event.type });
      callbacks.onAudioAlignment = (alignment) => {
        const arrivedAt = window.parent.performance.now();
        report('onAudioAlignment', {
          chars: alignment.chars.join(''),
          char_start_times_ms: alignment.char_start_times_ms,
          char_durations_ms: alignment.char_durations_ms,
          character_count: alignment.chars.length,
        }, arrivedAt);
      };
      callbacks.onAudio = (base64) => {
        const arrivedAt = window.parent.performance.now();
        // The pinned client supplies base64; calculate decoded bytes without keeping audio.
        const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
        report('onAudio', { byteLength: Math.floor(base64.length * 3 / 4) - padding }, arrivedAt);
      };
      callbacks.onConversationCreated = (value) => { conversation = value; };
      // Called synchronously by the parent's user-click handler; no automatic sessions.
      return window.ElevenLabsClient.Conversation.startSession({ agentId, connectionType, ...callbacks })
        .then((value) => {
          conversation = value;
          if (stopped) return value.endSession();
        })
        .catch((error) => report('startSessionRejected', { error }));
    },
    volume() { return conversation?.getOutputVolume(); },
    stop() {
      stopped = true;
      try {
        return Promise.resolve(conversation?.endSession()).catch((error) => report?.('endSessionRejected', { error }));
      } catch (error) {
        report?.('endSessionRejected', { error });
        return Promise.resolve();
      }
    },
  };
}

function installPage() {
  const byId = (id) => document.getElementById(id);
  const input = byId('agent-id');
  const status = byId('status');
  const log = byId('log');
  const summary = byId('summary');
  const stopButton = byId('stop');
  const copyButton = byId('copy-summary');
  const downloadButton = byId('download-log');
  const starts = [byId('start-websocket'), byId('start-webrtc')];
  let frame;
  let ready = false;
  let run;
  let pageLeaving = false;

  function setControls() {
    const active = run && !run.finished;
    starts.forEach((button) => { button.disabled = active || !ready; });
    input.disabled = Boolean(active);
    stopButton.disabled = !active || run.stopping;
    copyButton.disabled = !run?.finished;
    downloadButton.disabled = !run?.finished;
  }

  function prepareFrame() {
    ready = false;
    setControls();
    frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'Disposable voice session';
    frame.dataset.spikeSession = 'true';
    frame.allow = 'microphone; autoplay';
    frame.srcdoc = `<!doctype html><html><head><meta name="referrer" content="no-referrer"></head><body><script src="${SDK_URL}"></script><script type="module" src="${new URL('./agent.js', location.href).href}"></script></body></html>`;
    frame.addEventListener('load', () => {
      ready = Boolean(window.ElevenLabsClient?.Conversation?.startSession && frame.contentWindow?.ElevenLabsClient?.Conversation?.startSession && frame.contentWindow?.spikeSession);
      if (!run || run.finished) status.textContent = ready
        ? 'Pinned client ready · window.ElevenLabsClient exists · No conversation running.'
        : 'Client failed to load. Check the network and reload this page.';
      setControls();
    });
    document.body.append(frame);
  }

  function record(current, event, data, arrivedAt = performance.now()) {
    if (current.finished) return;
    const entry = { t: arrivedAt - current.startedAt, event, data };
    current.entries.push(entry);
    log.append(document.createTextNode(`${JSON.stringify(entry)}\n`));
    log.scrollTop = log.scrollHeight;
    return entry;
  }

  function clearSampling(current) {
    clearInterval(current.sampling);
    current.sampling = null;
  }

  function receive(current, event, data, arrivedAt) {
    if (current.finished) return;
    record(current, event, data, arrivedAt);
    if (event === 'onStatusChange') {
      current.connected = data.status === 'connected';
      if (!current.connected) clearSampling(current);
      if (current.connected && !current.stopping && !current.sampling) {
        current.sampling = setInterval(() => {
          if (performance.now() - current.startedAt >= LIMIT_MS) {
            stop(current, '90-second hard limit', true);
            return;
          }
          try {
            const sampledAt = performance.now();
            record(current, 'outputVolume', { value: current.runner.volume() }, sampledAt);
          } catch (error) {
            record(current, 'outputVolumeError', { message: String(error) });
          }
        }, 50);
      }
      status.textContent = `${current.transport} · ${data.status}`;
    }
    if (event === 'onDisconnect' || event === 'startSessionRejected') {
      // Let the SDK finish this callback before disposing its browsing context.
      queueMicrotask(() => stop(current, event === 'onDisconnect' ? `Disconnected: ${data.reason}` : 'Start failed'));
    }
  }

  function start(transport) {
    if (!ready || (run && !run.finished)) return;
    const agentId = input.value.trim();
    if (!agentId) {
      status.textContent = 'Enter an agent ID first.';
      input.focus();
      return;
    }
    run = {
      transport, startedAt: performance.now(), startedOn: new Date().toISOString(),
      entries: [], runner: frame.contentWindow.spikeSession, frame,
      finished: false, stopping: false, connected: false, sampling: null,
    };
    const current = run;
    log.textContent = '';
    summary.textContent = 'Run in progress. Summary is computed at Stop.';
    status.textContent = `${transport} · starting`;
    input.value = '';
    record(current, 'Start', { transport });
    // Armed before startSession, including time spent waiting for microphone permission.
    current.deadline = setTimeout(() => stop(current, '90-second hard limit', true), LIMIT_MS);
    setControls();
    try {
      current.runner.start(agentId, transport, (event, data, arrivedAt) => receive(current, event, data, arrivedAt));
    } catch (error) {
      record(current, 'startSessionRejected', { message: String(error).split(agentId).join('[agent ID redacted]') });
      stop(current, 'Start failed');
    }
  }

  function finish(current) {
    if (current.finished) return;
    clearSampling(current);
    clearTimeout(current.deadline);
    clearTimeout(current.cleanupDeadline);
    current.frame.remove();
    record(current, 'SessionDisposed', { reason: current.stopReason });
    current.finished = true;
    current.runner = null;
    current.frame = null;
    current.summary = buildSummary(current);
    summary.textContent = JSON.stringify(current.summary, null, 2);
    status.textContent = `${current.transport} · stopped · ${current.stopReason}`;
    setControls();
    if (!pageLeaving) prepareFrame();
  }

  function stop(current, reason, hard = false) {
    if (!current || current.finished) return;
    if (!current.stopping) {
      current.stopping = true;
      current.stopReason = reason;
      current.stoppedAt = performance.now() - current.startedAt;
      clearSampling(current);
      record(current, 'Stop', { reason });
      setControls();
      // Capture graceful disconnect callbacks, but never let teardown keep a session alive.
      current.cleanupDeadline = setTimeout(() => finish(current), 250);
      try {
        Promise.resolve(current.runner.stop()).then(() => finish(current), () => finish(current));
      } catch {
        record(current, 'TeardownError', { message: 'SDK stop failed; disposing the session frame.' });
        finish(current);
      }
    }
    if (hard) {
      current.stopReason = reason;
      finish(current);
    }
  }

  starts[0].addEventListener('click', () => start('websocket'));
  starts[1].addEventListener('click', () => start('webrtc'));
  stopButton.addEventListener('click', () => stop(run, 'Stop button'));
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(run.summary, null, 2));
      status.textContent = 'Summary copied.';
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(summary);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = 'Clipboard access unavailable. Summary selected; press Command-C or Control-C.';
    }
  });
  downloadButton.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({
      sdk: SDK_URL, startedOn: run.startedOn, summary: run.summary, log: run.entries,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `nova-spike-${run.transport}-${run.startedOn.replace(/[:.]/g, '-')}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  window.addEventListener('pagehide', () => {
    pageLeaving = true;
    input.value = '';
    stop(run, 'Page left', true);
    frame?.remove();
    ready = false;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      pageLeaving = false;
      input.value = '';
      prepareFrame();
    }
  });
  input.value = '';
  prepareFrame();
}

function buildSummary(run) {
  const alignments = run.entries.filter((entry) => entry.event === 'onAudioAlignment');
  const firstVolume = run.entries.find((entry) => entry.event === 'outputVolume' && entry.data.value > 0.02);
  const bracketed = (text) => Array.from(text.matchAll(/\[([^\[\]]*)\]/g), (match) => match[1]);
  const messageTags = run.entries
    .filter((entry) => entry.event === 'onMessage' && (entry.data.source === 'ai' || entry.data.role === 'agent'))
    .flatMap((entry) => bracketed(entry.data.message));
  const streams = new Map();
  let anonymousStream = 0;
  for (const { event, data } of run.entries) {
    if (event !== 'onAgentChatResponsePart') continue;
    if (data?.type === 'start') anonymousStream += 1;
    const key = data?.response_id ?? data?.event_id ?? `anonymous-${anonymousStream}`;
    const text = typeof data === 'string' ? data : data?.text ?? '';
    streams.set(key, (streams.get(key) ?? '') + text);
    if (data?.type === 'stop') anonymousStream += 1;
  }
  const firstAlignment = alignments[0]?.t ?? null;
  const firstOutput = firstVolume?.t ?? null;
  return {
    transport: run.transport,
    stop_reason: run.stopReason,
    stop_t_ms: run.stoppedAt,
    alignment_events: alignments.length,
    total_aligned_characters: alignments.reduce((sum, entry) => sum + entry.data.character_count, 0),
    bracketed_strings: {
      agent_onMessage: messageTags,
      chat_response_parts: [...streams.values()].flatMap(bracketed),
      alignment_chars: bracketed(alignments.map((entry) => entry.data.chars).join('')),
    },
    first_alignment_t_ms: firstAlignment,
    first_output_volume_above_0_02_t_ms: firstOutput,
    alignment_minus_first_output_ms: firstAlignment === null || firstOutput === null ? null : firstAlignment - firstOutput,
    alignment_arrival_times_ms: alignments.map((entry) => entry.t),
    notes: 'Times use performance.now() since Start. Negative alignment-minus-output means alignment arrived first. Null means not observed. Bracket lists preserve duplicates and join streaming chunks. Output volume is an analyser proxy, not physical audibility.',
  };
}
