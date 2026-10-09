// Pose values are additional contributions. The photographed neutral keeps its
// existing 0.05 smile and eye openness of 1; neither is baked into the sliders.
export const POSE_CONTROLS = [
  ['upperLid', 'Upper lid', -1, 1, 0.01],
  ['lowerLid', 'Lower lid', 0, 1, 0.01],
  ['slant', 'Eye slant', -1, 1, 0.01],
  ['eyeAsym', 'Eye asymmetry', -1, 1, 0.01],
  ['browL', 'Left brow', -1, 1, 0.01],
  ['browR', 'Right brow', -1, 1, 0.01],
  ['tilt', 'Asymmetric brow tilt', -1, 1, 0.01],
  ['browKnit', 'Brow knit (horizontal)', -1, 1, 0.01],
  ['browAngle', 'Brow angle (vertical)', -1, 1, 0.01],
  ['smile', 'Smile', -1, 1, 0.01],
  ['mouthOpen', 'Mouth opening', 0, 1, 0.01],
  ['mouthRound', 'Mouth rounding', 0, 1, 0.01],
  ['mouthPress', 'Lip pressure', 0, 1, 0.01],
  ['squashStretch', 'Squash / stretch', -1, 1, 0.01],
  ['headYaw', 'Head yaw (degrees)', -10, 10, 0.1],
  ['headPitch', 'Head pitch (degrees)', -6, 6, 0.1],
  ['headRoll', 'Head roll (degrees)', -1.5, 1.5, 0.1],
  ['gazeX', 'Gaze horizontal', -1, 1, 0.01],
  ['gazeY', 'Gaze vertical', -1, 1, 0.01]
];
export const POSE_KEYS = POSE_CONTROLS.map(([key]) => key);
export const EYE_SHAPE_KEYS = ['upperLid', 'lowerLid', 'slant', 'browKnit', 'browAngle', 'eyeAsym'];
export const NEUTRAL_POSE = Object.freeze(Object.fromEntries(POSE_KEYS.map(key => [key, 0])));
const completePose = values => ({ ...NEUTRAL_POSE, ...values });
export const EXPR = {
  content: completePose({ upperLid: 0.45, lowerLid: 0.25, smile: 0.45, browAngle: -0.1,
    squashStretch: -0.3, headRoll: 1, headPitch: -1 }),
  delighted: completePose({ upperLid: -0.6, lowerLid: 0.2, browL: 0.6, browR: 0.6,
    smile: 0.85, mouthOpen: 0.25, squashStretch: 0.2, headPitch: 2 }),
  laugh: completePose({ upperLid: 0.6, lowerLid: 1, browL: 0.2, browR: 0.2,
    smile: 1, mouthOpen: 0.5, squashStretch: -1, headPitch: 4 }),
  cheeky: completePose({ upperLid: 0.35, lowerLid: 0.2, smile: 0.4, tilt: 0.3,
    gazeX: 0.6, headRoll: -1.5 }),
  skeptical: completePose({ browL: -0.5, browR: 0.4, upperLid: 0.3, eyeAsym: 0.3,
    smile: -0.1, gazeX: -0.5, headRoll: 1.5, headPitch: -1 }),
  thinking: completePose({ browKnit: 0.8, browAngle: 0, browL: -0.35, browR: -0.35,
    upperLid: 0.4, lowerLid: 0.35, mouthPress: 0.5, smile: -0.05, gazeY: -0.15, headPitch: -2 }),
  focused: completePose({ browKnit: 0.85, browL: -0.4, browR: -0.4,
    upperLid: 0.3, lowerLid: 0.3, headPitch: -0.8 }),
  confident: completePose({ upperLid: 0.18, lowerLid: 0.15, browL: -0.06, browR: -0.06,
    smile: 0.18, headPitch: 0.6 }),
  warm: completePose({ upperLid: 0.2, lowerLid: 0.22, browL: 0.08, browR: 0.08,
    browAngle: -0.12, smile: 0.24, headRoll: 0.5, headPitch: -0.5 }),
  sigh: completePose({ upperLid: 0.4, lowerLid: 0.12, browL: -0.1, browR: -0.1,
    browAngle: 0.08, smile: 0.08, headPitch: -0.35 }),
  surprised: completePose({ upperLid: -1, browL: 0.8, browR: 0.8, browAngle: -0.2,
    mouthOpen: 0.35, mouthRound: 0.6, squashStretch: 0.85, headPitch: 2 }),
  concern: completePose({ browAngle: -0.7, browKnit: 0.2, browL: 0.15, browR: 0.15,
    upperLid: 0.3, lowerLid: 0.1, smile: -0.1, headRoll: 1.5, headPitch: -1 })
};

function lerp(a, b, k) {
  return a + (b - a) * k;
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Playback-time envelopes are evaluated afresh when alignment changes. Only
// retirement belongs to an occurrence: corrected timestamps cannot replay it.
export function createCueExpressions() {
  let cueMap = {}, timing = {}, laughAmount = 1, moodAmount = 1;
  let replyId = null, lastPosition = 0, lastCues = [], release = null, bridge = null;
  const retired = new Set();
  const knownEnds = new Map();
  const moodHistory = new Map();
  const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };
  const seconds = (key, fallback) => Number.isFinite(timing[key]) ? Math.max(0, timing[key]) : fallback;
  const phase = (age, duration) => duration > 0 ? smooth(age / duration) : Number(age >= 0);
  const blank = () => ({ weights: {}, gazeWeights: {}, questionPitch: 0, microSuppression: 0 });
  const mix = (a, b, weight) => {
    const result = blank();
    for (const field of ['weights', 'gazeWeights']) {
      for (const name of Object.keys(EXPR)) {
        const value = (a[field][name] || 0) * (1 - weight) + (b[field][name] || 0) * weight;
        if (value) result[field][name] = value;
      }
    }
    result.questionPitch = a.questionPitch * (1 - weight) + b.questionPitch * weight;
    result.microSuppression = a.microSuppression * (1 - weight) + b.microSuppression * weight;
    return result;
  };
  let output = blank(), channels = { mood: blank(), event: blank(), question: blank() };
  let moodRemaining = 0, eventRemaining = 0, questionRemaining = 0;
  let blockingEvent = false;
  let gestureWindows = [];
  const mapCue = cue => cue.type === 'question' ? null : cueMap[cue.name];
  const valid = mapping => mapping && Object.hasOwn(EXPR, mapping.pose) && Number.isFinite(mapping.amount);

  function sample(position, cues) {
    blockingEvent = false;
    gestureWindows = [];
    const mood = blank(), event = blank(), question = blank();
    const attack = seconds('moodAttack', 0.5), hold = seconds('moodHold', 2);
    const recovery = seconds('moodRelease', 1);
    cues.forEach((cue, index) => {
      const mapping = mapCue(cue);
      if (!valid(mapping) || mapping.kind !== 'mood' || !Number.isFinite(cue.start)) return;
      const id = cue.id ?? `${cue.type || 'tag'}:${index}`;
      const previous = moodHistory.get(id);
      // Retire against the last known end before accepting a correction.
      // Keep its old timing as history: a later overlapping beat may still
      // be blending from the value it had when that later beat began.
      if (previous && position >= previous.until) retired.add(id);
      if (retired.has(id) || (cue.start > position && !previous)) return;
      moodHistory.set(id, { id, start: cue.start, attack, hold, recovery,
        until: cue.start + attack + hold + recovery,
        pose: mapping.pose, amount: Math.max(0, mapping.amount) * moodAmount });
    });
    const moods = [...moodHistory.values()].sort((a, b) => a.start - b.start);
    let source = blank(), destination = blank(), activeMood = null;
    const moodAt = at => {
      if (!activeMood) return blank();
      const age = at - activeMood.start;
      const formed = mix(source, destination, phase(age, activeMood.attack));
      return mix(formed, blank(), phase(age - activeMood.attack - activeMood.hold, activeMood.recovery));
    };
    for (const cue of moods) {
      if (cue.start > position) break;
      // New tags start from the already-decaying pose, never its old peak.
      source = moodAt(cue.start);
      destination = blank();
      destination.weights[cue.pose] = cue.amount;
      activeMood = cue;
      if (position >= cue.until) retired.add(cue.id);
    }
    Object.assign(mood.weights, moodAt(position).weights);
    moodRemaining = activeMood ? Math.min(activeMood.recovery, Math.max(0, activeMood.until - position)) : 0;
    // Moods dim the micro layer only while their finite beat is visible.
    // Laughs, chuckles and sighs still suppress it fully.
    const moodMicro = Number.isFinite(timing.moodMicroSuppression) ? clamp(timing.moodMicroSuppression, 0, 1) : 1;
    mood.microSuppression = clamp(Object.values(mood.weights).reduce((sum, weight) => sum + weight, 0) * moodMicro, 0, 1);
    // Only thinking may steer the eyes, and only during its first brief glance.
    for (const cue of moods) {
      const age = position - cue.start;
      const duration = seconds('thinkingGaze', 0.8);
      const recovery = Math.min(duration, seconds('thinkingGazeRelease', 0.3));
      if (cue.pose === 'thinking' && age >= 0 && age < duration) {
        mood.gazeWeights.thinking = (mood.weights.thinking || 0)
          * (1 - phase(age - (duration - recovery), recovery));
      }
    }
    let winner = null, strongest = -1;
    let questionWeight = 0;
    eventRemaining = questionRemaining = 0;
    for (let index = 0; index < cues.length; index++) {
      const cue = cues[index], mapping = mapCue(cue);
      const isQuestion = cue.type === 'question';
      if (!isQuestion && (!valid(mapping) || mapping.kind === 'mood')) continue;
      const id = cue.id ?? `${cue.type || 'tag'}:${index}`;
      // A correction can arrive on the first frame beyond the previous end.
      // Retire against that known end before accepting the revised timestamps.
      if (knownEnds.has(id) && position >= knownEnds.get(id)) retired.add(id);
      if (retired.has(id)) continue;
      let end = cue.end, attack, recovery;
      if (isQuestion) {
        recovery = seconds('questionRelease', 0.3);
        // The parser's end includes the question tail; ease out inside it.
        end = Math.max(cue.start, cue.end - recovery);
        attack = seconds('questionAttack', 0.15);
      } else {
        attack = seconds('eventAttack', 0.15);
        recovery = mapping.kind === 'sigh' ? seconds('sighRelease', 0.8) : seconds('eventRelease', 0.5);
        if (mapping.kind !== 'sigh') end = Math.max(end, cue.start + seconds('laughMinimum', 0.6));
        if (mapping.kind === 'laugh' && Number.isFinite(cue.nextWordStart)
            && cue.nextWordStart >= cue.end - 1e-6
            && cue.nextWordStart - cue.end <= seconds('followingWordGap', 0.3)) {
          end += seconds('laughExtension', 1);
        }
      }
      knownEnds.set(id, end + recovery);
      if (position >= end + recovery) { retired.add(id); continue; }
      if (!isQuestion && ['laugh', 'chuckle', 'sigh'].includes(mapping.kind)) {
        gestureWindows.push({ id, kind: mapping.kind, start: cue.start, end: end + recovery });
      }
      if (position < cue.start) continue;
      if (!isQuestion && ['laugh', 'chuckle', 'sigh'].includes(mapping.kind)) blockingEvent = true;
      const weight = phase(position - cue.start, attack) * (1 - phase(position - end, recovery));
      if (!isQuestion && ['laugh', 'chuckle', 'sigh'].includes(mapping.kind)) {
        event.microSuppression = Math.max(event.microSuppression, weight);
      }
      if (isQuestion) {
        if (weight >= questionWeight) {
          questionWeight = weight;
          questionRemaining = Math.min(recovery, end + recovery - position);
        }
      } else {
        const strength = weight * Math.max(0, mapping.amount);
        if (strength > strongest) {
          strongest = strength;
          winner = { mapping, weight };
          eventRemaining = Math.min(recovery, end + recovery - position);
        }
      }
    }
    if (winner) {
      const { mapping, weight } = winner;
      event.weights[mapping.pose] = Math.max(0, mapping.amount) * laughAmount * weight;
      event.gazeWeights[mapping.pose] = event.weights[mapping.pose];
      const suppression = clamp(1 - weight, 0, 1);
      for (const name of Object.keys(mood.weights)) mood.weights[name] *= suppression;
      for (const name of Object.keys(mood.gazeWeights)) mood.gazeWeights[name] *= suppression;
    }
    question.questionPitch = questionWeight * seconds('questionPitch', 1.5);
    channels = { mood, event, question };
    return combine(channels);
  }

  function combine(parts) {
    const result = blank();
    for (const part of Object.values(parts)) {
      for (const field of ['weights', 'gazeWeights']) for (const [name, value] of Object.entries(part[field])) {
        result[field][name] = (result[field][name] || 0) + value;
      }
      result.questionPitch += part.questionPitch;
      result.microSuppression = 1 - (1 - result.microSuppression) * (1 - part.microSuppression);
    }
    return result;
  }

  function beginRelease(end) {
    // Never evaluate unseen future cues at the end. Freeze the contributions
    // currently on screen and finish their releases on the animation clock.
    const interrupted = end?.reason === 'interrupted';
    const interrupt = seconds('interruptRelease', 0.4);
    // Replies with no started mood retain their original neutral-settling
    // delay. A bridge from an earlier reply does not change that classification.
    const moodDuration = moodHistory.size ? moodRemaining : seconds('moodRelease', 1);
    release = { age: 0, parts: channels, durations: {
      mood: interrupted ? interrupt : moodDuration,
      event: interrupted ? interrupt : eventRemaining,
      question: interrupted ? interrupt : questionRemaining
    } };
    bridge = null;
  }

  function update(dt, cues, ended) {
    blockingEvent = false;
    gestureWindows = [];
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (cues && cues.replyId !== replyId) {
      // The outgoing state participates directly in the new reply's attack;
      // neither the targets nor their spring velocities pass through a reset.
      bridge = Object.values(output.weights).some(Boolean) || output.questionPitch
        ? { parts: channels, age: 0, moodRemaining, eventRemaining, questionRemaining } : null;
      release = null;
      retired.clear();
      knownEnds.clear();
      moodHistory.clear();
      replyId = cues.replyId;
    } else if (!cues && replyId !== null) {
      beginRelease(ended?.replyId === replyId ? ended : null);
      replyId = null;
    }
    if (cues) {
      lastPosition = cues.position;
      lastCues = cues.cues;
      output = sample(lastPosition, lastCues);
      if (bridge) {
        if (cues.state !== 'gap') bridge.age += step;
        const blend = phase(bridge.age, seconds('replyBlend', 0.4));
        for (const name of Object.keys(channels)) channels[name] = mix(bridge.parts[name], channels[name], blend);
        output = combine(channels);
        // Preserve each channel's own recovery if even a very short new reply
        // ends during the handover; questions never inherit the mood release.
        if (blend < 1) {
          moodRemaining = Math.max(moodRemaining, bridge.moodRemaining);
          eventRemaining = Math.max(eventRemaining, bridge.eventRemaining);
          questionRemaining = Math.max(questionRemaining, bridge.questionRemaining);
        }
        if (blend === 1) bridge = null;
      }
    } else if (release) {
      release.age += step;
      const parts = {};
      let done = true;
      for (const [name, part] of Object.entries(release.parts)) {
        const blend = phase(release.age, release.durations[name]);
        parts[name] = mix(part, blank(), blend);
        if (blend < 1) done = false;
      }
      channels = parts;
      moodRemaining = Math.max(0, release.durations.mood - release.age);
      eventRemaining = Math.max(0, release.durations.event - release.age);
      questionRemaining = Math.max(0, release.durations.question - release.age);
      output = combine(channels);
      if (done) release = null;
    } else output = blank();
    return output;
  }

  return { update, applyTuning(tuning) {
    if (tuning.cueMap) cueMap = tuning.cueMap;
    if (tuning.cueTiming) timing = tuning.cueTiming;
    if (Number.isFinite(tuning.laughAmount)) laughAmount = clamp(tuning.laughAmount, 0, 2);
    if (Number.isFinite(tuning.moodAmount)) moodAmount = clamp(tuning.moodAmount, 0, 2);
  }, reset() {
    replyId = null; lastPosition = 0; lastCues = []; release = bridge = null;
    retired.clear(); knownEnds.clear(); moodHistory.clear(); output = blank();
    moodRemaining = 0;
    channels = { mood: blank(), event: blank(), question: blank() };
  },
  // Runtime reads avoid building the full diagnostic snapshot on every frame.
  get releasing() { return Boolean(release); },
  get blockingEvent() { return blockingEvent; },
  get gestureWindows() { return gestureWindows; },
  get state() { return { replyId, position: lastPosition, output, retired: [...retired], releasing: Boolean(release), blockingEvent, gestureWindows }; } };
}

// This stream belongs only to flashes. Text is hashed at the playback boundary;
// neither the text nor draws from any existing motion generator are retained.
export function createBrowFlashes() {
  let settings = {}, amount = 1, seed = null, randomState = 0, drew = false;
  let replyId = null, time = 0, lastFlash = -Infinity, lastBeatTime = -Infinity, age = Infinity;
  const state = { target: 0, active: false, decisions: [], contribution: { browL: 0, browR: 0, upperLid: 0 } };
  const velocity = { browL: 0, browR: 0, upperLid: 0 };
  const value = (key, fallback) => Number.isFinite(settings[key]) ? Math.max(0, settings[key]) : fallback;
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const random = () => {
    randomState = (randomState + 0x6d2b79f5) | 0;
    let n = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  return { state,
    setReplyText(text) {
      if (typeof text !== 'string') { seed = null; return; }
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
      seed = hash >>> 0;
      // Live text can arrive after audio. Until it does, no choice is made.
      if (!drew) randomState = seed;
    },
    applyTuning(tuning) {
      if (tuning.browFlash) settings = tuning.browFlash;
      if (Number.isFinite(tuning.browFlashAmount)) amount = clamp(tuning.browFlashAmount, 0, 2);
    },
    update(dt, cues, blocked, enabled, beats) {
      time += dt;
      state.decisions = [];
      if ((cues?.replyId ?? null) !== replyId) {
        replyId = cues?.replyId ?? null;
        randomState = seed ?? 0;
        drew = false;
        age = Infinity;
      }
      if (!enabled || !cues || blocked || amount === 0) age = Infinity;
      for (const beat of beats) {
        if (beat.strength <= value('threshold', 0.22)) continue;
        let reason = !enabled || amount === 0 ? 'disabled' : !cues || beat.replyId !== replyId ? 'reply-ended'
          : blocked ? 'event-window' : beat.position < 0.3 ? 'reply-start'
          : seed === null ? 'awaiting-text'
          : Math.min(time - lastFlash, beat.time - lastBeatTime) < value('minInterval', 2) ? 'spacing' : '';
        if (!reason) { drew = true; if (random() >= clamp(value('chance', 0.5), 0, 1)) reason = 'chance'; }
        if (!reason) { age = 0; lastFlash = time; lastBeatTime = beat.time; }
        state.decisions.push({ beatTime: beat.position, strength: beat.strength, selected: !reason, reason });
      }
      const attack = value('attack', 0.035), hold = value('hold', 0.105), release = value('release', 0.3);
      const phase = (x, duration) => duration ? smooth(x / duration) : Number(x >= 0);
      const weight = Number.isFinite(age) ? phase(age, attack) * (1 - phase(age - attack - hold, release)) : 0;
      state.target = weight * amount;
      // A separate, fast critically damped response bypasses the pose springs.
      // Cancellation still releases from the current value and velocity.
      const frequency = value('response', 70), decay = Math.exp(-frequency * dt);
      for (const [key, fallback] of [['browL', 0.45], ['browR', 0.45], ['upperLid', -0.15]]) {
        const gain = settings.amount?.[key];
        const target = state.target * (Number.isFinite(gain) ? gain : fallback);
        const offset = state.contribution[key] - target, tangent = velocity[key] + frequency * offset;
        state.contribution[key] = target + (offset + tangent * dt) * decay;
        velocity[key] = (velocity[key] - frequency * tangent * dt) * decay;
        if (Math.abs(state.contribution[key] - target) < 1e-8 && Math.abs(velocity[key]) < 1e-7) {
          state.contribution[key] = target; velocity[key] = 0;
        }
      }
      state.active = age < attack + hold + release;
      age += dt;
      return state.contribution;
    }
  };
}

// This generator is local to micro expressions: neither sampling nor changing
// replies consumes the head, blink, flash, or particle random streams.
export function createMicroExpressions() {
  const keys = ['smile', 'upperLid', 'lowerLid', 'browL', 'browR'];
  const blank = () => Object.fromEntries(keys.map(key => [key, 0]));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  let settings = {}, amount = 1, pendingSeed = null, seed = null, replyId = null;
  let speechWaves = null, animationTime = 0, position = 0, modeKey = 'off';
  let transition = null, phrase = null, phraseActive = false;
  const unattenuated = blank();
  const state = { contribution: blank(), drift: blank(), phrase: 0, phraseEvents: [],
    suppression: 0, mode: 'off', seed: null, position: 0 };
  const value = (key, fallback) => Number.isFinite(settings[key]) ? Math.max(0, settings[key]) : fallback;
  const phase = (age, duration) => duration ? smooth(age / duration) : Number(age >= 0);

  function waves(seed) {
    let randomState = (seed ^ 0x9e3779b9) >>> 0;
    const random = () => {
      randomState = (randomState + 0x6d2b79f5) | 0;
      let n = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
      n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    };
    return Array.from({ length: 7 }, () => Array.from({ length: 3 }, () =>
      ({ period: random(), phase: random() * Math.PI * 2 })));
  }
  const listeningWaves = waves(0x51e71a9);
  function sample(bank, time) {
    if (!bank) return blank();
    const wave = (index, range) => {
      const low = Math.max(0.1, Number.isFinite(range?.[0]) ? range[0] : 2);
      const high = Math.max(low, Number.isFinite(range?.[1]) ? range[1] : 6);
      return bank[index].reduce((sum, component) => sum + Math.sin(component.phase
        + time * Math.PI * 2 / lerp(low, high, component.period)), 0) / 3;
    };
    const quiet = 0.12 + 0.88 * smooth((wave(6, settings.periods?.quiet || [7, 13]) + 1) / 2) ** 2;
    const signal = index => wave(index, settings.periods?.drift || [2, 6]);
    // Equal-variance common/independent signals give correlation ~0.7.
    const common = Math.sqrt(0.7) * signal(3), independent = Math.sqrt(0.3);
    const normalizer = Math.sqrt(0.7) + independent;
    const raw = { smile: signal(0), upperLid: signal(1), lowerLid: (signal(2) + 1) / 2,
      browL: (common + independent * signal(4)) / normalizer,
      browR: (common + independent * signal(5)) / normalizer };
    for (const key of keys) raw[key] *= quiet * (Number.isFinite(settings.amplitudes?.[key])
      ? settings.amplitudes[key] : key === 'lowerLid' ? 0.1 : 0.08);
    // Shape neutral lid drift independently in each direction, before phrase lift.
    raw.upperLid *= value(raw.upperLid >= 0 ? 'squintGain' : 'wideGain', 1);
    return raw;
  }
  function phraseAt(time) {
    return phrase ? lerp(phrase.source, phrase.target, phase(time - phrase.start,
      value(phrase.target ? 'phraseAttack' : 'phraseRelease', phrase.target ? 0.3 : 0.45))) : 0;
  }

  return { state,
    setReplyText(text) {
      pendingSeed = null;
      if (typeof text !== 'string') return;
      let hash = 2166136261;
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
      pendingSeed = hash >>> 0;
    },
    applyTuning(tuning) {
      if (tuning.micro) settings = tuning.micro;
      if (Number.isFinite(tuning.microAmount)) amount = clamp(tuning.microAmount, 0, 2);
    },
    update(dt, cues, suppression, enabled, listeningWeight, events) {
      animationTime += dt;
      const nextReply = cues?.replyId ?? null;
      const newReply = nextReply !== replyId;
      if (newReply) {
        replyId = nextReply; seed = null; speechWaves = null;
        position = cues?.position ?? 0;
        phrase = null; phraseActive = false;
      }
      // Late text starts a smooth handover once, and later text corrections
      // cannot re-seed a reply that is already moving.
      if (cues && seed === null && pendingSeed !== null) {
        seed = pendingSeed; speechWaves = waves(seed);
      }
      // Voice already holds this clock at the last played sample in a gap.
      // Accept its exact end position even on the first underrun frame.
      const speechStep = cues ? Math.max(0, cues.position - position) : 0;
      position = cues?.position ?? 0;
      state.phraseEvents = events.filter(event => cues && event.replyId === replyId && cues.state !== 'gap');
      for (const event of state.phraseEvents) {
        const active = event.type === 'start';
        if (active === phraseActive) continue;
        phrase = { source: phraseAt(event.position), target: active ? 1 : 0, start: event.position };
        phraseActive = active;
      }
      const mode = !enabled || amount === 0 ? 'off' : cues ? 'speech' : listeningWeight > 0 ? 'listening' : 'off';
      const attenuation = 1 - clamp(suppression, 0, 1);
      const nextKey = mode === 'speech' ? `${replyId}:${seed}` : mode;
      if (nextKey !== modeKey) {
        // Cue envelopes gate both sides of an active handover. Off releases
        // freeze the visible layer so a recovering cue cannot reveal it again.
        const source = mode !== 'off' && state.mode !== 'off' ? unattenuated : state.contribution;
        transition = { source: { ...source }, age: 0,
          duration: value(mode === 'off' ? 'release' : 'blend', 0.4) };
        modeKey = nextKey;
      }
      state.mode = mode; state.seed = seed; state.position = position;
      state.suppression = clamp(suppression, 0, 1);
      state.phrase = cues ? phraseAt(position) : 0;
      state.drift = mode === 'speech' ? sample(speechWaves, position)
        : mode === 'listening' ? sample(listeningWaves, animationTime * value('listeningSpeed', 0.5)) : blank();
      const target = blank();
      const gain = amount
        * (mode === 'listening' ? value('listeningScale', 1 / 3) * listeningWeight : 1);
      for (const key of keys) if (mode !== 'off') {
        const lift = settings.phraseLift?.[key] ?? ({ browL: 0.1, browR: 0.1, upperLid: -0.05, smile: 0.05 }[key] || 0);
        target[key] = (state.drift[key] + (mode === 'speech' && speechWaves ? state.phrase * lift : 0)) * gain;
      }
      if (transition) {
        transition.age += mode === 'speech' ? speechStep : dt;
        const blend = phase(transition.age, transition.duration);
        for (const key of keys) {
          const mixed = lerp(transition.source[key], target[key], blend);
          unattenuated[key] = mode === 'off' ? 0 : mixed;
          state.contribution[key] = mode === 'off' ? mixed : mixed * attenuation;
        }
        if (blend === 1) transition = null;
      } else for (const key of keys) {
        unattenuated[key] = target[key];
        state.contribution[key] = target[key] * attenuation;
      }
      return state.contribution;
    }
  };
}
