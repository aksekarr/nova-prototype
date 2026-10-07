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

// Only image coordinates and local depth change. Every face particle keeps
// its jittered-grid x/y position, including on the lids and the parted lips.
export function createMappedFace(shapes, reduce) {
  const { I, FACE, BASE, FACE_COL, BASE_COL, UV, MAP_DEPTH, DENSITY_RANDOM,
    SPARK_RANDOM, P1, P2, P3, P4, MAPS, MAP_SCALE, STAR_TINT, STAR_SIZE,
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
  const average = MAPS.average;
  const averagePeak = Math.max(...average, 0.001);
  const floorTint = average.map(value => 0.45 + value / averagePeak * 0.55);
  const starGain = new Float32Array(count), tintMix = new Float32Array(count);
  const breathSin = new Float32Array(count), breathCos = new Float32Array(count);

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
    const phase = u * 8.1 + v * 5.3 + (FIELD ? FIELD[i] * 2.5 : 0);
    breathSin[i] = Math.sin(phase); breathCos[i] = Math.cos(phase);
    for (let side = 0; side < 2; side++) {
      const eye = eyes[side], brow = brows[side];
      weights[k + 2 + side] = falloff(u - eye[0], 0.035, 0.102)
        * falloff(v - eye[1], 0.032, 0.082);
      const ix = (u - eye[0]) / 0.055, iy = (v - eye[1]) / 0.032;
      weights[k + 4 + side] = Math.pow(Math.max(0, 1 - ix * ix - iy * iy), 2);
      weights[k + 6 + side] = falloff(u - brow[0], 0.075, 0.155)
        * falloff(v - brow[1], 0.025, 0.092);
    }
  }

  let definition = 1, brightnessFloor = 0.025, faceDensity = 1;
  let depthAmount = 1.6, mouthWarpStrength = 1, sparkle = 0.15;
  let eyeGlow = 1, lipProminence = 1, dissolveAmount = 1;
  let messiness = 0.7, filamentAmount = 1;
  function applyTuning(tuning) {
    definition = tuning.definition ?? definition;
    brightnessFloor = tuning.brightnessFloor ?? brightnessFloor;
    faceDensity = tuning.faceDensity ?? faceDensity;
    depthAmount = tuning.depthAmount ?? depthAmount;
    mouthWarpStrength = tuning.mouthWarpStrength ?? mouthWarpStrength;
    sparkle = tuning.sparkle ?? sparkle;
    eyeGlow = tuning.eyeGlow ?? eyeGlow;
    lipProminence = tuning.lipProminence ?? lipProminence;
    dissolveAmount = tuning.dissolveAmount ?? dissolveAmount;
    messiness = tuning.messiness ?? messiness;
    filamentAmount = tuning.filamentAmount ?? filamentAmount;
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

      for (let side = 0; side < 2; side++) {
        const eyeWeight = weights[k + 2 + side];
        if (eyeWeight > 0) {
          const upper = lids[side], lower = lowerLids[side];
          const shift = (lower - upper) * (1 - eyeOpen);
          const targetUpper = upper + shift;
          let sampleV = v;
          if (v <= targetUpper) {
            sampleV = v - shift * falloff(v - targetUpper, 0.02, 0.105);
          } else if (v < lower) {
            sampleV = upper + (v - targetUpper) / Math.max(0.001, lower - targetUpper) * (lower - upper);
          }
          const iris = weights[k + 4 + side];
          su -= gaze.x * 0.006 * iris * eyeOpen;
          sv += (sampleV - v) * eyeWeight + gaze.y * 0.004 * iris * eyeOpen;
          eyeGain -= (1 - Math.min(1, eyeOpen)) * 0.78 * iris;
          eyeFocus += iris * eyeOpen;
        }
        const browWeight = weights[k + 6 + side];
        if (browWeight > 0) {
          const lift = side === 0 ? expression.browL : expression.browR;
          sv += (lift + expression.tilt * (u - brows[side][0]) / 0.15) / MAP_SCALE * browWeight;
        }
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
      const breath = breathSin[i] * breathCosine + breathCos[i] * breathSine;
      // Placement supplies the broad clumps. Only the low-noise shadow pockets
      // breathe here, and protected landmarks keep their original density.
      const gap = smooth((0.47 - field + breath * 0.026) / 0.3)
        * (1 - protect) * (1 - Math.min(1, luma * 1.4));
      const occupancy = faceDensity * Math.max(0.42, 1 - messiness * 0.72 * gap);
      const density = occupancy >= 1 ? 1 : occupancy <= 0 ? 0
        : smooth((occupancy - DENSITY_RANDOM[i]) * 20 + 0.5);
      const clump = Math.max(0.4, 1 + messiness * ((field - 0.5) * 0.8 + breath * 0.018) * (1 - protect * 0.7));
      const warmFocus = Math.max(eyeFocus * eyeGlow, (lipFocus * 0.72 + innerLight * 0.85) * lipProminence);
      const warmth = clamp(warmFocus * 0.78, 0, 0.92);
      // Deep shadows and emissive highlights remain image-led, while each
      // individual star has its own warm, white, blue or violet temperature.
      const shapedLuma = luma * (0.5 + 0.5 * Math.sqrt(Math.max(0, luma)));
      const rawLight = shapedLuma * 2.8 * starGain[i] * clump * (1 + warmFocus * 0.82);
      // A soft highlight shoulder preserves orange/blue star temperatures
      // instead of clipping broad forehead and cheek regions to white.
      const shoulder = Math.max(0, rawLight - 0.8);
      const light = (Math.min(0.8, rawLight) + shoulder / (1 + shoulder / 0.6))
        * (1 - cavity * 0.78);
      let glimmer = 0;
      if (SPARK_RANDOM[i] < 0.015 && sparkle > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(clock * 2.7 + P1[i]);
        glimmer = sparkle * pulse * pulse * 1.25;
      }
      for (let channel = 0; channel < 3; channel++) {
        const source = (channel === 0 ? r : channel === 1 ? g : b) / peak;
        const palette = STAR_TINT ? STAR_TINT[j + channel] : floorTint[channel];
        const mixed = source + (palette - source) * tintMix[i];
        const amber = channel === 0 ? 1 : channel === 1 ? 0.54 : 0.16;
        const tint = mixed + (amber - mixed) * warmth;
        FACE_COL[j + channel] = (floorTint[channel] * floor * (1 - cavity * 0.68)
          + tint * light * (1 - floor) + palette * glimmer) * density;
      }
    }
  }

  function updateHalo(clock) {
    const speed = reduce ? 0.4 : 1;
    for (let i = I.halo[0]; i < I.halo[1]; i++) {
      const j = i * 3, phase = clock * speed * P3[i] + P1[i];
      const motion = P2[i] * dissolveAmount;
      if (I.filaments && i >= I.filaments[0] && i < I.filaments[1]) {
        const t = P4[i], anchoredMotion = motion * t;
        // All stars of a strand share phase/speed. Broad positional noise bends
        // the strand coherently; t=0 stays attached to its sampled face root.
        const spatial = BASE[j] * 0.47 + BASE[j + 1] * 0.31;
        FACE[j] = BASE[j] + (Math.sin(phase + t * 2.1)
          + Math.sin(phase * 0.67 + spatial) * 0.36) * anchoredMotion;
        FACE[j + 1] = BASE[j + 1] + Math.sin(phase * 0.79 + t * 1.6) * anchoredMotion * 0.8;
        FACE[j + 2] = BASE[j + 2] / 1.6 * depthAmount
          + Math.cos(phase * 0.71 + t * 2.4) * anchoredMotion * 0.72;
        const membership = filamentAmount >= 1 ? 1 : filamentAmount <= 0 ? 0
          : smooth((filamentAmount - P1[i] / (Math.PI * 2)) * 5 + 0.5);
        const fade = dissolveAmount * membership * (1 + Math.max(0, filamentAmount - 1) * 0.6)
          * (1.04 + 0.24 * Math.sin(phase * 0.71 + t));
        FACE_COL[j] = BASE_COL[j] * fade;
        FACE_COL[j + 1] = BASE_COL[j + 1] * fade;
        FACE_COL[j + 2] = BASE_COL[j + 2] * fade;
        continue;
      }
      FACE[j] = BASE[j] + Math.sin(phase) * motion;
      // Upward travel eases before reversing; the loose crown never resets
      // across the face or acquires the fixed grid's rows.
      FACE[j + 1] = BASE[j + 1] + (Math.sin(phase * 0.63) + 1) * motion * (1 + P4[i]);
      FACE[j + 2] = (BASE[j + 2] / 1.6) * depthAmount + Math.cos(phase * 0.87) * motion;
      const fade = dissolveAmount * (0.72 + 0.28 * Math.sin(phase * 0.71 + P1[i])) * 2.2;
      FACE_COL[j] = BASE_COL[j] * fade;
      FACE_COL[j + 1] = BASE_COL[j + 1] * fade;
      FACE_COL[j + 2] = BASE_COL[j + 2] * fade;
    }
  }
  function update(clock, expression, gaze, blink, envelope, shape) {
    updateWarp(expression, gaze, blink, envelope, shape);
    updateColours(clock);
    updateHalo(clock);
  }
  return { update, applyTuning };
}
