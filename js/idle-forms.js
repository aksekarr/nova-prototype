// Pure visual-idle policy. The caller supplies monotonic seconds and observed
// activity; no microphone, audio, timers, or conversation lifecycle is owned here.
export function createIdleForms({ idleSeconds = 25, quietThreshold = .01,
  activityThreshold = .025, observationGap = 1 } = {}) {
  let enabled = true, lastActivity = null, lastObservation = null;
  let inputQuiet = false, inputActive = false;
  function reset(now) {
    if (Number.isFinite(now)) lastActivity = now;
  }
  function activity(now, mode) {
    reset(now);
    return mode === 'orbit' ? 'face' : null;
  }
  return {
    reset, activity,
    setEnabled(value, now) { enabled = Boolean(value); reset(now); },
    get enabled() { return enabled; },
    update(now, { mode, audioActive = false, replyPending = false,
      scriptActive = false, tuningActive = false, visible = true, liveReady = true,
      monitorInput = false, inputReady = false, inputLevel = null } = {}) {
      if (!Number.isFinite(now)) return null;
      if (lastActivity === null || (lastObservation !== null &&
          (now < lastObservation || now - lastObservation > observationGap))) {
        reset(now);
        inputQuiet = inputActive = false;
      }
      lastObservation = now;
      if (!visible || !liveReady) {
        reset(now);
        inputQuiet = inputActive = false;
        return null;
      }
      if (monitorInput) {
        // SDK volume is spectral activity, not speech probability. Require a
        // confirmed quiet reading; missing/muted/suspended input fails closed.
        if (!inputReady || !Number.isFinite(inputLevel) || inputLevel < 0) {
          reset(now);
          inputQuiet = inputActive = false;
          return null;
        }
        if (inputLevel >= activityThreshold) { inputQuiet = false; inputActive = true; }
        else if (inputLevel <= quietThreshold) { inputQuiet = true; inputActive = false; }
        else inputQuiet = false;
        if (inputActive) return activity(now, mode);
        if (!inputQuiet) { reset(now); return null; }
      } else inputQuiet = inputActive = false;
      if (!enabled || mode !== 'face' || audioActive || replyPending || scriptActive || tuningActive) {
        reset(now);
        return null;
      }
      if (now - lastActivity < idleSeconds) return null;
      reset(now);
      return 'orbit';
    }
  };
}
