import { createMappedFace } from './facewarp.js';
import { createFaceMotion } from './facemotion.js';
import { createFaceHead } from './facehead.js';
import { createFaceForm } from './face-form.js';
import { createEyeAttitudes, EYE_ATTITUDE_KEYS } from './face-eyes.js';
import { createSpeechFlow } from './speech-flow.js';
import { SIGH_GESTURE, sampleSighGesture } from './face-sigh.js';

import { POSE_CONTROLS, NEUTRAL_POSE, EXPR,
  createCueExpressions, createBrowFlashes, createMicroExpressions, createMoodPerformance } from './face-expressions.js';
// Keep the existing face-module exports available to previews and QA tools.
export { POSE_CONTROLS, POSE_KEYS, EYE_SHAPE_KEYS, NEUTRAL_POSE, EXPR,
  createCueExpressions, createBrowFlashes, createMicroExpressions } from './face-expressions.js';

function lerp(a, b, k) {
  return a + (b - a) * k;
}
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function createFace(shapes, reduce) {
  const cur = { ...NEUTRAL_POSE };
  const velocity = { ...NEUTRAL_POSE };
  const rendered = { ...NEUTRAL_POSE, smile: 0.05, eye: 1 };
  const eyePoses = Object.fromEntries(Object.entries(EXPR).map(([name, pose]) => [name, { ...pose }]));
  let selectedPose = 'content', poseIntensity = 0;
  let autoExpressions = true, preview = false, activeReply = null;
  let selectionListener = null, selectionKey = '';
  const automatic = createCueExpressions();
  const flashes = createBrowFlashes();
  const micro = createMicroExpressions();
  const eyes = createEyeAttitudes(reduce);
  const performance = createMoodPerformance(reduce);
  let beats = [], phraseEvents = [], headTime = 0;
  let listeningSettings = {}, replyBlend = 0.4;
  let listeningWeight = 0, listeningTransition = null, listeningBridge = null;
  const listeningState = { weight: 0, phase: 'off', eligible: false };
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const gaze = { x: 0, y: 0 };
  const mouthShape = { w: 1, h: 1, round: 0, close: 0, cup: 0, square: 0, tuck: 0, oval: 0 };
  const mouthInput = { envelope: 0, shape: mouthShape, smile: 0.05, speaking: false };
  let mouthBiasPhase = 1;
  let blinkAge = Infinity, blinkV = 1;
  const mappedFace = createMappedFace(shapes, reduce);
  const motion = createFaceMotion(shapes, reduce);
  const head = createFaceHead(reduce);
  const follow = createHeadFollow(shapes, motion.phase, reduce);
  const diagnostics = { expression: cur, rendered, mouth: mouthInput, gaze,
    pose: null, selectedPose, poseIntensity, maxParameterStep: 0, maxParameterStepDt: 0,
    maxParameterStepKey: '', mapped: mappedFace.diagnostics,
    browFlash: flashes.state, micro: micro.state, eyes: eyes.state, listening: listeningState,
    performance: performance.state,
    head: head.diagnostics, form: follow.diagnostics.form };
  // Stage applies the local expression deformation and head motion only after
  // intrinsic particle easing; the simulation never receives this display copy.
  shapes.headDisplay = follow;

  function refreshSelection() {
    const active = autoExpressions && !preview
      ? activeReply !== null || automatic.releasing ? 'auto' : listeningWeight > 0 ? 'listening' : 'neutral'
      : poseIntensity === 0 ? 'neutral' : selectedPose;
    const key = `${selectedPose}:${poseIntensity}:${active}:${autoExpressions}:${preview}`;
    if (key !== selectionKey) {
      selectionKey = key;
      selectionListener?.({ name: selectedPose, intensity: poseIntensity, active, autoExpressions, preview });
    }
  }

  function setPose(name, intensity = 1) {
    if (name !== 'neutral' && !Object.hasOwn(eyePoses, name)) return;
    if (name !== 'neutral') selectedPose = name;
    poseIntensity = name === 'neutral' ? 0 : clamp(intensity, 0, 1);
    preview = autoExpressions && activeReply === null && poseIntensity > 0;
    if (autoExpressions && activeReply === null) automatic.reset();
    refreshSelection();
  }

  function update(dt, clock, cues, envelope, shape, speaking = false, ended = null, listening = false, mouthPreview = null, inputVolume = 0) {
    const newReply = cues?.replyId !== undefined && cues.replyId !== activeReply;
    if (newReply) {
      preview = false;
      if (autoExpressions && (listeningWeight > 0 || listeningBridge)) {
        listeningBridge = { source: { ...cur }, age: 0 };
      }
      listeningWeight = 0;
      listeningTransition = null;
    }
    activeReply = cues?.replyId ?? null;
    const blend = automatic.update(dt, cues, ended);
    diagnostics.cues = blend;
    // Intensity is applied exactly once, to spring targets. Both sculpting and
    // runtime use these same critically damped, exact spring integrations.
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const automaticEnabled = autoExpressions && !preview;
    const acting = performance.update(step, blend.weights, automaticEnabled, cues?.state === 'gap');
    const foreground = acting.priority;
    const flash = flashes.update(step, cues, automatic.blockingEvent || foreground > .2, automaticEnabled, beats);
    // Wait for both the existing cue release and its spring tail. A small
    // normalized settling threshold avoids waiting for exact floating zero.
    const settled = !automatic.releasing && POSE_CONTROLS.every(([key, , low, high]) =>
      Math.abs(cur[key]) / (high - low) < 0.002 && Math.abs(velocity[key]) / (high - low) < 0.02);
    const eligible = automaticEnabled && listening && activeReply === null;
    if (!automaticEnabled) {
      listeningWeight = 0; listeningTransition = listeningBridge = null;
    } else if (activeReply === null) {
      listeningBridge = null;
      const target = eligible && (listeningWeight > 0 || settled) ? 1 : 0;
      if ((!listeningTransition && target !== listeningWeight)
          || (listeningTransition && listeningTransition.target !== target)) {
        const key = target ? 'attack' : 'release';
        listeningTransition = { source: listeningWeight, target, age: 0,
          duration: Math.max(0, listeningSettings[key] ?? (target ? 0.8 : 1)) };
      }
      if (listeningTransition) {
        const transition = listeningTransition;
        transition.age += step;
        const mix = transition.duration ? smooth(transition.age / transition.duration) : 1;
        listeningWeight = lerp(transition.source, transition.target, mix);
        if (mix === 1) listeningTransition = null;
      }
    }
    if (listeningBridge && cues?.state !== 'gap') listeningBridge.age += step;
    const bridgeMix = listeningBridge ? (replyBlend ? smooth(listeningBridge.age / replyBlend) : 1) : 1;
    Object.assign(listeningState, { weight: listeningWeight, eligible,
      phase: listeningBridge ? 'handoff' : listeningTransition ? listeningTransition.target ? 'attack' : 'release'
        : listeningWeight ? 'listening' : eligible ? 'settling' : 'off' });
    const listeningPose = eyePoses[listeningSettings.pose] || eyePoses.content;
    const listeningAmount = Number.isFinite(listeningSettings.amount) ? clamp(listeningSettings.amount, 0, 1) : 0.25;
    const drift = micro.update(step, cues, Math.max(blend.microSuppression, foreground * .94),
      automaticEnabled, listeningWeight, phraseEvents);
    const frequency = 14, decay = Math.exp(-frequency * step);
    for (const [key, , low, high] of POSE_CONTROLS) {
      let target = 0;
      if (!autoExpressions || preview) target = poseIntensity === 0 ? 0 : eyePoses[selectedPose][key] * poseIntensity;
      else {
        const weights = key === 'gazeX' || key === 'gazeY' ? blend.gazeWeights : blend.weights;
        for (const [name, weight] of Object.entries(weights)) target += eyePoses[name][key] * weight;
        if (key === 'headPitch') target += blend.questionPitch;
        if (listeningWeight && key !== 'gazeX' && key !== 'gazeY') target += listeningPose[key] * listeningAmount * listeningWeight;
      }
      if (drift[key]) target += drift[key];
      if (listeningBridge) target = lerp(listeningBridge.source[key], target, bridgeMix);
      target = clamp(target, low, high);
      const previous = cur[key], offset = previous - target;
      const tangent = velocity[key] + frequency * offset;
      cur[key] = clamp(target + (offset + tangent * step) * decay, low, high);
      velocity[key] = (velocity[key] - frequency * tangent * step) * decay;
      if (Math.abs(cur[key] - target) < 1e-8 && Math.abs(velocity[key]) < 1e-7) {
        cur[key] = target; velocity[key] = 0;
      }
      const change = Math.abs(cur[key] - previous);
      if (change > diagnostics.maxParameterStep) {
        diagnostics.maxParameterStep = change;
        diagnostics.maxParameterStepDt = step;
        diagnostics.maxParameterStepKey = key;
      }
      rendered[key] = flash[key] ? clamp(cur[key] + flash[key], low, high) : cur[key];
    }
    rendered.smile = 0.05 + cur.smile;
    if (bridgeMix === 1) listeningBridge = null;
    const pose = head.update(dt, { speaking, envelope, bias: cur,
      listening: automaticEnabled && listening, inputVolume, performance: acting });
    const eyeAttitude = eyes.update(step, { cues, enabled: automaticEnabled,
      weights: blend.weights, listening: listeningWeight,
      attention: head.diagnostics.attention, phraseEvents });
    if (eyeAttitude.weight > 0) for (const key of EYE_ATTITUDE_KEYS) {
      rendered[key] = lerp(rendered[key], eyeAttitude.pose[key] + (flash[key] || 0), eyeAttitude.weight);
    }
    headTime += step;
    beats = head.consumeBeats().map(beat => ({ ...beat, replyId: activeReply,
      position: Math.max(0, (cues?.position ?? 0) - (headTime - beat.time)) }));
    phraseEvents = head.consumePhraseEvents().map(event => ({ ...event, replyId: activeReply,
      position: Math.max(0, (cues?.position ?? 0) - (headTime - event.time)) }));
    gaze.x = pose.gazeX;
    gaze.y = pose.gazeY;

    blinkAge = pose.blink ? 0 : blinkAge + dt;
    blinkV = blinkAge < 0.16 ? 1 - 0.92 * Math.sin(Math.PI * blinkAge / 0.16) : 1;

    // Fade the three mouth biases over 150 ms, without resetting on a reversal.
    // Smile stays with the pose: closure controls aperture, not the corners.
    mouthBiasPhase = clamp(mouthBiasPhase + (speaking ? -step : step) / 0.15, 0, 1);
    if (mouthBiasPhase < 1e-12) mouthBiasPhase = 0;
    else if (mouthBiasPhase > 1 - 1e-12) mouthBiasPhase = 1;
    // Even a partial articulation cue takes exact precedence. Restart recovery
    // from zero after it clears so a residual end-of-speech cue cannot conceal
    // a completed fade and then reveal the silent mouth pose in one frame.
    if (shape.close > 0) mouthBiasPhase = 0;
    const mouthBias = mouthBiasPhase * mouthBiasPhase * (3 - 2 * mouthBiasPhase);
    mouthShape.w = shape.w;
    mouthShape.h = shape.h;
    mouthShape.round = shape.round;
    mouthShape.close = shape.close;
    mouthShape.cup = shape.cup ?? 0;
    mouthShape.square = shape.square ?? 0;
    mouthShape.tuck = shape.tuck ?? 0;
    mouthShape.oval = shape.oval ?? 0;
    let mouthEnvelope = envelope;
    if (mouthBias === 1) {
      // Keep the settled silent pose's original arithmetic exactly.
      mouthEnvelope = Math.max(envelope, cur.mouthOpen);
      mouthShape.h = shape.h + cur.mouthOpen * 0.25;
      mouthShape.w = shape.w * (1 - cur.mouthRound * 0.38);
      mouthShape.round = Math.max(shape.round, cur.mouthRound);
      mouthShape.close = Math.max(shape.close, cur.mouthPress);
    } else if (mouthBias > 0) {
      mouthEnvelope += Math.max(0, cur.mouthOpen - envelope) * mouthBias;
      mouthShape.h += cur.mouthOpen * 0.25 * mouthBias;
      mouthShape.w *= 1 - cur.mouthRound * 0.38 * mouthBias;
      mouthShape.round += Math.max(0, cur.mouthRound - shape.round) * mouthBias;
      mouthShape.close += Math.max(0, cur.mouthPress - shape.close) * mouthBias;
    }
    // Preview affects only mouth sampling, after all existing pose and head
    // calculations. Simulated loudness must never drive gestures or accents.
    // Blend back to this resolved mouth input, including silent pose biases,
    // so buffering or listening cannot reveal a pose in one frame at handoff.
    const mouthOverride = mouthPreview?.sample(step, mouthEnvelope, mouthShape);
    if (mouthOverride) {
      Object.assign(mouthShape, mouthOverride.shape);
      mouthEnvelope = mouthOverride.envelope;
    }
    mouthInput.envelope = mouthEnvelope;
    mouthInput.smile = rendered.smile;
    mouthInput.speaking = speaking;
    diagnostics.pose = pose;
    diagnostics.selectedPose = selectedPose;
    diagnostics.poseIntensity = poseIntensity;
    mappedFace.update(clock, rendered, gaze, blinkV, mouthEnvelope, mouthShape);
    motion.update(clock);
    follow.updateForm(step, automaticEnabled && !speaking && activeReply === null && !automatic.releasing,
      head.diagnostics.attention, acting);
    follow.setSquashStretch(cur.squashStretch);
    follow.updateGesture(step, cues, automaticEnabled, automatic.gestureWindows,
      beats, automatic.blockingEvent || foreground > .2);
    follow.update(dt, pose);
    refreshSelection();
  }

  return { update, diagnostics, setPose, setReplyText(text) {
    flashes.setReplyText(text);
    micro.setReplyText(text);
  }, onSelectionChange(listener) {
    selectionListener = listener;
    selectionKey = '';
    refreshSelection();
  }, applyTuning(tuning) {
    for (const name of Object.keys(eyePoses)) {
      const values = tuning.eyePoses?.[name];
      if (values) for (const [key, , low, high] of POSE_CONTROLS) {
        eyePoses[name][key] = Number.isFinite(values[key]) ? clamp(values[key], low, high) : EXPR[name][key];
      }
    }
    const nextPose = Object.hasOwn(eyePoses, tuning.eyePose) ? tuning.eyePose : selectedPose;
    const nextIntensity = Number.isFinite(tuning.poseIntensity) ? clamp(tuning.poseIntensity, 0, 1) : poseIntensity;
    if (typeof tuning.autoExpressions === 'boolean' && tuning.autoExpressions !== autoExpressions) {
      autoExpressions = tuning.autoExpressions;
      preview = false;
    }
    if (nextPose !== selectedPose || nextIntensity !== poseIntensity) setPose(nextPose, nextIntensity);
    automatic.applyTuning(tuning);
    flashes.applyTuning(tuning);
    micro.applyTuning(tuning);
    performance.applyTuning(tuning);
    eyes.applyTuning(tuning);
    if (tuning.listening) listeningSettings = tuning.listening;
    if (Number.isFinite(tuning.cueTiming?.replyBlend)) replyBlend = Math.max(0, tuning.cueTiming.replyBlend);
    // Legacy flat imports remain readable. Complete nested definitions are
    // authoritative, so another pose's editing mirror can never leak into one.
    if (!tuning.eyePoses?.[selectedPose]) {
      for (const [key, , low, high] of POSE_CONTROLS) if (Number.isFinite(tuning[key])) {
        eyePoses[selectedPose][key] = clamp(tuning[key], low, high);
      }
    }
    mappedFace.applyTuning(tuning);
    motion.applyTuning(tuning);
    head.applyTuning(tuning);
    follow.applyTuning(tuning);
    refreshSelection();
  } };
}

// Pose history belongs to the display pass; intrinsic simulation buffers and
// the shapes generator remain untouched. Every star keeps its own fixed traits.
export function createHeadFollow(shapes, phase = shapes.MOTION.FLOW_PHASE, reduce = false) {
  const { BASE, I, UV, MAP_SCALE, MAPS, MOTION } = shapes;
  const count = BASE.length / 3, coreEnd = I.face[1], filamentEnd = I.filaments[1];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let j = 0; j < coreEnd * 3; j += 3) {
    minX = Math.min(minX, BASE[j]); maxX = Math.max(maxX, BASE[j]);
    minY = Math.min(minY, BASE[j + 1]); maxY = Math.max(maxY, BASE[j + 1]);
    minZ = Math.min(minZ, BASE[j + 2]); maxZ = Math.max(maxZ, BASE[j + 2]);
  }
  const width = maxX - minX, height = maxY - minY, midZ = (minZ + maxZ) * 0.5;
  const nx = (minX + maxX) * 0.5, ny = minY - height * 0.07, nz = minZ - height * 0.04;
  const free = new Float32Array(count), departing = new Uint8Array(count);
  for (const i of MOTION.EDGE_INDEX) departing[i] = 1;
  for (const i of MOTION.DETACH_INDEX) departing[i] = 1;
  const landmarks = MAPS.landmarks;
  const pivotX = (landmarks.mouthCentre[0] - 0.5) * MAP_SCALE;
  const eyeV = (landmarks.eyeL[1] + landmarks.eyeR[1]) * 0.5;
  const pivotY = (0.5 - (eyeV + landmarks.mouthCentre[1]) * 0.5) * MAP_SCALE;
  const cheekLift = new Float32Array(count), squashed = new Float32Array(BASE.length);
  const cheekWeight = (u, v) => {
    const horizontal = Math.max(1 - swarmSmooth(Math.abs(u - landmarks.eyeL[0]) / 0.14),
      1 - swarmSmooth(Math.abs(u - landmarks.eyeR[0]) / 0.14));
    return horizontal * swarmSmooth((v - eyeV) / 0.055)
      * (1 - swarmSmooth((v - (eyeV + 0.17)) / 0.15));
  };
  let squashStretch = 0;
  const regions = ['L', 'R'].map(side => [
    Math.min(landmarks['eye' + side + '_inner'][0], landmarks['eye' + side + '_outer'][0]) - 0.01,
    Math.max(landmarks['eye' + side + '_inner'][0], landmarks['eye' + side + '_outer'][0]) + 0.01,
    landmarks['eye' + side + '_upperLid'][1] - 0.01,
    landmarks['eye' + side + '_lowerLid'][1] + 0.01
  ]);
  regions.push([landmarks.noseBridge[0] - 0.055, landmarks.noseTip[0] + 0.055,
    landmarks.noseBridge[1] - 0.01, landmarks.noseTip[1] + 0.035]);
  regions.push([landmarks.mouthLeft[0] - 0.015, landmarks.mouthRight[0] + 0.015,
    landmarks.upperLipTop[1] - 0.015, landmarks.lowerLipBottom[1] + 0.015]);
  // A separate, broad spatial field drives the acting ripple. In particular,
  // include every iris-light member, not just the narrower swarm protection.
  const gestureRegions = regions.concat(['L', 'R'].map(side => {
    const eye = landmarks['eye' + side];
    return [eye[0] - 0.065, eye[0] + 0.065, eye[1] - 0.085, eye[1] + 0.085];
  }));
  const noseU = (landmarks.noseBridge[0] + landmarks.noseTip[0]) * 0.5;
  const noseV = (landmarks.noseBridge[1] + landmarks.noseTip[1]) * 0.5;
  gestureRegions.push([noseU - 0.055, noseU + 0.055, noseV - 0.16, noseV + 0.16]);
  // Include the lip samples reached by the existing opening/smile warp.
  gestureRegions.push([landmarks.mouthLeft[0] - 0.025, landmarks.mouthRight[0] + 0.025,
    landmarks.upperLipTop[1] - 0.045, landmarks.lowerLipBottom[1] + 0.05]);
  const gestureInner = new Float64Array(count), gestureEdge = new Float64Array(count);
  const gestureDelay = new Float64Array(count), gestureValues = new Float64Array(count);
  const gestureSource = new Float64Array(count), gestured = new Float32Array(BASE.length);
  const centreU = (minX + maxX) * 0.5 / MAP_SCALE + 0.5;
  const centreV = 0.5 - (minY + maxY) * 0.5 / MAP_SCALE;
  const individual = new Float32Array(count * 4), shared = new Float32Array(count * 4);
  const traits = new Float32Array(count * 4), attachment = new Float32Array(count);
  const offsets = new Uint16Array(count), blends = new Float32Array(count);
  const random = swarmRandom(0x5e71c4a9), cell = width * 0.075;
  for (let i = 0; i < count; i++) {
    const j = i * 3, k = i * 4;
    const u = i < coreEnd ? UV[i * 2] : BASE[j] / MAP_SCALE + 0.5;
    const v = i < coreEnd ? UV[i * 2 + 1] : 0.5 - BASE[j + 1] / MAP_SCALE;
    cheekLift[i] = cheekWeight(u, v) * MAP_SCALE * 0.008;
    let distance = Infinity;
    for (const r of regions) distance = Math.min(distance,
      Math.hypot(Math.max(r[0] - u, 0, u - r[1]), Math.max(r[2] - v, 0, v - r[3])));
    free[i] = swarmSmooth(distance / 0.025);
    let featureDistance = Infinity;
    for (const r of gestureRegions) featureDistance = Math.min(featureDistance,
      Math.hypot(Math.max(r[0] - u, 0, u - r[1]), Math.max(r[2] - v, 0, v - r[3])));
    const radius = Math.hypot((u - centreU) * MAP_SCALE / (width * 0.5),
      (v - centreV) * MAP_SCALE / (height * 0.5));
    // A broad Gaussian falloff bounds the spatial delay gradient, including at
    // the slider's doubled amplitude, without a sharp wavefront near the lids.
    const featureDistanceWeight = 1 - Math.exp(-Math.pow(featureDistance / 0.16, 2));
    gestureInner[i] = featureDistanceWeight * swarmSmooth(radius / 0.65);
    gestureEdge[i] = featureDistanceWeight * swarmSmooth(radius);
    individual[k] = random();
    const angle = random() * Math.PI * 2, z = (random() * 2 - 1) * 0.15;
    const norm = Math.sqrt(1 + z * z);
    individual[k + 1] = Math.cos(angle) / norm;
    individual[k + 2] = Math.sin(angle) / norm;
    individual[k + 3] = z / norm;
    const x = BASE[j] / cell, y = BASE[j + 1] / cell, depth = BASE[j + 2] / cell;
    shared[k] = swarmNoise(x, y, depth, 0);
    const dx = swarmNoise(x, y, depth, 1) * 2 - 1;
    const dy = swarmNoise(x, y, depth, 2) * 2 - 1;
    const dz = (swarmNoise(x, y, depth, 3) * 2 - 1) * 0.15;
    const length = Math.hypot(dx, dy, dz) || 1;
    shared[k + 1] = dx / length; shared[k + 2] = dy / length; shared[k + 3] = dz / length;
  }
  const form = createFaceForm({ base: BASE, edge: gestureEdge, end: filamentEnd, width, height,
    centreX: (minX + maxX) * .5, centreY: (minY + maxY) * .5 }, reduce);
  const speechFlow = createSpeechFlow({ base: BASE, edge: gestureEdge, end: filamentEnd,
    width, height, pivotY });
  let speechFlowAmount = reduce ? 0 : 1;
  const BUCKETS = 32, SAMPLES = 64, STEP = 1 / 120;
  const history = new Float64Array(SAMPLES * 5);
  const previous = new Float64Array(5), current = new Float64Array(5), sample = new Float64Array(5);
  const matrices = new Float64Array(BUCKETS * 12);
  const settings = new Float64Array([1, 0.5, 0, 2.5]), targets = new Float64Array(settings);
  let initialized = false, cursor = 0, time = 0, sampledAt = 0, nextSample = STEP;
  let displayAmount = 0, lastCoherence = -1, angularSpeed = 0;
  const diagnostics = { angularSpeed: 0, deviationScale: 0, form: form.state };

  // This clock advances on audio position, independently of the existing head
  // history. Fixed-time analytic samples retain short transients at any fps.
  let gestureSettings = { anticipation: 0.08, compress: 0.12, hold: 0.1,
    release: 0.25, settle: 0.4, amount: 0.04, chuckleScale: 0.75,
    widen: 0.5, overshoot: 0.2, coreDelay: 0.04, edgeDelay: 0.15, edgeOvershoot: 0.5 };
  const sighSettings = { ...SIGH_GESTURE };
  let sighAmount = 1;
  const accentSettings = { direction: 1, amount: 0.036, attack: 0.18, hold: 0.12,
    release: 0.36, overshoot: 0.06, settle: 0.45, coreDelay: 0.02, edgeDelay: 0.12,
    edgeOvershoot: 0.5, widen: 0.5, spacing: 2.6, threshold: 0 };
  let accentAmount = 1, lastAccent = -Infinity, accentUntil = -Infinity;
  let accentCueMap = {}, accentSighRelease = 0.8, previousGestureWindows = [];
  let gestureKind = null, gestureWiden = gestureSettings.widen, sourceWiden = gestureWiden;
  let gestureAmount = 1, gestureReply = null, gesturePosition = 0;
  let gesture = null, recovery = null, gestureVisible = false, gestureCore = 0, sourceCore = 0;
  let gestureCursor = 0, gestureSampledAt = 0, gestureNextSample = 0;
  const GESTURE_STEP = 1 / 240;
  let gestureHistory = new Float64Array(256 * 3);
  const gestureSample = new Float64Array(3), gestureNow = new Float64Array(3);
  const gestureNext = new Float64Array(3);
  const gestureSeen = new Set();
  const gestureState = { value: 0, time: 0, activeId: null, starts: 0,
    delay: gestureDelay, edge: gestureEdge, values: gestureValues };
  diagnostics.gesture = gestureState;
  const accentState = { value: 0, time: 0, activeId: null, starts: 0,
    lastStart: -Infinity, duration: 0, flow: speechFlow.state };
  diagnostics.accent = accentState;

  function setGestureDelays(settings = gestureSettings) {
    for (let i = 0; i < count; i++) gestureDelay[i] = settings.coreDelay * gestureInner[i]
      + (settings.edgeDelay - settings.coreDelay) * gestureEdge[i];
  }
  setGestureDelays();

  function gestureCurve(age, out) {
    const g = gesture.settings;
    out[0] = out[1] = out[2] = 0;
    if (age <= 0) return;
    const ramp = (t, duration) => duration > 0 ? swarmSmooth(t / duration) : 1;
    if (gestureKind === 'accent') {
      out[2] = ramp(age, g.attack);
      if (age < g.attack) out[0] = out[2];
      else if ((age -= g.attack) < g.hold) out[0] = 1;
      else if ((age -= g.hold) < g.release) {
        out[0] = lerp(1, -g.overshoot, ramp(age, g.release));
        out[1] = Math.min(0, out[0]) * g.edgeOvershoot;
      } else if ((age -= g.release) < g.settle) {
        out[0] = -g.overshoot * (1 - ramp(age, g.settle));
        out[1] = out[0] * g.edgeOvershoot;
      }
      out[0] *= gesture.strength;
      out[1] *= gesture.strength;
      return;
    }
    if (gestureKind === 'sigh') {
      sampleSighGesture(age, g, gesture.strength, out);
      return;
    }
    out[2] = ramp(age, g.anticipation);
    if (age < g.anticipation) out[0] = g.overshoot * out[2];
    else if ((age -= g.anticipation) < g.compress) out[0] = lerp(g.overshoot, -1, ramp(age, g.compress));
    else if ((age -= g.compress) < g.hold) out[0] = -1;
    else if ((age -= g.hold) < g.release) {
      out[0] = lerp(-1, g.overshoot, ramp(age, g.release));
      out[1] = Math.max(0, out[0]) * g.edgeOvershoot;
    } else if ((age -= g.release) < g.settle) {
      out[0] = g.overshoot * (1 - ramp(age, g.settle));
      out[1] = out[0] * g.edgeOvershoot;
    }
    out[0] *= gesture.strength;
    out[1] *= gesture.strength;
  }

  function sampleGesture(at, out) {
    if (at <= 0) { out.fill(0); return; }
    if (at >= gestureSampledAt) {
      if (gestureKind === 'accent' || gestureKind === 'sigh') {
        // Interpolate the same 240 Hz interval at every display rate, even
        // when its upper sample lies beyond this frame's playback position.
        gestureCurve(gestureSampledAt + GESTURE_STEP, gestureNext);
        const mix = (at - gestureSampledAt) / GESTURE_STEP;
        for (let c = 0; c < 3; c++) out[c] = lerp(gestureHistory[gestureCursor * 3 + c], gestureNext[c], mix);
        return;
      }
      const mix = gesture.age > gestureSampledAt ? (at - gestureSampledAt) / (gesture.age - gestureSampledAt) : 1;
      for (let c = 0; c < 3; c++) out[c] = lerp(gestureHistory[gestureCursor * 3 + c], gestureNow[c], mix);
    } else {
      const samples = gestureHistory.length / 3;
      const age = Math.min(samples - 1, (gestureSampledAt - at) / GESTURE_STEP), whole = Math.floor(age);
      const a = (gestureCursor - whole + samples) % samples, b = (a - 1 + samples) % samples;
      for (let c = 0; c < 3; c++) out[c] = lerp(gestureHistory[a * 3 + c], gestureHistory[b * 3 + c], age - whole);
    }
  }

  function renderGesture() {
    while (gestureNextSample <= gesture.age + 1e-9) {
      gestureCurve(gestureNextSample, gestureSample);
      gestureCursor = (gestureCursor + 1) % (gestureHistory.length / 3);
      gestureHistory.set(gestureSample, gestureCursor * 3);
      gestureSampledAt = gestureNextSample;
      gestureNextSample += GESTURE_STEP;
    }
    gestureCurve(gesture.age, gestureNow);
    gestureCore = sourceCore * (1 - gestureNow[2]) + gestureNow[0];
    gestureWiden = gestureKind === 'accent' ? gesture.settings.widen
      : lerp(sourceWiden, gestureKind === 'sigh' ? gesture.settings.widen : gestureSettings.widen, gestureNow[2]);
    for (let i = 0; i < count; i++) {
      if (gestureDelay[i] === 0) {
        gestureValues[i] = gestureCore;
        speechFlow.write(i, gestureCore, gestureNow[2]);
        continue;
      }
      sampleGesture(gesture.age - gestureDelay[i], gestureSample);
      gestureValues[i] = gestureSource[i] * (1 - gestureSample[2])
        + gestureSample[0] + gestureEdge[i] * gestureSample[1];
      speechFlow.write(i, gestureValues[i], gestureSample[2]);
    }
  }

  function restGesture() {
    gesture = recovery = null;
    gestureVisible = false; gestureCore = 0;
    gestureKind = null;
    gestureValues.fill(0); gestureSource.fill(0);
    speechFlow.clear();
    gestureState.activeId = null;
  }

  function recoverGesture() {
    if (!gestureVisible || recovery) return;
    gestureSource.set(gestureValues); sourceCore = gestureCore;
    speechFlow.capture();
    recovery = { age: 0, duration: gestureKind === 'accent' || gestureKind === 'sigh' ? gesture.settings.settle : gestureSettings.settle };
    gesture = null;
    gestureState.activeId = null;
  }

  function resetGestureHistory(delay) {
    const samples = Math.max(2, Math.ceil(delay / GESTURE_STEP) + 2);
    if (gestureHistory.length !== samples * 3) gestureHistory = new Float64Array(samples * 3);
    else gestureHistory.fill(0);
    gestureCursor = 0; gestureSampledAt = 0; gestureNextSample = GESTURE_STEP;
    gestureVisible = true;
  }

  function startGesture(window, position) {
    const continuing = gestureVisible, sigh = window.kind === 'sigh';
    const settings = { ...(sigh ? sighSettings : gestureSettings) };
    gestureSource.set(gestureValues); sourceCore = gestureCore;
    speechFlow.capture();
    sourceWiden = continuing ? gestureWiden : settings.widen;
    gestureKind = sigh ? 'sigh' : 'gesture';
    setGestureDelays(settings);
    recovery = null;
    const duration = sigh ? settings.gather + settings.hold + settings.release + settings.settle
      : settings.anticipation + settings.compress + settings.hold + settings.release + settings.settle;
    const delay = Math.max(settings.coreDelay, settings.edgeDelay);
    gesture = { id: window.id, start: window.start, age: continuing ? 0 : Math.max(0, position - window.start), settings,
      duration: duration + delay, strength: settings.amount * gestureAmount
        * (sigh ? sighAmount : window.kind === 'chuckle' ? settings.chuckleScale : 1) };
    resetGestureHistory(delay);
    gestureState.activeId = window.id; gestureState.starts++;
    renderGesture();
  }

  function startAccent(beat, position) {
    // Only a resting field can start an accent. Laughter reuses startGesture's
    // existing handover from the displayed field, never a second deformation.
    const settings = { ...accentSettings };
    if (speechFlowAmount > 0) {
      // Round the travelling accent's arrival and return without changing its
      // direction, peak size, beat trigger or the separate laugh choreography.
      settings.attack += .04;
      settings.release += .06;
      settings.overshoot *= .75;
    }
    setGestureDelays(settings);
    speechFlow.start(accentState.starts, speechFlowAmount, gestureDelay);
    const extraDelay = speechFlowAmount > 0 ? .24 : 0;
    const duration = settings.attack + settings.hold + settings.release + settings.settle
      + Math.max(settings.coreDelay, settings.edgeDelay) + extraDelay;
    const delay = Math.max(settings.coreDelay, settings.edgeDelay) + extraDelay;
    gestureKind = 'accent';
    sourceWiden = gestureWiden = settings.widen;
    sourceCore = 0;
    gestureSource.fill(0);
    gesture = { id: `accent:${beat.position}`, start: beat.position,
      age: Math.max(0, position - beat.position), settings, duration,
      strength: settings.direction * settings.amount * accentAmount * (0.7 + 0.3 * clamp(beat.strength, 0, 1)) };
    resetGestureHistory(delay);
    lastAccent = beat.position; accentUntil = lastAccent + duration;
    accentState.lastStart = lastAccent; accentState.duration = duration; accentState.starts++;
    gestureState.activeId = gesture.id;
    renderGesture();
  }

  function updateGesture(dt, cues, enabled, windows = [], beats = [], blockingEvent = false) {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const reply = cues?.replyId ?? null, position = cues?.position ?? 0;
    const replaced = reply !== gestureReply;
    if (replaced) {
      recoverGesture(); gestureSeen.clear();
      gestureReply = reply;
      lastAccent = accentUntil = -Infinity;
      previousGestureWindows = [];
    }
    // The first gap frame may reach the just-finished chunk's exact end.
    // Thereafter its playback position is constant, freezing the entire field.
    const speechStep = !replaced && cues ? Math.max(0, position - gesturePosition) : 0;
    gesturePosition = position;
    const allowed = enabled && gestureAmount > 0 && cues;
    const accentAllowed = enabled && accentAmount > 0 && cues;
    if (gestureKind === 'accent' ? !accentAllowed : !allowed) recoverGesture();
    if (recovery) {
      // Stop/replacement/disable recover the entire visible field, including
      // its delayed tails, rather than flushing the history to neutral.
      recovery.age += step;
      const fade = 1 - swarmSmooth(recovery.duration > 0 ? recovery.age / recovery.duration : 1);
      gestureCore = sourceCore * fade;
      for (let i = 0; i < count; i++) gestureValues[i] = gestureSource[i] * fade;
      speechFlow.fade(fade);
      if (fade === 0) restGesture();
    } else if (gesture) {
      const window = gestureKind === 'accent' ? null : windows.find(window => window.id === gesture.id);
      if (gestureKind === 'accent') gesture.age = Math.max(gesture.age, position - gesture.start);
      else gesture.age += speechStep;
      if (window) {
        // Corrections slew the existing occurrence on playback time. Its age
        // cannot move backward, and a zero-time update cannot jump or restart.
        const correction = position - window.start - gesture.age;
        gesture.age += clamp(correction, -speechStep * 0.5, speechStep * 0.5);
        gesture.start = window.start;
      }
      renderGesture();
      if (gesture.age >= gesture.duration) restGesture();
    }
    for (const window of windows) {
      if (position < window.start) continue;
      if (gestureSeen.has(window.id)) continue;
      if (allowed && cues.state === 'gap' && speechStep === 0) continue;
      gestureSeen.add(window.id);
      if (allowed && !(window.kind === 'sigh' && (reduce || sighAmount === 0))) startGesture(window, position);
    }
    if (accentAllowed && cues.state !== 'gap') for (const beat of beats) {
      if (beat.replyId !== reply || !Number.isFinite(beat.position) || !Number.isFinite(beat.strength)
          || beat.position < 0.3 || beat.position > position || beat.strength < accentSettings.threshold) continue;
      // Sub-frame beats can precede a window retired on this display frame.
      // Keep its exact interval for that last step, including sigh releases.
      const inside = window => beat.position >= window.start && beat.position < window.end;
      if (blockingEvent || windows.some(inside) || previousGestureWindows.some(inside)
          || cues.cues?.some(cue => accentCueMap[cue.name]?.kind === 'sigh'
            && beat.position >= cue.start && beat.position < cue.end + accentSighRelease)
          || gestureVisible) continue;
      const duration = accentSettings.attack + accentSettings.hold + accentSettings.release + accentSettings.settle
        + Math.max(accentSettings.coreDelay, accentSettings.edgeDelay);
      if (beat.position < accentUntil || beat.position - lastAccent < Math.max(accentSettings.spacing, duration)) continue;
      if (accentSettings.amount === 0 || accentSettings.direction === 0) continue;
      startAccent(beat, position);
    }
    previousGestureWindows = windows;
    gestureState.value = gestureCore;
    gestureState.time = gesture?.age ?? recovery?.age ?? 0;
    gestureState.kind = gestureKind;
    accentState.value = gestureKind === 'accent' ? gestureCore : 0;
    accentState.time = gestureKind === 'accent' ? gestureState.time : 0;
    accentState.activeId = gestureKind === 'accent' ? gestureState.activeId : null;
  }

  function update(dt, pose) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    current[0] = pose.yaw; current[1] = pose.pitch; current[2] = pose.roll;
    current[3] = pose.x; current[4] = pose.y;
    if (!initialized) {
      for (let i = 0; i < SAMPLES; i++) history.set(current, i * 5);
      previous.set(current); initialized = true;
    }
    if (dt > 0) angularSpeed = Math.hypot(current[0] - previous[0], current[1] - previous[1],
      current[2] - previous[2]) / dt;
    if (angularSpeed < 1e-9) angularSpeed = 0;
    diagnostics.angularSpeed = angularSpeed;
    const end = time + dt;
    while (nextSample <= end + 1e-9) {
      const mix = dt > 0 ? Math.min(1, (nextSample - time) / dt) : 1;
      cursor = (cursor + 1) % SAMPLES;
      for (let c = 0; c < 5; c++) history[cursor * 5 + c] = lerp(previous[c], current[c], mix);
      sampledAt = nextSample; nextSample += STEP;
    }
    time = end; previous.set(current);
    const ease = 1 - Math.exp(-dt / 0.12);
    for (let c = 0; c < settings.length; c++) {
      settings[c] = lerp(settings[c], targets[c], ease);
      if (Math.abs(settings[c] - targets[c]) < 1e-7) settings[c] = targets[c];
    }
    if (lastCoherence !== settings[1]) {
      mixSwarmTraits(individual, shared, traits, settings[1] * 0.9);
      lastCoherence = settings[1];
    }
  }

  function writeMatrix(offset, amount) {
    const deg = Math.PI / 180 * amount;
    const sx = Math.sin(sample[1] * deg), cx = Math.cos(sample[1] * deg);
    const sy = Math.sin(sample[0] * deg), cy = Math.cos(sample[0] * deg);
    const sz = Math.sin(sample[2] * deg), cz = Math.cos(sample[2] * deg);
    const m = matrices, k = offset, depth = settings[3];
    // Store only R-I. Virtual depth contributes to rotational displacement,
    // then is subtracted again: neutral geometry never inflates or changes z.
    m[k] = cz * cy - 1; m[k + 1] = cz * sy * sx - sz * cx; m[k + 2] = cz * sy * cx + sz * sx;
    m[k + 4] = sz * cy; m[k + 5] = sz * sy * sx + cz * cx - 1; m[k + 6] = sz * sy * cx - cz * sx;
    m[k + 8] = -sy; m[k + 9] = cy * sx; m[k + 10] = cy * cx - 1;
    const zShift = midZ * (1 - depth) - nz;
    m[k + 3] = sample[3] * amount - m[k] * nx - m[k + 1] * ny + m[k + 2] * zShift;
    m[k + 7] = sample[4] * amount - m[k + 4] * nx - m[k + 5] * ny + m[k + 6] * zShift;
    m[k + 11] = -m[k + 8] * nx - m[k + 9] * ny + m[k + 10] * zShift;
    m[k + 2] *= depth; m[k + 6] *= depth; m[k + 10] *= depth;
  }

  function apply(source, display, amount = 1) {
    displayAmount = amount;
    if (amount === 0) { display.set(source); return; }
    for (let b = 0; b < BUCKETS; b++) {
      const at = time - 0.04 * settings[0] * b / (BUCKETS - 1);
      if (at >= sampledAt) {
        const mix = time > sampledAt ? (at - sampledAt) / (time - sampledAt) : 1;
        for (let c = 0; c < 5; c++) sample[c] = lerp(history[cursor * 5 + c], current[c], mix);
      } else {
        const age = Math.min(SAMPLES - 1, (sampledAt - at) / STEP), whole = Math.floor(age);
        const a = (cursor - whole + SAMPLES) % SAMPLES, b = (a - 1 + SAMPLES) % SAMPLES;
        for (let c = 0; c < 5; c++) sample[c] = lerp(history[a * 5 + c], history[b * 5 + c], age - whole);
      }
      writeMatrix(b * 12, amount);
    }
    updateAttachment(source, BASE, phase, departing, traits, free, attachment, offsets, blends,
      coreEnd, filamentEnd, width, settings[2]);
    let localSource = form.apply(source, attachment, amount);
    // The original attachment field blends the local expression into attached
    // surroundings. Loose background stars receive no expression deformation.
    // The exact-zero path keeps the previous floating-point operation order.
    if (squashStretch !== 0) {
      const stretch = squashStretch * amount;
      const vertical = stretch * 0.07, horizontal = -stretch * 0.035;
      const lift = Math.max(0, -stretch);
      for (let i = 0, j = 0; i < count; i++, j += 3) {
        const weight = i < filamentEnd ? attachment[i] : 0;
        squashed[j] = localSource[j] + (localSource[j] - pivotX) * horizontal * weight;
        squashed[j + 1] = localSource[j + 1]
          + ((localSource[j + 1] - pivotY) * vertical + cheekLift[i] * lift) * weight;
        squashed[j + 2] = localSource[j + 2];
      }
      localSource = squashed;
    }
    if (gestureVisible) {
      for (let i = 0, j = 0; i < count; i++, j += 3) {
        const value = gestureValues[i] * amount * (i < filamentEnd ? attachment[i] : 0);
        gestured[j] = localSource[j] - (localSource[j] - pivotX) * value * gestureWiden
          + speechFlow.x[i] * amount * (i < filamentEnd ? attachment[i] : 0);
        gestured[j + 1] = localSource[j + 1] + (localSource[j + 1] - pivotY) * value
          + speechFlow.y[i] * amount * (i < filamentEnd ? attachment[i] : 0);
        gestured[j + 2] = localSource[j + 2];
      }
      localSource = gestured;
    }
    // Reply-start turns peak near 80 degrees/second; keep their path shimmer
    // around 0.4% of face width, with proportionally less on gentle beats.
    const deviation = settings[0] * angularSpeed * width * (0.004 / 80) * amount;
    diagnostics.deviationScale = deviation;
    applySwarm(localSource, display, matrices, attachment, offsets, blends, traits, free, deviation);
  }

  // Clearance landmarks receive exactly the protected features' current pose,
  // including virtual depth, with no delay or deviation.
  function transformPoint(point) {
    if (displayAmount === 0) return point;
    if (squashStretch !== 0) {
      const stretch = squashStretch * displayAmount;
      const cheek = cheekWeight(point.x / MAP_SCALE + 0.5, 0.5 - point.y / MAP_SCALE);
      point.x += (point.x - pivotX) * -stretch * 0.035;
      point.y += (point.y - pivotY) * stretch * 0.07
        + cheek * MAP_SCALE * 0.008 * Math.max(0, -stretch);
    }
    if (gestureVisible) {
      const value = gestureCore * displayAmount;
      point.x -= (point.x - pivotX) * value * gestureWiden;
      point.y += (point.y - pivotY) * value;
    }
    const x = point.x, y = point.y, z = point.z, m = matrices;
    point.x = x + m[0] * x + m[1] * y + m[2] * z + m[3];
    point.y = y + m[4] * x + m[5] * y + m[6] * z + m[7];
    point.z = z + m[8] * x + m[9] * y + m[10] * z + m[11];
    return point;
  }

  return { update, updateGesture, updateForm: form.update, apply, transformPoint, diagnostics,
    setSquashStretch(value) { squashStretch = clamp(value, -1, 1); },
    applyTuning(tuning) {
    if (!reduce && Number.isFinite(tuning.speechFlowAmount))
      speechFlowAmount = clamp(tuning.speechFlowAmount, 0, 1);
    if (Number.isFinite(tuning.sighAmount)) sighAmount = clamp(tuning.sighAmount, 0, 2);
    if (tuning.sigh) for (const key of Object.keys(sighSettings)) {
      if (Number.isFinite(tuning.sigh[key])) sighSettings[key] = Math.max(0, tuning.sigh[key]);
    }
    if (Number.isFinite(tuning.formAmount)) form.setAmount(tuning.formAmount);
    if (Number.isFinite(tuning.gestureAmount)) gestureAmount = clamp(tuning.gestureAmount, 0, 2);
    if (Number.isFinite(tuning.accentAmount)) accentAmount = clamp(tuning.accentAmount, 0, 2);
    if (tuning.cueMap) accentCueMap = tuning.cueMap;
    if (Number.isFinite(tuning.cueTiming?.sighRelease)) accentSighRelease = Math.max(0, tuning.cueTiming.sighRelease);
    if (tuning.accent) {
      for (const key of Object.keys(accentSettings)) if (Number.isFinite(tuning.accent[key])) {
        accentSettings[key] = key === 'direction' ? clamp(tuning.accent[key], -1, 1) : Math.max(0, tuning.accent[key]);
      }
    }
    if (tuning.gesture) {
      for (const key of Object.keys(gestureSettings)) if (Number.isFinite(tuning.gesture[key])) {
        gestureSettings[key] = Math.max(0, tuning.gesture[key]);
      }
      if (gestureKind !== 'accent' && gestureKind !== 'sigh') {
        setGestureDelays();
        gestureWiden = sourceWiden = gestureSettings.widen;
      }
    }
    const names = ['swarm', 'swarmCoherence', 'surroundWeight', 'headDepth'];
    const low = [0, 0, 0, 1], high = [2, 1, 1, 4];
    for (let c = 0; c < names.length; c++) if (Number.isFinite(tuning[names[c]])) {
      targets[c] = Math.max(low[c], Math.min(high[c], tuning[names[c]]));
      if (!initialized) settings[c] = targets[c];
    }
  } };
}

function swarmSmooth(value) {
  const t = Math.max(0, Math.min(1, value));
  return Math.max(0, Math.min(1, t * t * t * (t * (t * 6 - 15) + 10)));
}

// Independent seed: never reads or advances the shapes generator.
function swarmRandom(seed) {
  return () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function swarmHash(x, y, z, channel) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
    ^ Math.imul(z, 1442695041) ^ Math.imul(channel + 1, 1274126177) ^ 0x38c5e1b7;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967295;
}

function swarmNoise(x, y, z, channel) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = swarmSmooth(x - ix), v = swarmSmooth(y - iy), w = swarmSmooth(z - iz);
  const a = lerp(swarmHash(ix, iy, iz, channel), swarmHash(ix + 1, iy, iz, channel), u);
  const b = lerp(swarmHash(ix, iy + 1, iz, channel), swarmHash(ix + 1, iy + 1, iz, channel), u);
  const c = lerp(swarmHash(ix, iy, iz + 1, channel), swarmHash(ix + 1, iy, iz + 1, channel), u);
  const d = lerp(swarmHash(ix, iy + 1, iz + 1, channel), swarmHash(ix + 1, iy + 1, iz + 1, channel), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w);
}

function mixSwarmTraits(individual, shared, traits, coherence) {
  for (let k = 0; k < traits.length; k += 4) {
    traits[k] = lerp(individual[k], shared[k], coherence);
    const x = lerp(individual[k + 1], shared[k + 1], coherence);
    const y = lerp(individual[k + 2], shared[k + 2], coherence);
    const z = lerp(individual[k + 3], shared[k + 3], coherence);
    const norm = Math.hypot(x, y, z) || 1;
    traits[k + 1] = x / norm; traits[k + 2] = y / norm; traits[k + 3] = z / norm;
  }
}

function updateAttachment(source, base, phase, departing, traits, free, attachment, offsets, blends,
  coreEnd, filamentEnd, width, surround) {
  for (let i = 0, j = 0; i < attachment.length; i++, j += 3) {
    let attached = 1;
    if (i >= filamentEnd) attached = 0;
    else if (i >= coreEnd) {
      const u = phase[i], t = u * (0.65 + u * 0.35);
      attached = 1 - swarmSmooth(t);
    } else if (departing[i]) {
      const distance = Math.hypot(source[j] - base[j], source[j + 1] - base[j + 1], source[j + 2] - base[j + 2]);
      attached = 1 - swarmSmooth((distance / width - 0.035) / 0.165);
    }
    const weight = surround + (1 - surround) * attached;
    attachment[i] = weight;
    const bucket = traits[i * 4] * free[i] * weight * 31;
    const lower = Math.min(30, Math.floor(bucket));
    offsets[i] = lower * 12; blends[i] = bucket - lower;
  }
}

function applySwarm(source, display, m, attachment, offsets, blends, traits, free, deviation) {
  for (let i = 0, j = 0; i < attachment.length; i++, j += 3) {
    const x = source[j], y = source[j + 1], z = source[j + 2], weight = attachment[i];
    if (weight === 0) { display[j] = x; display[j + 1] = y; display[j + 2] = z; continue; }
    const k = offsets[i], next = k + 12, mix = blends[i], t = i * 4;
    const dx = m[k] * x + m[k + 1] * y + m[k + 2] * z + m[k + 3];
    const dy = m[k + 4] * x + m[k + 5] * y + m[k + 6] * z + m[k + 7];
    const dz = m[k + 8] * x + m[k + 9] * y + m[k + 10] * z + m[k + 11];
    const dev = deviation * free[i];
    display[j] = x + weight * (lerp(dx, m[next] * x + m[next + 1] * y + m[next + 2] * z + m[next + 3], mix) + traits[t + 1] * dev);
    display[j + 1] = y + weight * (lerp(dy, m[next + 4] * x + m[next + 5] * y + m[next + 6] * z + m[next + 7], mix) + traits[t + 2] * dev);
    display[j + 2] = z + weight * (lerp(dz, m[next + 8] * x + m[next + 9] * y + m[next + 10] * z + m[next + 11], mix) + traits[t + 3] * dev);
  }
}
