// The landing owns form transitions and either a live session or a cached greeting.
// Rendering advances visual waits; cancelled work cannot regain the page.
const NEXT_FORM = { face: 'jelly', jelly: 'orbit', orbit: 'lotus', lotus: 'face' };

export function createLandingFlow({ voice, setMode, getClock, isTransitioning = () => false,
  setReplyText = () => {}, onChange = () => {}, formationMs = 3000, agent = null, agentConfig = null }) {
  const CANCELLED = Symbol('cancelled');
  let active = null, disposed = false, formationTarget = null, frame = 0;
  let form = 'nebula', hasMet = false, conversationWanted = false;
  const live = Boolean(agent && agentConfig?.agentId);
  const sessionView = () => live ? { live: true, connection: agent.state.status, micMuted: agent.state.micMuted } : {};
  let snapshot = { phase: 'arrival', form, busy: false, speaking: false, error: null, ...sessionView() };
  let resolveDisposed;
  const disposedPromise = new Promise(resolve => { resolveDisposed = resolve; });

  function publish(phase, error = null) {
    snapshot = { phase, form, error, speaking: phase === 'greeting' || phase === 'speaking',
      busy: phase === 'loading' || phase === 'forming' || phase === 'greeting' || phase === 'changing-form' || phase === 'connecting',
      ...sessionView() };
    onChange({ ...snapshot });
  }

  function attempt(action) {
    try { return Promise.resolve(action()); }
    catch (error) { return Promise.reject(error); }
  }

  function cancelActive() {
    const token = active;
    active = null;
    if (!token) return;
    token.cancel(CANCELLED);
    token.visualWait?.finish(CANCELLED);
    token.visualWait = null;
  }

  function createToken(kind) {
    const token = { kind };
    token.cancelled = new Promise(resolve => { token.cancel = resolve; });
    token.owns = () => active === token && !disposed;
    token.current = async promise => {
      const result = await Promise.race([promise, token.cancelled]);
      if (result === CANCELLED || !token.owns()) throw CANCELLED;
      return result;
    };
    active = token;
    return token;
  }

  function finishToken(token) {
    token.visualWait?.finish(CANCELLED);
    token.visualWait = null;
    if (active === token) active = null;
  }

  function selectForm(mode) {
    if (setMode(mode) === false) throw Object.assign(new Error('Form unavailable'), { code: 'FORM_UNAVAILABLE' });
    form = mode;
  }

  function waitForVisual(token, target, fence = false) {
    if (!fence && getClock() >= target && !isTransitioning()) return Promise.resolve();
    return new Promise(finish => {
      token.visualWait = { finish, target, afterFrame: frame + (fence ? 1 : 0) };
    });
  }

  function stopAgent() {
    conversationWanted = false;
    if (live) agent.stop();
  }

  function agentChanged() {
    if (!live || disposed || !conversationWanted || form !== 'face') return;
    const session = agent.state;
    if (session.status === 'connecting') publish('connecting');
    else if (session.status === 'connected') publish(session.speaking ? 'speaking' : 'listening');
    else {
      conversationWanted = false;
      setReplyText(null);
      publish('present', session.status === 'error' ? session.error || 'The conversation could not connect. Try again.' : null);
    }
  }

  function startLive() {
    if (disposed) return Promise.resolve({ status: 'disposed' });
    if (active?.kind === 'conversation') return active.done;
    // Output activation keeps the original click gesture; the microphone starts
    // only when the formed face is ready for the agent's own greeting.
    const activated = attempt(() => voice.activate());
    activated.catch(() => {});
    cancelActive();
    stopAgent();
    voice.stop();
    setReplyText(null);
    const token = createToken('conversation');
    token.done = (async () => {
      try {
        const returningFromForm = form !== 'face' && form !== 'nebula';
        selectForm('face');
        if (formationTarget === null) formationTarget = getClock() + formationMs / 1000;
        const forming = getClock() < formationTarget;
        publish(returningFromForm ? 'changing-form' : forming ? 'forming' : 'loading');
        await Promise.all([token.current(activated), token.current(waitForVisual(token, formationTarget, returningFromForm))]);
        if (!token.owns()) throw CANCELLED;
        hasMet = true;
        conversationWanted = true;
        publish('connecting');
        const result = await token.current(attempt(() => agent.start(agentConfig)));
        if (result?.status === 'unavailable') {
          const message = agent.state.error || 'The conversation could not connect. Try again.';
          stopAgent();
          publish('present', message);
          return { status: 'unavailable' };
        }
        if (result?.status === 'stopped') {
          stopAgent();
          publish('present');
          return { status: 'stopped' };
        }
        agentChanged();
        return { status: 'connected' };
      } catch (error) {
        if (error === CANCELLED || !token.owns()) return { status: 'stopped' };
        stopAgent();
        voice.stop();
        const message = error?.code === 'AUDIO_UNAVAILABLE' ? 'Audio could not start. Try again.'
          : error?.code === 'FORM_UNAVAILABLE' ? 'Seni could not form. Try again.'
            : 'The conversation could not connect. Try again.';
        if (hasMet && isTransitioning()) {
          publish('changing-form', message);
          try { await token.current(waitForVisual(token, getClock(), true)); }
          catch { return { status: 'stopped' }; }
        }
        publish(hasMet ? 'present' : 'error', message);
        return { status: 'unavailable' };
      } finally { finishToken(token); }
    })();
    return token.done;
  }

  function startCached() {
    if (disposed) return Promise.resolve({ status: 'disposed' });
    if (active?.kind === 'greeting') return active.done;

    // Begin resume directly in the click handler, before yielding the gesture.
    const activated = attempt(() => voice.activate());
    // A replay can reverse an idle form transition; its old completion loses ownership.
    cancelActive();
    const token = createToken('greeting');
    let ready = false;
    const prepared = Promise.all([activated, attempt(() => voice.preload(['intro']))])
      .then(() => {
        if (!token.owns()) throw CANCELLED;
        return voice.getLabLine('intro');
      })
      .then(line => {
        if (!token.owns()) throw CANCELLED;
        ready = true;
        return line;
      });
    // Visual setup can fail before the preparation is awaited.
    prepared.catch(() => {});

    token.done = (async () => {
      try {
        const returningFromForm = form === 'orbit' || form === 'jelly' || form === 'lotus';
        selectForm('face');
        if (formationTarget === null) formationTarget = getClock() + formationMs / 1000;
        const forming = getClock() < formationTarget;
        publish(returningFromForm ? 'changing-form' : forming ? 'forming' : 'loading');
        const formation = token.current(waitForVisual(token, formationTarget, returningFromForm)).then(() => {
          if (token.owns() && !ready) publish('loading');
        });
        const [line] = await Promise.all([token.current(prepared), formation]);
        if (!token.owns()) throw CANCELLED;
        setReplyText(line?.text ?? null);
        publish('greeting');
        const result = await token.current(attempt(() => voice.speak('intro')));
        if (result?.status === 'unavailable') throw result.error || new Error('Voice unavailable');
        hasMet = true;
        publish('present');
        return { status: result?.status === 'stopped' ? 'stopped' : 'completed' };
      } catch (error) {
        if (error === CANCELLED || !token.owns()) return { status: 'stopped' };
        voice.stop();
        const message = error?.code === 'AUDIO_UNAVAILABLE'
          ? 'Audio could not start. Try again.'
          : error?.code === 'FORM_UNAVAILABLE'
            ? 'Seni could not form. Try again.'
            : 'The introduction could not load or play. Try again.';
        if (hasMet && isTransitioning()) {
          publish('changing-form', message);
          try { await token.current(waitForVisual(token, getClock(), true)); }
          catch { return { status: 'stopped' }; }
        }
        publish(hasMet ? 'present' : 'error', message);
        return { status: 'unavailable' };
      } finally {
        finishToken(token);
      }
    })();
    return token.done;
  }

  function changeForm(mode) {
    const endingConversation = conversationWanted;
    if (endingConversation) {
      cancelActive();
      stopAgent();
      voice.stop();
      setReplyText(null);
    }
    try { selectForm(mode); }
    catch {
      publish(endingConversation ? 'present' : snapshot.phase, 'That form could not appear. Please try again.');
      return Promise.resolve({ status: 'unavailable' });
    }
    cancelActive();
    const token = createToken('form');
    voice.stop();
    setReplyText(null);
    publish('changing-form');
    token.done = (async () => {
      try {
        await token.current(waitForVisual(token, getClock(), true));
        publish('present');
        return { status: 'completed' };
      } catch (error) {
        if (error === CANCELLED || !token.owns()) return { status: 'stopped' };
        publish('present', 'That form could not appear. Please try again.');
        return { status: 'unavailable' };
      } finally {
        finishToken(token);
      }
    })();
    return token.done;
  }

  function returnToNebula() {
    if (disposed) return;
    cancelActive();
    stopAgent();
    voice.stop();
    setReplyText(null);
    try { selectForm('nebula'); }
    catch {
      publish(hasMet ? 'present' : 'error', 'The nebula could not appear. Please try again.');
      return;
    }
    formationTarget = null;
    hasMet = false;
    publish('arrival');
  }

  return {
    get state() { return { ...snapshot }; },
    get phase() { return snapshot.phase; },
    // A failed warmup stays silent and never disables the entry/retry control.
    prepare() {
      if (disposed) return Promise.resolve({ status: 'disposed' });
      const warmup = attempt(() => live ? agent.prepare() : voice.preload(['intro'], { background: true }))
        .then(result => ({ status: result?.status === 'unavailable' ? 'unavailable' : 'prepared' }), () => ({ status: 'unavailable' }));
      return Promise.race([warmup, disposedPromise]);
    },
    meet: live ? startLive : startCached,
    repeatGreeting: live ? startLive : startCached,
    agentChanged,
    endConversation() {
      if (disposed || !live) return;
      cancelActive();
      stopAgent();
      voice.stop();
      setReplyText(null);
      if (form === 'face') publish('present');
    },
    setMicMuted(muted) {
      if (disposed || !live || !conversationWanted) return;
      agent.setMicMuted(Boolean(muted));
      agentChanged();
    },
    surprise() {
      if (disposed) return Promise.resolve({ status: 'disposed' });
      if (!['present', 'connecting', 'listening', 'speaking'].includes(snapshot.phase)) return Promise.resolve({ status: 'ignored' });
      return changeForm(NEXT_FORM[form]);
    },
    showFace() {
      if (disposed) return Promise.resolve({ status: 'disposed' });
      if (snapshot.phase !== 'present' && snapshot.phase !== 'changing-form') return Promise.resolve({ status: 'ignored' });
      if (form === 'face' && snapshot.phase === 'present') return Promise.resolve({ status: 'completed' });
      return changeForm('face');
    },
    returnToNebula,
    onFrame() {
      frame++;
      const wait = active?.visualWait;
      if (wait && frame >= wait.afterFrame && getClock() >= wait.target && !isTransitioning()) {
        active.visualWait = null;
        wait.finish();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelActive();
      stopAgent();
      voice.stop();
      setReplyText(null);
      snapshot = { phase: 'arrival', form: 'nebula', busy: false, speaking: false, error: null, ...sessionView() };
      resolveDisposed({ status: 'disposed' });
    }
  };
}
