// Agent response completion is distinct from an empty playback queue:
// https://elevenlabs.io/docs/eleven-agents/customization/events/client-events#agent_response_complete
export function createAgentReplies({ stream, onReplyText = () => {} }) {
  let turn = null, cutoff = 0, completedThrough = -1, lastInterruption = -1;
  const ownedHandles = new Set();
  const validId = id => Number.isFinite(id) && id >= 0;
  const accepts = id => validId(id) && id >= cutoff && id > completedThrough;

  function ensureTurn(id) {
    if (!turn) turn = { lastId: id, messages: [], handle: null };
    turn.lastId = Math.max(turn.lastId, id);
    return turn;
  }

  function textOf(reply) {
    return reply.messages.map(message => message.text).join(' ');
  }

  function beginAudio(id) {
    const reply = ensureTurn(id);
    if (!reply.handle) {
      reply.handle = stream.begin();
      ownedHandles.add(reply.handle);
      const text = textOf(reply);
      onReplyText(text || null);
      if (text) reply.handle.setText(text);
    }
    return reply.handle;
  }

  function clearPlayback() {
    turn = null;
    for (const handle of ownedHandles) handle.interrupt();
    ownedHandles.clear();
    onReplyText(null);
  }

  function accept(event) {
    if (!event || typeof event !== 'object') return false;
    if (event.type === 'audio') {
      const audio = event.audio_event;
      if (!audio || !accepts(audio.event_id)) return false;
      const hasAudio = typeof audio.audio_base_64 === 'string' && audio.audio_base_64.length > 0;
      const hasAlignment = Array.isArray(audio.alignment?.chars) && audio.alignment.chars.length > 0;
      if (!hasAudio && !hasAlignment) return false;
      const handle = beginAudio(audio.event_id);
      // Keep alignment and PCM on the same handle, including after network gaps.
      if (hasAlignment) handle.addAlignment(audio.alignment);
      if (hasAudio) handle.addAudio(audio.audio_base_64);
      return true;
    }
    if (event.type === 'agent_response') {
      const message = event.agent_response_event;
      if (!message || !accepts(message.event_id) || typeof message.agent_response !== 'string') return false;
      const reply = ensureTurn(message.event_id);
      const text = message.agent_response.trim();
      const responseId = typeof message.response_id === 'string' && message.response_id ? message.response_id : null;
      const previous = reply.messages.find(item => responseId ? item.responseId === responseId
        : item.eventId === message.event_id && item.text === text);
      if (previous) previous.text = text;
      else reply.messages.push({ responseId, eventId: message.event_id, text });
      if (reply.handle) {
        const fullText = textOf(reply);
        onReplyText(fullText || null);
        reply.handle.setText(fullText);
      }
      return true;
    }
    if (event.type === 'interruption') {
      const id = event.interruption_event?.event_id;
      if (!validId(id) || id <= lastInterruption || id < cutoff || id <= completedThrough || id < (turn?.lastId ?? -1)) return false;
      // Match the pinned SDK: IDs below this boundary are obsolete.
      cutoff = Math.max(cutoff, id);
      lastInterruption = id;
      clearPlayback();
      return true;
    }
    if (event.type === 'agent_response_complete') {
      const id = event.agent_response_complete_event?.event_id;
      if (!accepts(id) || id < (turn?.lastId ?? -1)) return false;
      const finished = turn;
      turn = null;
      completedThrough = id;
      if (finished?.handle) {
        const handle = finished.handle;
        // This promise belongs only to this handle; draining cannot alter a later turn.
        Promise.resolve(handle.end()).then(() => ownedHandles.delete(handle), () => ownedHandles.delete(handle));
      }
      return true;
    }
    return false;
  }

  return {
    accept,
    get replyOpen() { return Boolean(turn?.handle); },
    interrupt() {
      completedThrough = Math.max(completedThrough, turn?.lastId ?? -1);
      clearPlayback();
    },
    reset() {
      clearPlayback();
      cutoff = 0;
      completedThrough = -1;
      lastInterruption = -1;
    }
  };
}
