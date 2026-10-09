// Eye-only display poses. The legacy expression, gaze/blink clocks, mouth and
// particle simulation remain authoritative; no random stream is consumed here.
export const EYE_ATTITUDE_KEYS = ['upperLid', 'lowerLid', 'browL', 'browR', 'browAngle'];
export const EYE_FOUNDATIONS = Object.freeze({
  relaxed: Object.freeze({ upperLid: 0.16, lowerLid: 0.34, browL: 0.08, browR: 0.08, browAngle: -0.16 }),
  attentive: Object.freeze({ upperLid: -0.12, lowerLid: 0.26, browL: 0.13, browR: 0.13, browAngle: -0.16 })
});
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const x = clamp(value); return x * x * (3 - 2 * x); };
const envelope = (age, attack, hold, release) => smooth(age / attack)
  * (1 - smooth((age - attack - hold) / release));
const OPEN = { upperLid: -0.24, lowerLid: -0.06, browL: 0.12, browR: 0.12, browAngle: -0.02 };
const SOFT = { upperLid: 0.16, lowerLid: 0.20, browL: 0.04, browR: 0.04, browAngle: -0.04 };

export function createEyeAttitudes(reduce = false) {
  let style = 'current', moments = true, idleTime = 0, replyId = null;
  let phrase = null, phraseCount = 0, lastPhrase = -Infinity;
  let opacity = 0, opacityVelocity = 0, wasEnabled = true;
  const pose = Object.fromEntries(EYE_ATTITUDE_KEYS.map(key => [key, 0]));
  const velocity = { ...pose };
  const state = { style, weight: 0, pose, moment: 'rest', strength: 0, idleTime: 0 };
  const add = (target, values, weight) => {
    for (const key of EYE_ATTITUDE_KEYS) target[key] += values[key] * weight;
  };
  return { state, applyTuning(tuning) {
    if (tuning.eyeStyle === 'current' || Object.hasOwn(EYE_FOUNDATIONS, tuning.eyeStyle)) style = tuning.eyeStyle;
    if (typeof tuning.eyeMoments === 'boolean') moments = tuning.eyeMoments;
  }, update(dt, { cues = null, enabled = true, weights = {}, listening = 0,
    attention = 0, phraseEvents = [] } = {}) {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (!enabled && wasEnabled) {
      // Capture the visible mix when a manual pose replaces a tagged reply.
      opacity = state.weight; opacityVelocity = 0;
    }
    wasEnabled = enabled;
    const nextReply = cues?.replyId ?? null;
    if (nextReply !== replyId) {
      replyId = nextReply; phrase = null; phraseCount = 0; lastPhrase = -Infinity;
    }
    const expressive = enabled && style !== 'current' && moments && !reduce;
    // The voice's playback position is held across underruns. A gap neither
    // starts a new moment nor advances a handover or the pose springs.
    const gap = cues?.state === 'gap';
    const poseStep = gap ? 0 : step;
    const coverage = smooth(Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight), 0) / 0.65);
    if (!cues && expressive) idleTime += step;
    if (!expressive || coverage > 0) phrase = null;
    if (expressive && cues && !gap && coverage === 0) {
      for (const event of phraseEvents) {
        if (event.replyId !== replyId || event.type !== 'start' || !Number.isFinite(event.position)
            || event.position - lastPhrase < 3.8) continue;
        phrase = { start: event.position, soft: phraseCount++ % 2 === 1 };
        lastPhrase = event.position;
      }
    }
    const target = { ...(EYE_FOUNDATIONS[style] || EYE_FOUNDATIONS.relaxed) };
    state.moment = 'rest'; state.strength = 0;
    if (expressive && cues && phrase) {
      const strength = envelope(cues.position - phrase.start, 0.45, 0.75, 0.85);
      add(target, phrase.soft ? SOFT : OPEN, strength);
      state.moment = strength > 0 ? phrase.soft ? 'soften' : 'engage' : 'rest';
      state.strength = strength;
    } else if (expressive && !cues) {
      // Whole shapes with quiet holds, rather than independent lid oscillation.
      const age = idleTime % 13;
      const soft = envelope(age - 3, 0.8, 1.1, 1.1);
      const open = envelope(age - 8.2, 0.7, 0.8, 1.1);
      const attending = clamp(listening) * clamp(attention);
      add(target, SOFT, soft * (1 - attending * 0.8));
      add(target, OPEN, open * (1 - attending) * 0.65 + attending * 0.8);
      state.moment = attending > 0.2 ? 'attentive' : soft > 0 ? 'soften' : open > 0 ? 'engage' : 'rest';
      state.strength = Math.max(soft, open, attending);
    }
    // Exact critically damped steps also round mode/style changes. Tags gate
    // the display mix directly through their existing eased envelopes, so a
    // strong Curious, Warmly, laugh or sigh keeps its approved eye expression.
    const frequency = 10, decay = Math.exp(-frequency * poseStep);
    for (const key of EYE_ATTITUDE_KEYS) if (poseStep > 0) {
      const offset = pose[key] - target[key], tangent = velocity[key] + frequency * offset;
      pose[key] = target[key] + (offset + tangent * poseStep) * decay;
      velocity[key] = (velocity[key] - frequency * tangent * poseStep) * decay;
    }
    const desired = enabled && style !== 'current' ? 1 : 0;
    if (poseStep > 0) {
      const offset = opacity - desired, tangent = opacityVelocity + frequency * offset;
      opacity = desired + (offset + tangent * poseStep) * decay;
      opacityVelocity = (opacityVelocity - frequency * tangent * poseStep) * decay;
    }
    if (Math.abs(opacity - desired) < 1e-8 && Math.abs(opacityVelocity) < 1e-7) {
      opacity = desired; opacityVelocity = 0;
    }
    state.style = style;
    // Manual poses fade this layer away while their existing pose springs form.
    state.weight = clamp(opacity) * (1 - coverage);
    state.idleTime = idleTime;
    return state;
  } };
}
