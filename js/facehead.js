// Speech-led performance only: no scene, browser, audio, or wall-clock state.
const TAU = Math.PI * 2;
const STEP = 1 / 120;
const HISTORY = 180; // 1.5 seconds, independent of the display frame rate.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createFaceHead(reduce = false, options = {}) {
  const random = options.random ?? Math.random;
  const between = (low, high) => low + random() * (high - low);
  // yaw, resting pitch, roll, nod, gaze x/y, speaking blend, head/roll gains
  const position = new Float64Array(9), velocity = new Float64Array(9);
  position[7] = position[8] = 1;
  const history = new Float64Array(HISTORY);
  let historyIndex = 0, historySum = 0, sampleTime = 0, sampleSum = 0;
  let time = 0, wasSpeaking = false, envelopeSmooth = 0;
  let lastBeat = -10, peak = 0, trough = 0, beatArmed = true;
  let heardSpeech = false, quietTime = 0, phraseEnded = false;
  let nodUntil = 0, nodTarget = 0, speakingRoll = 0;
  let verticalCredit = 0;
  let yawPhase = between(0, TAU), idlePhase = between(0, TAU);
  let yawPeriod = between(3, 6), idlePeriod = between(4, 8);
  let pitchPhase = between(0, TAU), pitchPeriod = between(4, 7);
  let heldYaw = 0, heldPitch = 0, heldRoll = 0;
  let microX = 0, microY = 0, idleX = 0, idleY = 0, nextGaze = 0;
  let glanceUntil = 0, glanceYaw = 0, glanceX = 0, glanceY = 0;
  let lastBlink = -10, blinkCredit = 0, blinkThreshold = between(0.85, 1.15);
  let doubleAt = Infinity, headAmount = 1, rollAmount = 1, nodAmount = 1, blinkRate = 17;
  const motionScale = reduce ? 0.2 : 1;
  const diagnostics = { beats: 0, verticalBeats: 0, phraseNods: 0, glances: 0, blinks: 0 };
  const pose = {
    yaw: 0, pitch: 0, roll: 0, x: 0, y: 0,
    gazeX: 0, gazeY: 0, gazeHold: false, blink: false
  };

  // Exact damped-oscillator integration for a constant target over this step.
  // No Euler instability, frame-dependent lerps, or per-step allocation.
  function spring(index, target, dt, frequency = 15, damping = 0.85) {
    const offset = position[index] - target, speed = velocity[index];
    const decayRate = frequency * damping;
    const oscillation = frequency * Math.sqrt(1 - damping * damping);
    const decay = Math.exp(-decayRate * dt);
    const cosine = Math.cos(oscillation * dt), sine = Math.sin(oscillation * dt);
    let next = target + decay * (offset * cosine + (speed + decayRate * offset) / oscillation * sine);
    let nextSpeed = decay * (speed * cosine - (decayRate * speed + frequency * frequency * offset) / oscillation * sine);
    if (index === 2) {
      // Limit the rendered angle itself, including tuning and mode changes.
      const speedLimit = 6 * motionScale, angleLimit = 1.5 * motionScale;
      next = clamp(next, position[index] - speedLimit * dt, position[index] + speedLimit * dt);
      next = clamp(next, -angleLimit, angleLimit);
      nextSpeed = clamp(nextSpeed, -speedLimit, speedLimit);
      if (Math.abs(next) === angleLimit && next * nextSpeed > 0) nextSpeed = 0;
    }
    position[index] = next;
    velocity[index] = nextSpeed;
  }

  function startNod(amplitude, phrase) {
    // This 150 ms target pulse peaks at ~157 ms; the spring returns over 0.4 s.
    nodTarget = amplitude / 0.885;
    nodUntil = time + 0.15;
    if (phrase) diagnostics.phraseNods++;
    else diagnostics.beats++;
  }

  function startBlink(paired) {
    pose.blink = true;
    diagnostics.blinks++;
    lastBlink = time;
    blinkCredit -= 1;
    blinkThreshold = between(0.85, 1.15);
    // The requested 1.2 s minimum also applies to the occasional paired blink.
    doubleAt = !paired && random() < 0.05 ? time + between(1.2, 1.45) : Infinity;
  }

  function update(dt, { speaking = false, envelope = 0 } = {}) {
    pose.blink = false;
    if (!Number.isFinite(dt) || dt <= 0) return pose;
    envelope = Number.isFinite(envelope) ? clamp(envelope, 0, 1) : 0;
    if (speaking && !wasSpeaking) {
      heardSpeech = false;
      phraseEnded = false;
      quietTime = 0;
      beatArmed = true;
      peak = trough = envelopeSmooth;
      nextGaze = time;
      if (random() < 0.4) {
        const side = random() < 0.5 ? -1 : 1;
        glanceUntil = time + between(0.5, 1);
        glanceYaw = side * between(8, 10);
        glanceX = side * between(0.45, 0.55);
        glanceY = between(0.2, 0.4);
        diagnostics.glances++;
      }
    } else if (!speaking && wasSpeaking) {
      glanceUntil = 0;
      nextGaze = time;
    }
    wasSpeaking = speaking;

    let remaining = dt;
    while (remaining > 1e-9) {
      const step = Math.min(STEP, remaining);
      remaining -= step;
      time += step;
      spring(6, speaking ? 1 : 0, step, 17, 0.99);
      spring(7, headAmount, step, 17, 0.99);
      spring(8, rollAmount, step, 17, 0.99);
      const blend = clamp(position[6], 0, 1);
      const gain = Math.max(0, position[7]) * motionScale;
      const previousEnvelope = envelopeSmooth;
      envelopeSmooth += (envelope - envelopeSmooth) * (1 - Math.exp(-step / 0.025));
      const rise = (envelopeSmooth - previousEnvelope) / step;
      const average = historySum / HISTORY;
      let sampleRemaining = step;
      while (sampleRemaining > 1e-9) {
        const duration = Math.min(sampleRemaining, STEP - sampleTime);
        sampleTime += duration;
        sampleSum += envelopeSmooth * duration;
        sampleRemaining -= duration;
        if (sampleTime >= STEP - 1e-9) {
          const value = sampleSum / STEP;
          historySum += value - history[historyIndex];
          history[historyIndex] = value;
          historyIndex = (historyIndex + 1) % HISTORY;
          sampleTime = sampleSum = 0;
        }
      }

      let blinkOpportunity = false;
      if (speaking && envelope > 0.065) {
        heardSpeech = true;
        quietTime = 0;
        phraseEnded = false;
      } else if (heardSpeech && envelope < 0.04) {
        quietTime += step;
        if (quietTime > 0.25 && !phraseEnded) {
          phraseEnded = true;
          heldYaw = position[0] / Math.max(gain, 0.0001);
          heldPitch = position[1] / Math.max(gain, 0.0001);
          heldRoll = speakingRoll;
          startNod(between(2, 3), true);
          blinkOpportunity = true;
        }
      } else quietTime = 0;

      peak = Math.max(peak, envelopeSmooth);
      if (rise < 0) trough = envelopeSmooth;
      if (envelopeSmooth < average + 0.015 || peak - envelopeSmooth > 0.12) beatArmed = true;
      if (speaking && !phraseEnded && beatArmed && time - lastBeat >= 0.9
          && rise > 0.6 && envelopeSmooth - trough > 0.075
          && envelopeSmooth > Math.max(0.18, average + 0.11, average * 1.2)) {
        const strength = clamp((envelopeSmooth - average - 0.09) / 0.45, 0, 1);
        // Random ordering with bounded credit keeps the longer-run mix near 45%
        // without long streaks of one direction or a repeating gesture pattern.
        verticalCredit += 0.45;
        const vertical = random() < verticalCredit;
        if (vertical) verticalCredit -= 1;
        if (vertical) {
          // Keep the settled roll so this beat reads as a chin dip or lift.
          // A fresh roll target here would turn the vertical gesture into a tilt.
          startNod((random() < 0.5 ? -1 : 1) * (1.5 + strength), false);
          diagnostics.verticalBeats++;
        } else {
          startNod(1 + 1.5 * strength, false);
          const side = speakingRoll === 0 ? (random() < 0.5 ? -1 : 1) : -Math.sign(speakingRoll);
          speakingRoll = side * between(0.425, 1);
        }
        lastBeat = time;
        beatArmed = false;
        peak = trough = envelopeSmooth;
      }

      if (!(speaking && phraseEnded)) yawPhase += TAU * step / (yawPeriod * blend + idlePeriod * (1 - blend));
      if (!(speaking && phraseEnded)) pitchPhase += TAU * step / pitchPeriod;
      idlePhase += TAU * step / idlePeriod;
      if (yawPhase >= TAU) { yawPhase -= TAU; yawPeriod = between(3, 6); }
      if (pitchPhase >= TAU) { pitchPhase -= TAU; pitchPeriod = between(4, 7); }
      if (idlePhase >= TAU) { idlePhase -= TAU; idlePeriod = between(4, 8); }

      if (time >= nextGaze) {
        if (speaking) {
          microX = between(-0.05, 0.05);
          microY = between(-0.05, 0.05);
          nextGaze = time + between(0.6, 1.5);
        } else {
          idleX = between(-0.3, 0.3);
          idleY = between(-0.3, 0.3);
          nextGaze = time + between(2, 5);
        }
        blinkOpportunity = true;
      }
      const glancing = speaking && time < glanceUntil;
      const driftingYaw = Math.sin(yawPhase) * (3 + 2 * blend);
      const yawTarget = glancing ? glanceYaw : speaking && phraseEnded ? heldYaw : driftingYaw;
      const pitchTarget = speaking && phraseEnded ? heldPitch : Math.sin(pitchPhase) * 1.2;
      const rollTarget = (speaking && phraseEnded ? heldRoll : speakingRoll) * blend
        + Math.sin(idlePhase) * 0.4 * (1 - blend);
      spring(0, yawTarget * gain, step);
      spring(1, (Math.sin(idlePhase + 1.1) * 0.8 * (1 - blend) + pitchTarget * blend) * gain, step);
      spring(2, clamp(rollTarget * gain * Math.max(0, position[8]), -1.45 * motionScale, 1.45 * motionScale), step, 12);
      spring(3, time < nodUntil ? nodTarget * gain * nodAmount : 0, step, 20);
      spring(4, glancing ? glanceX : idleX * (1 - blend) + microX * blend, step, 17);
      spring(5, glancing ? glanceY : idleY * (1 - blend) + microY * blend, step, 17);

      blinkCredit += blinkRate / 60 * ((13.5 / 17) + (1 - 13.5 / 17) * blend) * step;
      if (blinkRate > 0 && time - lastBlink >= 1.2
          && (time >= doubleAt || blinkCredit >= blinkThreshold
            || (blinkOpportunity && blinkCredit >= blinkThreshold - 0.3))) startBlink(time >= doubleAt);
      pose.gazeHold = speaking && !glancing;
    }
    pose.yaw = position[0];
    pose.pitch = position[1] + position[3];
    pose.roll = position[2];
    pose.x = position[0] * 0.006;
    pose.y = -position[3] * 0.003;
    pose.gazeX = position[4];
    pose.gazeY = position[5];
    return pose;
  }

  function applyTuning(tuning) {
    if (Number.isFinite(tuning.headAmount)) headAmount = clamp(tuning.headAmount, 0, 2);
    if (Number.isFinite(tuning.rollAmount)) rollAmount = clamp(tuning.rollAmount, 0, 2);
    if (Number.isFinite(tuning.nodAmount)) nodAmount = clamp(tuning.nodAmount, 0, 2);
    if (Number.isFinite(tuning.blinkRate)) blinkRate = clamp(tuning.blinkRate, 0, 50);
  }

  return { update, applyTuning, diagnostics };
}
