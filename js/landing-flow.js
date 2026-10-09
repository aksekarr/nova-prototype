// The local landing experience owns one cached greeting. Rendering advances the
// formation clock; no microphone or live provider is part of this flow.
export function createLandingFlow({ voice, setMode, getClock,
  setReplyText = () => {}, onChange = () => {}, formationMs = 3000 }) {
  const CANCELLED = Symbol('cancelled');
  let active = null, disposed = false, formationTarget = null;
  let snapshot = { phase: 'arrival', busy: false, speaking: false, error: null };
  let resolveDisposed;
  const disposedPromise = new Promise(resolve => { resolveDisposed = resolve; });

  function publish(phase, error = null) {
    snapshot = { phase, error, speaking: phase === 'greeting',
      busy: phase === 'loading' || phase === 'forming' || phase === 'greeting' };
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
    token.finishFormation?.(CANCELLED);
    token.finishFormation = null;
  }

  function waitForFormation(token) {
    if (getClock() >= formationTarget) return Promise.resolve();
    return new Promise(resolve => { token.finishFormation = resolve; });
  }

  function start() {
    if (disposed) return Promise.resolve({ status: 'disposed' });
    if (active) return active.done;

    const token = {};
    token.cancelled = new Promise(resolve => { token.cancel = resolve; });
    active = token;
    const owns = () => active === token && !disposed;
    async function current(promise) {
      const result = await Promise.race([promise, token.cancelled]);
      if (result === CANCELLED || !owns()) throw CANCELLED;
      return result;
    }

    // Begin resume directly in the click handler, before yielding the gesture.
    const activated = attempt(() => voice.activate());
    let ready = false;
    const prepared = Promise.all([activated, attempt(() => voice.preload(['intro']))])
      .then(() => {
        if (!owns()) throw CANCELLED;
        return voice.getLabLine('intro');
      })
      .then(line => {
        if (!owns()) throw CANCELLED;
        ready = true;
        return line;
      });
    // Visual setup can fail before the preparation is awaited.
    prepared.catch(() => {});

    token.done = (async () => {
      try {
        if (setMode('face') === false) {
          throw Object.assign(new Error('Face unavailable'), { code: 'FACE_UNAVAILABLE' });
        }
        if (formationTarget === null) formationTarget = getClock() + formationMs / 1000;
        const forming = getClock() < formationTarget;
        publish(forming ? 'forming' : 'loading');
        const formation = current(waitForFormation(token)).then(() => {
          if (owns() && !ready) publish('loading');
        });
        const [line] = await Promise.all([current(prepared), formation]);
        if (!owns()) throw CANCELLED;
        setReplyText(line?.text ?? null);
        publish('greeting');
        const result = await current(attempt(() => voice.speak('intro')));
        if (result?.status === 'unavailable') throw result.error || new Error('Voice unavailable');
        publish('present');
        return { status: result?.status === 'stopped' ? 'stopped' : 'completed' };
      } catch (error) {
        if (error === CANCELLED || !owns()) return { status: 'stopped' };
        voice.stop();
        const message = error?.code === 'AUDIO_UNAVAILABLE'
          ? 'Audio could not start. Try again.'
          : error?.code === 'FACE_UNAVAILABLE'
            ? 'Seni could not form. Try again.'
            : 'The introduction could not load or play. Try again.';
        publish('error', message);
        return { status: 'unavailable' };
      } finally {
        token.finishFormation?.(CANCELLED);
        token.finishFormation = null;
        if (active === token) active = null;
      }
    })();
    return token.done;
  }

  function returnToNebula() {
    if (disposed) return;
    cancelActive();
    voice.stop();
    setReplyText(null);
    formationTarget = null;
    setMode('nebula');
    publish('arrival');
  }

  return {
    get state() { return { ...snapshot }; },
    get phase() { return snapshot.phase; },
    // A failed warmup stays silent and never disables the entry/retry control.
    prepare() {
      if (disposed) return Promise.resolve({ status: 'disposed' });
      const warmup = attempt(() => voice.preload(['intro'], { background: true }))
        .then(() => ({ status: 'prepared' }), () => ({ status: 'unavailable' }));
      return Promise.race([warmup, disposedPromise]);
    },
    meet: start,
    repeatGreeting: start,
    returnToNebula,
    onFrame() {
      if (active?.finishFormation && getClock() >= formationTarget) {
        const finish = active.finishFormation;
        active.finishFormation = null;
        finish();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelActive();
      voice.stop();
      setReplyText(null);
      snapshot = { phase: 'arrival', busy: false, speaking: false, error: null };
      resolveDisposed({ status: 'disposed' });
    }
  };
}
