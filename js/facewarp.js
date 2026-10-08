import { sampleRGB } from './facesample.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const falloff = (x, inner, outer) => 1 - smooth((Math.abs(x) - inner) / (outer - inner));

// In map coordinates. The cap is less than half the original mouth width;
// the existing voice envelope and visemes remain the sole speech clocks.
export function mouthAperture(envelope, shape, strength = 1) {
  const energy = clamp(envelope, 0, 1);
  // Quiet vowels still part the photographed lips. The gentle toe leaves
  // silence completely shut and retains the same natural maximum opening.
  const voiced = energy * 0.7 + Math.sqrt(energy) * 0.3;
  return Math.min(0.064, voiced * shape.h * 0.058 * strength)
    * Math.pow(1 - clamp(shape.close, 0, 1), 1.5);
}

// A monotone inverse horizontal warp: narrow lips must not pull the black
// background into the cheeks. The Hermite shoulder joins the scaled mouth
// to the undisturbed cheek with matching derivatives at both ends.
export function inverseMouthX(offset, width, half, outer) {
  const distance = Math.abs(offset), edge = half * width;
  if (distance <= edge) return offset / width;
  if (distance >= outer) return offset;
  const span = outer - edge, t = (distance - edge) / span;
  const t2 = t * t, t3 = t2 * t;
  const source = (2 * t3 - 3 * t2 + 1) * half
    + (t3 - 2 * t2 + t) * span / width
    + (-2 * t3 + 3 * t2) * outer + (t3 - t2) * span;
  return Math.sign(offset) * source;
}

// This sampler changes image coordinates and local depth only. The motion
// module can move world positions without changing immutable home-UV sampling.
export function createMappedFace(shapes, reduce) {
  const { I, FACE, FACE_COL, UV, MAP_DEPTH, DENSITY_RANDOM,
    SPARK_RANDOM, P1, MAPS, MAP_SCALE, STAR_TINT, STAR_SIZE,
    FIELD, PROTECT } = shapes;
  const landmarks = MAPS.landmarks, colour = MAPS.colour;
  const count = I.face[1], weights = new Float32Array(count * 8);
  // Separate short passes let Safari optimize the hot loops promptly. These
  // reusable double-precision intermediates keep the same sampling arithmetic
  // without allocating objects for individual stars or individual frames.
  const samplePositions = new Float64Array(count * 2);
  const featureLight = new Float64Array(count * 5);
  const mouth = landmarks.mouthCentre;
  const mouthHalf = (landmarks.mouthRight[0] - landmarks.mouthLeft[0]) * 0.5;
  const seamStart = landmarks.mouthLeft[0] - 0.025;
  const seamEnd = landmarks.mouthRight[0] + 0.025;
  const seam = new Float32Array(129), work = new Float32Array(129);
  const rgb = new Float32Array(3);
  const eyes = [landmarks.eyeL, landmarks.eyeR];
  const lids = [landmarks.eyeL_upperLid[1], landmarks.eyeR_upperLid[1]];
  const lowerLids = [landmarks.eyeL_lowerLid[1], landmarks.eyeR_lowerLid[1]];
  const brows = [landmarks.browL_peak, landmarks.browR_peak];
  const innerBrows = [landmarks.browL_inner, landmarks.browR_inner];
  const outerBrows = [landmarks.browL_outer, landmarks.browR_outer];
  const average = MAPS.average;
  const averagePeak = Math.max(...average, 0.001);
  const floorTint = average.map(value => 0.45 + value / averagePeak * 0.55);
  const starGain = new Float32Array(count), tintMix = new Float32Array(count);
  const protectedGain = new Float64Array(count), protectedTintMix = new Float64Array(count);
  const breathSin = new Float32Array(count), breathCos = new Float32Array(count);
  const irisLight = new Float32Array(count * 3), noseLight = new Float32Array(count);
  const socketLight = new Float32Array(count);
  const eyePose = new Float64Array(10);
  const warped = new Float64Array(2), apertureBounds = new Float64Array(2);
  let eyeBand = 0;
  const eyeMembers = [[], []];
  const noseU = (landmarks.noseBridge[0] + landmarks.noseTip[0]) * 0.5;
  const noseV = (landmarks.noseBridge[1] + landmarks.noseTip[1]) * 0.5;

  // Follow the photograph's actual dark seam inside the landmark corridor.
  // Expanding this sampled strip makes a mouth cavity without drawing a line
  // or inventing a second set of particles for either lip.
  for (let n = 0; n < seam.length; n++) {
    const u = seamStart + (seamEnd - seamStart) * n / (seam.length - 1);
    const t = clamp((u - landmarks.mouthLeft[0]) / (mouthHalf * 2), 0, 1);
    const v = landmarks.mouthLeft[1] * (1 - t) + landmarks.mouthRight[1] * t;
    let darkest = Infinity, best = v;
    for (let y = Math.floor((v - 0.014) * colour.height); y <= (v + 0.009) * colour.height; y++) {
      sampleRGB(colour, u, y / (colour.height - 1), rgb);
      const light = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      if (light < darkest) { darkest = light; best = y / (colour.height - 1); }
    }
    seam[n] = best;
  }
  for (let pass = 0; pass < 3; pass++) {
    for (let n = 0; n < seam.length; n++) {
      work[n] = (seam[Math.max(0, n - 1)] + seam[n] * 2 + seam[Math.min(seam.length - 1, n + 1)]) * 0.25;
    }
    seam.set(work);
  }

  // Spatial falloffs are fixed and shared by all frames; there are no
  // per-frame allocations or landmark searches in the particle loop.
  for (let i = 0; i < count; i++) {
    const u = UV[i * 2], v = UV[i * 2 + 1], k = i * 8;
    weights[k] = falloff(u - mouth[0], mouthHalf + 0.01, mouthHalf + 0.09)
      * falloff(v - mouth[1], 0.074, 0.18);
    weights[k + 1] = falloff(v - mouth[1], 0.026, 0.12);
    const starSize = STAR_SIZE ? STAR_SIZE[i] : 1;
    // A larger luminous core already covers more pixels. Keep the rare large
    // stars coloured instead of multiplying their size by a second HDR boost.
    starGain[i] = (0.68 + SPARK_RANDOM[i] * 0.7) / (1 + Math.max(0, starSize - 1) * 0.14);
    tintMix[i] = 0.48 + DENSITY_RANDOM[i] * 0.28;
    if (PROTECT) {
      protectedGain[i] = 1 + (starGain[i] - 1) * (1 - PROTECT[i] * 0.88);
      protectedTintMix[i] = tintMix[i] * (1 - PROTECT[i] * 0.86);
    }
    const phase = u * 8.1 + v * 5.3 + (FIELD ? FIELD[i] * 2.5 : 0);
    breathSin[i] = Math.sin(phase); breathCos[i] = Math.cos(phase);
    const nx = (u - noseU) / 0.055, ny = (v - noseV) / 0.16;
    noseLight[i] = Math.max(0, 1 - nx * nx - ny * ny);
    for (let side = 0; side < 2; side++) {
      const eye = eyes[side], brow = brows[side];
      if (Math.abs(u - eye[0]) < 0.065 && Math.abs(v - eye[1]) < 0.085) eyeMembers[side].push(i);
      weights[k + 2 + side] = falloff(u - eye[0], 0.035, 0.102)
        * falloff(v - eye[1], 0.032, 0.082);
      const ix = (u - eye[0]) / 0.055, iy = (v - eye[1]) / 0.032;
      weights[k + 4 + side] = Math.pow(Math.max(0, 1 - ix * ix - iy * iy), 2);
      weights[k + 6 + side] = falloff(u - brow[0], 0.075, 0.155)
        * falloff(v - brow[1], 0.025, 0.092);
      // A soft shadow ring leaves the photographed lids and iris untouched.
      const socket = falloff(u - eye[0], 0.052, 0.105) * falloff(v - eye[1], 0.035, 0.08);
      const aperture = falloff(u - eye[0], 0.042, 0.073) * falloff(v - eye[1], 0.027, 0.052);
      socketLight[i] = Math.max(socketLight[i], socket * (1 - aperture));
    }
  }
  const eyeParticles = eyeMembers.map(indices => Int32Array.from(indices));

  let definition = 1, brightnessFloor = 0.025, faceDensity = 1;
  let depthAmount = 1.6, mouthWarpStrength = 1, sparkle = 0.15;
  let eyeGlow = 1, lipProminence = 1;
  let irisRound = 0.8, irisSoftness = 0.5, irisWarmth = 0.5, socketLift = 0.3;
  let messiness = 0.7, breathAmount = 1;
  function applyTuning(tuning) {
    definition = tuning.definition ?? definition;
    brightnessFloor = tuning.brightnessFloor ?? brightnessFloor;
    faceDensity = tuning.faceDensity ?? faceDensity;
    depthAmount = tuning.depthAmount ?? depthAmount;
    mouthWarpStrength = tuning.mouthWarpStrength ?? mouthWarpStrength;
    sparkle = tuning.sparkle ?? sparkle;
    eyeGlow = tuning.eyeGlow ?? eyeGlow;
    if (Number.isFinite(tuning.irisRound)) irisRound = clamp(tuning.irisRound, 0, 1);
    if (Number.isFinite(tuning.irisSoftness)) irisSoftness = clamp(tuning.irisSoftness, 0, 1);
    if (Number.isFinite(tuning.irisWarmth)) irisWarmth = clamp(tuning.irisWarmth, 0, 1);
    if (Number.isFinite(tuning.socketLift)) socketLift = clamp(tuning.socketLift, 0, 1);
    lipProminence = tuning.lipProminence ?? lipProminence;
    messiness = tuning.messiness ?? messiness;
    breathAmount = Math.max(0, tuning.breath ?? breathAmount);
  }

  // The zero-expression path below is the original sampler, including its
  // arithmetic order. Sculpted light and sampling share this lid geometry.
  function readEyePose(expression) {
    const upper = clamp(expression.upperLid ?? 0, -1, 1);
    const lower = clamp(expression.lowerLid ?? 0, 0, 1);
    const slant = clamp(expression.slant ?? 0, -1, 1);
    const asym = clamp(expression.eyeAsym ?? 0, -1, 1);
    eyeBand = smooth(lower) * smooth((upper + 0.1) / 0.6);
    for (let side = 0; side < 2; side++) {
      const p = side * 5;
      eyePose[p] = slant * (side === 0 ? 1 : -1) * Math.PI / 20;
      eyePose[p + 1] = lower;
      eyePose[p + 2] = upper * 0.025 + asym * (side === 0 ? -0.007 : 0.007);
      eyePose[p + 3] = lower * 0.034;
      eyePose[p + 4] = Math.max(Math.abs(upper), lower, Math.abs(slant), Math.abs(asym));
    }
  }

  function eyeAperture(side, x, out) {
    const p = side * 5, arc = Math.max(0, 1 - (x / 0.070) ** 2);
    const bottom = lowerLids[side] - eyePose[p + 3] * arc;
    const flatTop = lids[side] + eyePose[p + 2] * falloff(x, 0.040, 0.085);
    // Laughter needs a curved aperture, not two lids crushing a round dot.
    out[0] = Math.min(bottom - 0.007, flatTop + (bottom - 0.010 - flatTop) * eyeBand);
    out[1] = bottom;
  }

  function warpEyesAndBrows(u, v, expression, gaze, blink, out, index = -1) {
    let su = u, sv = v;
    const open = clamp(expression.eye * Math.max(0, (blink - 0.08) / 0.92), 0.015, 1.12);
    for (let side = 0; side < 2; side++) {
      const eye = eyes[side], p = side * 5;
      const weight = index < 0 ? falloff(u - eye[0], 0.035, 0.102)
        * falloff(v - eye[1], 0.032, 0.082) : weights[index * 8 + 2 + side];
      if (weight > 0 || (eyePose[p + 4] !== 0 && Math.abs(u - eye[0]) < 0.15 && Math.abs(v - eye[1]) < 0.22)) {
        const ix = (u - eye[0]) / 0.055, iy = (v - eye[1]) / 0.032;
        const iris = index < 0 ? Math.pow(Math.max(0, 1 - ix * ix - iy * iy), 2)
          : weights[index * 8 + 4 + side];
        if (eyePose[p + 4] === 0) {
          const upper = lids[side], lower = lowerLids[side];
          const shift = (lower - upper) * (1 - open), targetUpper = upper + shift;
          let sampleV = v;
          if (v <= targetUpper) sampleV = v - shift * falloff(v - targetUpper, 0.02, 0.105);
          else if (v < lower) sampleV = upper + (v - targetUpper)
            / Math.max(0.001, lower - targetUpper) * (lower - upper);
          su -= gaze.x * 0.006 * iris * open;
          sv += (sampleV - v) * weight + gaze.y * 0.004 * iris * open;
        } else {
          // Inverse radial rotation and a monotone lid map preserve a single
          // continuous image. Blink closes this already sculpted aperture.
          const dx = u - eye[0], dy = v - eye[1];
          const angle = eyePose[p] * falloff(Math.hypot(dx, dy), 0.065, 0.135);
          const cosine = Math.cos(angle), sine = Math.sin(angle);
          const localX = dx * cosine + dy * sine;
          let localV = eye[1] - dx * sine + dy * cosine;
          eyeAperture(side, localX, apertureBounds);
          const bottom = apertureBounds[1];
          const top = bottom - (bottom - apertureBounds[0]) * Math.min(1.12, open);
          const upper = lids[side], lower = lowerLids[side];
          const shoulder = falloff(localX, 0.040, 0.110);
          const sourceTop = top + (upper - top) * shoulder;
          const sourceBottom = bottom + (lower - bottom) * shoulder;
          if (localV <= top) localV += (sourceTop - top) * falloff(localV - top, 0.020, 0.15);
          else if (localV < bottom) localV = sourceTop + (localV - top) / (bottom - top) * (sourceBottom - sourceTop);
          else localV += (sourceBottom - bottom) * falloff(localV - bottom, 0.020, 0.15);
          let deltaU = localX - dx - clamp(gaze.x, -1, 1) * 0.006 * iris * open;
          let deltaV = localV - v + clamp(gaze.y, -1, 1) * 0.004 * iris * open;
          const activation = smooth(eyePose[p + 4] / 0.2);
          if (activation < 1) {
            // The neutral blink has a narrower legacy shoulder. Fade the
            // new shoulder in too, so a tiny edit mid-blink cannot pop it.
            const shift = (lower - upper) * (1 - open), oldTop = upper + shift;
            let oldV = v;
            if (v <= oldTop) oldV -= shift * falloff(v - oldTop, 0.02, 0.105);
            else if (v < lower) oldV = upper + (v - oldTop)
              / Math.max(0.001, lower - oldTop) * (lower - upper);
            const oldU = -gaze.x * 0.006 * iris * open;
            const oldDeltaV = (oldV - v) * weight + gaze.y * 0.004 * iris * open;
            deltaU = oldU + (deltaU - oldU) * activation;
            deltaV = oldDeltaV + (deltaV - oldDeltaV) * activation;
          }
          su += deltaU; sv += deltaV;
        }
      }
    }
    const knit = clamp(expression.browKnit ?? 0, -1, 1);
    const angle = clamp(expression.browAngle ?? 0, -1, 1);
    const tilt = clamp(expression.tilt ?? 0, -1, 1);
    for (let side = 0; side < 2; side++) {
      const inner = innerBrows[side], outer = outerBrows[side], peak = brows[side];
      const lift = clamp((side === 0 ? expression.browL : expression.browR) ?? 0, -1, 1);
      if ((!lift && !knit && !angle && !tilt) || Math.abs(su - peak[0]) > 0.24 || sv > 0.42) continue;
      // Small, sequential inverse-flow steps keep each local Jacobian positive.
      // Knit is strictly horizontal, including its negative (spread) half.
      if (knit) for (let step = 0; step < 4; step++) {
        const w = falloff(su - inner[0], 0.018, 0.100) * falloff(sv - inner[1], 0.025, 0.100);
        su -= knit * (side === 0 ? 1 : -1) * 0.030 * 0.25 * w;
      }
      if (lift || angle || tilt) for (let step = 0; step < 4; step++) {
        const t = clamp((su - inner[0]) / (outer[0] - inner[0]), 0, 1);
        const edge = t < 0.5 ? inner[1] + (peak[1] - inner[1]) * smooth(t * 2)
          : peak[1] + (outer[1] - peak[1]) * smooth((t - 0.5) * 2);
        const w = falloff(su - peak[0], 0.105, 0.190)
          * falloff(sv - edge, 0.018, 0.125);
        // Tilt keeps the old image-space slope: opposite inner/outer effects
        // on the two brows. Angle instead mirrors the two brows into a V.
        const shift = lift * 0.045 + angle * (2 * smooth(t) - 1) * 0.036
          + tilt * clamp((su - peak[0]) / 0.112, -1, 1) * 0.018;
        sv += shift * 0.25 * w;
      }
    }
    out[0] = su; out[1] = sv;
  }

  function updateWarp(expression, gaze, blink, envelope, shape) {
    const aperture = mouthAperture(envelope, shape, mouthWarpStrength);
    const mouthWidth = clamp(1 + (shape.w - 1 - shape.round * 0.035) * mouthWarpStrength
      + expression.smile * 0.05, 0.58, 1.3);
    const lipPress = 1 / (1 - shape.close * 0.18 * Math.min(mouthWarpStrength, 1.5)) - 1;
    const eyeOpen = clamp(expression.eye * Math.max(0, (blink - 0.08) / 0.92), 0.015, 1.12);
    const roundDepth = shape.round * mouthWarpStrength * 0.15;
    for (let i = 0; i < count; i++) {
      const j = i * 3, k = i * 8;
      const u = UV[i * 2], v = UV[i * 2 + 1];
      let su = u, sv = v, eyeGain = 1, eyeFocus = 0;
      let lipFocus = 0, innerLight = 0, cavity = 0;
      const mouthWeight = weights[k];
      if (mouthWeight > 0) {
        const localWidth = 1 + (mouthWidth - 1) * weights[k + 1];
        su = mouth[0] + inverseMouthX(u - mouth[0], localWidth, mouthHalf, mouthHalf + 0.07);
        const seamIndex = clamp((su - seamStart) / (seamEnd - seamStart) * 128, 0, 127.9999);
        const n = seamIndex | 0, centre = seam[n] + (seam[n + 1] - seam[n]) * (seamIndex - n);
        const mouthX = (su - mouth[0]) / mouthHalf;
        const arch = Math.pow(Math.max(0, 1 - mouthX * mouthX), 0.65);
        const smile = -expression.smile * 0.022 * Math.min(1, mouthX * mouthX)
          * (1 - shape.round * 0.65) * mouthWeight;
        // A little compression presses the photographed lip volume together
        // on m/b/p. Smile lifts the corners of the same source image.
        let relative = v - centre - smile;
        relative *= 1 + lipPress * mouthWeight;
        const upper = aperture * 0.32 * arch;
        const lower = aperture * 0.68 * arch;
        const halfSeam = 0.0028;
        let sourceRelative;
        if (relative < -halfSeam - upper) {
          sourceRelative = relative + upper
            * falloff(relative + halfSeam + upper, 0.022, 0.13);
        } else if (relative > halfSeam + lower) {
          sourceRelative = relative - lower
            * falloff(relative - halfSeam - lower, 0.025, 0.145);
        } else {
          sourceRelative = -halfSeam + (relative + halfSeam + upper)
            / (halfSeam * 2 + upper + lower) * halfSeam * 2;
        }
        sv += (centre + sourceRelative - v) * mouthWeight;
        lipFocus = arch * mouthWeight
          * smooth((Math.abs(sourceRelative) - 0.001) / 0.012)
          * falloff(sourceRelative, 0.043, 0.081);
        if (aperture > 0) {
          const above = relative + halfSeam + upper;
          const below = halfSeam + lower - relative;
          const parting = smooth(aperture / 0.017) * arch * mouthWeight;
          cavity = smooth(above / 0.008) * smooth(below / 0.008) * parting;
          const edgeDistance = Math.min(Math.abs(above), Math.abs(below));
          innerLight = Math.pow(Math.max(0, 1 - edgeDistance / 0.015), 2) * parting;
        }
      }

      // Mouth sampling is composed unchanged with the eye/brow map.
      warpEyesAndBrows(u, v, expression, gaze, blink, warped, i);
      su += warped[0] - u; sv += warped[1] - v;
      for (let side = 0; side < 2; side++) {
        const iris = weights[k + 4 + side];
        eyeGain -= (1 - Math.min(1, eyeOpen)) * 0.78 * iris;
        eyeFocus += iris * eyeOpen;
      }

      const f = i * 5;
      samplePositions[i * 2] = su; samplePositions[i * 2 + 1] = sv;
      featureLight[f] = eyeGain; featureLight[f + 1] = eyeFocus;
      featureLight[f + 2] = lipFocus; featureLight[f + 3] = innerLight;
      featureLight[f + 4] = cavity;
      FACE[j + 2] = (MAP_DEPTH[i] - 0.5) * depthAmount + roundDepth * mouthWeight;
    }
  }

  function updateColours(clock) {
    const contrast = clamp(definition, 0, 1);
    const floor = clamp(brightnessFloor, 0, 0.35);
    const breathSine = Math.sin(clock * 0.19), breathCosine = Math.cos(clock * 0.19);
    const colourBreath = reduce ? 0 : breathAmount;
    for (let i = 0; i < count; i++) {
      const j = i * 3, f = i * 5;
      const eyeGain = featureLight[f], eyeFocus = featureLight[f + 1];
      const lipFocus = featureLight[f + 2], innerLight = featureLight[f + 3];
      const cavity = featureLight[f + 4];
      sampleRGB(colour, samplePositions[i * 2], samplePositions[i * 2 + 1], FACE_COL, j);
      const sampledR = FACE_COL[j] * Math.max(0.1, eyeGain);
      const sampledG = FACE_COL[j + 1] * Math.max(0.1, eyeGain);
      const sampledB = FACE_COL[j + 2] * Math.max(0.1, eyeGain);
      const r = average[0] + (sampledR - average[0]) * contrast;
      const g = average[1] + (sampledG - average[1]) * contrast;
      const b = average[2] + (sampledB - average[2]) * contrast;
      const peak = Math.max(r, g, b, 0.001);
      const luma = r * 0.25 + g * 0.5 + b * 0.25;
      const field = FIELD ? FIELD[i] : 0.5;
      const protect = PROTECT ? PROTECT[i] : Math.min(1, lipFocus + eyeFocus);
      // Features retain the source plate's detail while the surrounding field
      // keeps its broad palette and brightness variation.
      let featureGain = protectedGain[i], paletteMix = protectedTintMix[i];
      if (!PROTECT) {
        featureGain = 1 + (starGain[i] - 1) * (1 - protect * 0.88);
        paletteMix = tintMix[i] * (1 - protect * 0.86);
      }
      const breath = (breathSin[i] * breathCosine + breathCos[i] * breathSine) * colourBreath;
      // Placement supplies the broad clumps. Only the low-noise shadow pockets
      // breathe here, and protected landmarks keep their original density.
      const gap = smooth((0.47 - field + breath * 0.026) / 0.3)
        * (1 - protect) * (1 - Math.min(1, luma * 1.4));
      const occupancy = faceDensity * Math.max(0.42, 1 - messiness * 0.72 * gap);
      const density = occupancy >= 1 ? 1 : occupancy <= 0 ? 0
        : smooth((occupancy - DENSITY_RANDOM[i]) * 20 + 0.5);
      const clump = Math.max(0.4, 1 + messiness * ((field - 0.5) * 0.8 + breath * 0.018) * (1 - protect));
      const warmFocus = Math.max(eyeFocus * eyeGlow, (lipFocus * 0.72 + innerLight * 0.85) * lipProminence);
      const warmth = clamp(warmFocus * 0.78, 0, 0.92);
      // Deep shadows and emissive highlights remain image-led, while each
      // individual star has its own warm, white, blue or violet temperature.
      const shapedLuma = luma * (0.5 + 0.5 * Math.sqrt(Math.max(0, luma)));
      const rawLight = shapedLuma * 3.3 * featureGain * clump
        * (1 + warmFocus * 0.82 + noseLight[i] * 0.26);
      // A soft highlight shoulder preserves orange/blue star temperatures
      // instead of clipping broad forehead and cheek regions to white.
      const shoulder = Math.max(0, rawLight - 0.8);
      const light = (Math.min(0.8, rawLight) + shoulder / (1 + shoulder / 0.7))
        * (1 - cavity * 0.78);
      let glimmer = 0;
      if (SPARK_RANDOM[i] < 0.015 && sparkle > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(clock * 2.7 + P1[i]);
        glimmer = sparkle * pulse * pulse * 1.25 * (1 - protect);
      }
      const irisAmber = (irisLight[j] * 16 + irisLight[j + 1] * 1.4) * eyeGlow * contrast;
      const catchlight = irisLight[j + 2] * 10 * eyeGlow * contrast;
      // Explicit channels avoid a second hot loop and repeated channel
      // branches while retaining the same operation order and output values.
      const paletteR = STAR_TINT ? STAR_TINT[j] : floorTint[0];
      const paletteG = STAR_TINT ? STAR_TINT[j + 1] : floorTint[1];
      const paletteB = STAR_TINT ? STAR_TINT[j + 2] : floorTint[2];
      const sourceR = r / peak, sourceG = g / peak, sourceB = b / peak;
      const mixedR = sourceR + (paletteR - sourceR) * paletteMix;
      const mixedG = sourceG + (paletteG - sourceG) * paletteMix;
      const mixedB = sourceB + (paletteB - sourceB) * paletteMix;
      const tintR = mixedR + (1 - mixedR) * warmth;
      const tintG = mixedG + (0.54 - mixedG) * warmth;
      const tintB = mixedB + (0.16 - mixedB) * warmth;
      FACE_COL[j] = (floorTint[0] * floor * (1 - cavity * 0.68)
        + tintR * light * (1 - floor) + paletteR * glimmer
        + irisAmber + catchlight) * density;
      FACE_COL[j + 1] = (floorTint[1] * floor * (1 - cavity * 0.68)
        + tintG * light * (1 - floor) + paletteG * glimmer
        + irisAmber * (0.46 + irisWarmth * 0.16) + catchlight * 0.95) * density;
      FACE_COL[j + 2] = (floorTint[2] * floor * (1 - cavity * 0.68)
        + tintB * light * (1 - floor) + paletteB * glimmer
        + irisAmber * (0.085 + irisWarmth * 0.215) + catchlight * 0.78) * density;
      if (socketLift > 0 && socketLight[i] > 0) {
        const lift = socketLift * socketLight[i] * smooth((0.20 - luma) / 0.20) * 0.075 * density;
        FACE_COL[j] += lift;
        FACE_COL[j + 1] += lift * 0.62;
        FACE_COL[j + 2] += lift * 0.30;
      }
    }
  }

  // Iris light is evaluated only for the small eye neighbourhoods. It follows
  // the existing image-space gaze and closing lid, never the drifting world
  // positions, so the same home samples preserve a coherent face.
  function updateNeutralIrisLight(expression, gaze, blink) {
    const open = clamp(expression.eye * Math.max(0, (blink - 0.08) / 0.92), 0.015, 1.12);
    const visible = clamp((open - 0.015) / 0.985, 0, 1);
    for (let side = 0; side < 2; side++) {
      const p = side * 5;
      const centreU = eyes[side][0] + gaze.x * 0.006 * open;
      const centreV = lowerLids[side] - (lowerLids[side] - eyes[side][1]) * open
        - gaze.y * 0.004 * open;
      const coreHeight = 0.009 * open + 0.001;
      const haloHeight = 0.020 * open + 0.002;
      const catchHeight = 0.003 * open + 0.0007;
      const members = eyeParticles[side];
      for (let n = 0; n < members.length; n++) {
        const i = members[n], j = i * 3;
        const dx = UV[i * 2] - centreU;
        const dy = UV[i * 2 + 1] - centreV;
        const localV = UV[i * 2 + 1];
        const lower = lowerLids[side], upper = lids[side];
        const coreWidth = 0.011 * (1 + irisSoftness * 0.4);
        const haloWidth = 0.029 * (1 + irisSoftness * 0.3);
        const shapedCoreHeight = coreHeight, shapedHaloHeight = haloHeight;
        const roundCoreHeight = (shapedCoreHeight + (0.011 - shapedCoreHeight) * irisRound) * (1 + irisSoftness * 0.4);
        const roundHaloHeight = (shapedHaloHeight + (0.029 - shapedHaloHeight) * irisRound) * (1 + irisSoftness * 0.3);
        const cx = dx / coreWidth, cy = dy / roundCoreHeight;
        const hx = dx / haloWidth, hy = dy / roundHaloHeight;
        const sx = (dx + 0.0045) / 0.0042, sy = (dy + 0.0038 * open) / catchHeight;
        const core = Math.max(0, 1 - cx * cx - cy * cy);
        const halo = Math.max(0, 1 - hx * hx - hy * hy);
        const glint = Math.max(0, 1 - sx * sx - sy * sy);
        // A circular halo may meet a lid before its radial falloff finishes.
        // Clip it at that aperture, while preserving all-zero legacy light.
        let crop = 1;
        if (irisRound !== 0 || irisSoftness !== 0 || eyePose[p + 4] !== 0) {
          const top = lower - (lower - upper) * open;
          const feather = Math.min(0.004, Math.max(0.0002, (lower - top) * 0.15));
          const lidCrop = smooth((localV - top) / feather) * smooth((lower - localV) / feather);
          crop += (lidCrop - 1) * Math.max(irisRound, irisSoftness, eyePose[p + 4]);
        }
        irisLight[j] = core * core * visible * (1 - irisSoftness * 0.3) * crop;
        irisLight[j + 1] = halo * halo * visible * crop;
        irisLight[j + 2] = glint * glint * visible * (1 - irisSoftness * 0.3) * crop;
      }
    }
  }

  function updateIrisLight(expression, gaze, blink) {
    if (eyePose[4] === 0) { updateNeutralIrisLight(expression, gaze, blink); return; }
    const blend = smooth(eyePose[4] / 0.2);
    if (blend < 1) updateNeutralIrisLight(expression, gaze, blink);
    const open = clamp(expression.eye * Math.max(0, (blink - 0.08) / 0.92), 0.015, 1.12);
    // The existing blink envelope is the final light gate. Neither wide-eye
    // settings nor the laughing band can reopen a fully closed blink.
    const visible = clamp((open - 0.015) / 0.985, 0, 1);
    for (let side = 0; side < 2; side++) {
      const p = side * 5, eye = eyes[side], lower = eyePose[p + 1];
      const gx = clamp(gaze.x, -1, 1) * 0.006 * open;
      const gy = clamp(gaze.y, -1, 1) * 0.004 * open;
      const broad = smooth(lower);
      const width = 0.011 * (1 + irisSoftness * 0.4) + broad * 0.047;
      const haloWidth = 0.029 * (1 + irisSoftness * 0.3) + broad * 0.029;
      const members = eyeParticles[side];
      for (let n = 0; n < members.length; n++) {
        const i = members[n], j = i * 3;
        const dx = UV[i * 2] - eye[0], dy = UV[i * 2 + 1] - eye[1];
        const angle = eyePose[p] * falloff(Math.hypot(dx, dy), 0.065, 0.135);
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        const x = dx * cosine + dy * sine;
        const v = eye[1] - dx * sine + dy * cosine;
        eyeAperture(side, x, apertureBounds);
        const bottom = apertureBounds[1];
        const top = bottom - (bottom - apertureBounds[0]) * Math.min(1.12, open);
        const gap = bottom - top, feather = Math.min(0.0032, gap * 0.24);
        const crop = smooth((v - top) / feather) * smooth((bottom - v) / feather)
          * falloff(x, 0.054, 0.071);
        const originalCentre = lowerLids[side] - (lowerLids[side] - eye[1]) * open - gy;
        // Expand the existing core across the lower-lid arc. No extra points,
        // sprites or lines: these are the same stars, with a soft light field.
        const bandCentre = bottom - Math.min(0.006, gap * 0.5);
        const requestedCentre = originalCentre + (bandCentre - originalCentre) * broad;
        // Heavy upper lids mask the fixed iris instead of chasing its light
        // downwards; lower lids increasingly redistribute it into their arc.
        const constrained = clamp(requestedCentre, top + gap * 0.26, bottom - gap * 0.26);
        const centre = requestedCentre + (constrained - requestedCentre) * broad;
        const coreHeight = ((0.009 * open + 0.001)
          + (0.011 - (0.009 * open + 0.001)) * irisRound) * (1 + irisSoftness * 0.4);
        const haloHeight = ((0.020 * open + 0.002)
          + (0.029 - (0.020 * open + 0.002)) * irisRound) * (1 + irisSoftness * 0.3);
        const ch = coreHeight + (Math.max(0.0030, gap * 0.44) - coreHeight) * broad;
        const hh = haloHeight + (Math.max(0.0045, gap * 0.65) - haloHeight) * broad;
        const cx = (x - gx) / width, cy = (v - centre) / ch;
        const hx = (x - gx) / haloWidth, hy = (v - centre) / hh;
        const sx = (x - gx + 0.0045) / (0.0042 + broad * 0.024);
        const sy = (v - centre + 0.0038 * open * (1 - broad)) / (0.003 * open + 0.0007);
        const core = Math.max(0, 1 - cx * cx - cy * cy);
        const halo = Math.max(0, 1 - hx * hx - hy * hy);
        const glint = Math.max(0, 1 - sx * sx - sy * sy);
        const coreLight = core * core * visible * (1 - irisSoftness * 0.3) * crop;
        const haloLight = halo * halo * visible * crop;
        const glintLight = glint * glint * visible * (1 - irisSoftness * 0.3) * crop * (1 - broad * 0.65);
        irisLight[j] = blend < 1 ? irisLight[j] + (coreLight - irisLight[j]) * blend : coreLight;
        irisLight[j + 1] = blend < 1 ? irisLight[j + 1] + (haloLight - irisLight[j + 1]) * blend : haloLight;
        irisLight[j + 2] = blend < 1 ? irisLight[j + 2] + (glintLight - irisLight[j + 2]) * blend : glintLight;
      }
    }
  }

  function update(clock, expression, gaze, blink, envelope, shape) {
    readEyePose(expression);
    updateWarp(expression, gaze, blink, envelope, shape);
    updateIrisLight(expression, gaze, blink);
    updateColours(clock);
  }
  return { update, applyTuning };
}
