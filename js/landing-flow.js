// The local landing experience owns one cached greeting and the idle forms.
// Rendering advances every visual wait; no microphone or live provider is used.
export function createLandingFlow({ voice, setMode, getClock, isTransitioning = () => false,
  setReplyText = () => {}, onChange = () => {}, formationMs = 3000 }) {
  const CANCELLED = Symbol('cancelled');
  let active = null, disposed = false, formationTarget = null, frame = 0;
  let form = 'nebula', hasMet = false, nextSurprise = 'orbit';
  let snapshot = { phase: 'arrival', form, busy: false, speaking: false, error: null };
  let resolveDisposed;
  const disposedPromise = new Promise(resolve => { resolveDisposed = resolve; });

  function publish(phase, error = null) {
    snapshot = { phase, form, error, speaking: phase === 'greeting',
      busy: phase === 'loading' || phase === 'forming' || phase === 'greeting' || phase === 'changing-form' };
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

  function start() {
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
        const returningFromForm = form === 'orbit' || form === 'jelly';
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
    try { selectForm(mode); }
    catch {
      publish(snapshot.phase, 'That form could not appear. Please try again.');
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
    voice.stop();
    setReplyText(null);
    try { selectForm('nebula'); }
    catch {
      publish(hasMet ? 'present' : 'error', 'The nebula could not appear. Please try again.');
      return;
    }
    formationTarget = null;
    hasMet = false;
    nextSurprise = 'orbit';
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
    surprise() {
      if (disposed) return Promise.resolve({ status: 'disposed' });
      if (snapshot.phase !== 'present') return Promise.resolve({ status: 'ignored' });
      const requested = nextSurprise;
      const result = changeForm(requested);
      if (form === requested) nextSurprise = requested === 'orbit' ? 'jelly' : 'orbit';
      return result;
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
      voice.stop();
      setReplyText(null);
      snapshot = { phase: 'arrival', form: 'nebula', busy: false, speaking: false, error: null };
      resolveDisposed({ status: 'disposed' });
    }
  };
}
