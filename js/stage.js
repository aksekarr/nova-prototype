import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGas } from './gas.js';
import { createNebulaLife, nebulaLightGLSL } from './nebula-life.js';
import { createStars } from './stars.js';
import { makeMouthPresets } from './speech-mouth.js';
import { sampleScalar } from './facesample.js';
import { FLANGER_DEFAULTS, setFlangerTuning } from './flanger.js';

const TUNING = {
  ...FLANGER_DEFAULTS,
  trailStrength: 0.72,
  bloomStrength: 0.45,
  bloomRadius: 0.35,
  bloomThreshold: 0.22,
  pointSize: 0.075,
  sizeVariation: 0.8,
  depthFade: 0.4,
  brightness: 1.1,
  gasIntensity: 0.46,
  gasScale: 1,
  dustStrength: 0.72,
  starfieldBrightness: 1,
  glintStrength: 1,
  faceFrame: 0.541,
  shapeFrame: 0.7,
  driftAmount: 1,
  lipProminence: 0.47,
  eyeGlow: 1,
  irisRound: 0.8,
  irisSoftness: 0.5,
  irisWarmth: 0.5,
  socketLift: 0.3,
  eyePose: 'content',
  poseIntensity: 0,
  autoExpressions: true,
  laughAmount: 1,
  gestureAmount: 1,
  gesture: {
    anticipation: 0.08, compress: 0.12, hold: 0.1, release: 0.25, settle: 0.4,
    amount: 0.04, chuckleScale: 0.75, widen: 0.5, overshoot: 0.2,
    coreDelay: 0.04, edgeDelay: 0.15, edgeOvershoot: 0.5
  },
  accentAmount: 1,
  accent: {
    direction: 1, amount: 0.029, attack: 0.25, hold: 0.2, release: 0.4,
    overshoot: 0.06, settle: 0.5, coreDelay: 0.02, edgeDelay: 0.12,
    edgeOvershoot: 0.5, widen: 0.5, spacing: 2.9, threshold: 0
  },
  moodAmount: 1,
  browFlashAmount: 1,
  microAmount: 1,
  micro: {
    amplitudes: { smile: 0.16, upperLid: 0.9, lowerLid: 0.45, browL: 0.216, browR: 0.216 },
    squintGain: 1.45, wideGain: 1.1,
    periods: { drift: [2, 6], quiet: [7, 13] },
    phraseLift: { browL: 0.2, browR: 0.2, upperLid: -0.1, smile: 0.1 },
    phraseAttack: 0.3, phraseRelease: 0.45, blend: 0.4, release: 0.4,
    listeningScale: 1 / 3, listeningSpeed: 0.5
  },
  // Flash response is independent of the shared pose springs.
  browFlash: { amount: { browL: 0.45, browR: 0.45, upperLid: -0.15 }, threshold: 0.22,
    minInterval: 2, chance: 0.5, attack: 0.035, hold: 0.105, release: 0.3, response: 70 },
  listening: { pose: 'content', amount: 0.25, attack: 0.8, release: 1 },
  cueMap: {
    laugh: { kind: 'laugh', pose: 'laugh', amount: 1 },
    laughs: { kind: 'laugh', pose: 'laugh', amount: 1 },
    laughing: { kind: 'laugh', pose: 'laugh', amount: 1 },
    giggles: { kind: 'laugh', pose: 'laugh', amount: 1 },
    chuckle: { kind: 'chuckle', pose: 'laugh', amount: 0.75 },
    chuckles: { kind: 'chuckle', pose: 'laugh', amount: 0.75 },
    sigh: { kind: 'sigh', pose: 'concern', amount: 0.8 },
    sighs: { kind: 'sigh', pose: 'concern', amount: 0.8 },
    curious: { kind: 'mood', pose: 'surprised', amount: 0.6 },
    thoughtful: { kind: 'mood', pose: 'thinking', amount: 0.75 },
    thinking: { kind: 'mood', pose: 'thinking', amount: 0.75 },
    cheerful: { kind: 'mood', pose: 'content', amount: 1 },
    warm: { kind: 'mood', pose: 'content', amount: 1 },
    warmly: { kind: 'mood', pose: 'content', amount: 1 },
    happy: { kind: 'mood', pose: 'content', amount: 1 },
    excited: { kind: 'mood', pose: 'delighted', amount: 0.9 },
    confidently: { kind: 'mood', pose: 'delighted', amount: 0.5 }
  },
  cueTiming: {
    eventAttack: 0.15, eventRelease: 0.5, laughMinimum: 1,
    laughExtension: 1, followingWordGap: 0.3, sighRelease: 0.8,
    moodAttack: 0.5, moodHold: 2, moodRelease: 1, thinkingGaze: 0.8, thinkingGazeRelease: 0.3,
    questionAttack: 0.15, questionRelease: 0.3, questionPitch: 1.5,
    interruptRelease: 0.4, replyBlend: 0.4, moodMicroSuppression: 0.4
  },
  // Fresh lab settings share the live speech defaults without mutating the driver.
  visemes: makeMouthPresets(),
  eyePoses: {
    content: {
      smile: 0.45, browL: 0, browR: 0, tilt: 0, upperLid: 0.45,
      lowerLid: 0.25, slant: 0, browKnit: 0, browAngle: -0.1, eyeAsym: 0,
      mouthOpen: 0, mouthRound: 0, mouthPress: 0, squashStretch: -0.3, headYaw: 0,
      headPitch: -1, headRoll: 1, gazeX: 0, gazeY: 0
    },
    delighted: {
      smile: 0.85, browL: 0.6, browR: 0.6, tilt: 0, upperLid: -0.6,
      lowerLid: 0.2, slant: 0, browKnit: 0, browAngle: 0, eyeAsym: 0,
      mouthOpen: 0.25, mouthRound: 0, mouthPress: 0, squashStretch: 0.2, headYaw: 0,
      headPitch: 2, headRoll: 0, gazeX: 0, gazeY: 0
    },
    laugh: {
      smile: 1, browL: 0.2, browR: 0.2, tilt: 0, upperLid: 0.6,
      lowerLid: 1, slant: 0, browKnit: 0, browAngle: 0, eyeAsym: 0,
      mouthOpen: 0.5, mouthRound: 0, mouthPress: 0, squashStretch: -1, headYaw: 0,
      headPitch: 4, headRoll: 0, gazeX: 0, gazeY: 0
    },
    cheeky: {
      smile: 0.4, browL: 0, browR: 0, tilt: 0.3, upperLid: 0.35,
      lowerLid: 0.2, slant: 0, browKnit: 0, browAngle: 0, eyeAsym: 0,
      mouthOpen: 0, mouthRound: 0, mouthPress: 0, squashStretch: 0, headYaw: 0,
      headPitch: 0, headRoll: -1.5, gazeX: 0.6, gazeY: 0
    },
    skeptical: {
      smile: -0.1, browL: -0.5, browR: 0.4, tilt: 0, upperLid: 0.3,
      lowerLid: 0, slant: 0, browKnit: 0, browAngle: 0, eyeAsym: 0.3,
      mouthOpen: 0, mouthRound: 0, mouthPress: 0, squashStretch: 0, headYaw: 0,
      headPitch: -1, headRoll: 1.5, gazeX: -0.5, gazeY: 0
    },
    thinking: {
      smile: -0.05, browL: -0.35, browR: -0.35, tilt: 0, upperLid: 0.4,
      lowerLid: 0.35, slant: 0, browKnit: 0.8, browAngle: 0, eyeAsym: 0,
      mouthOpen: 0, mouthRound: 0, mouthPress: 0.5, squashStretch: 0, headYaw: 0,
      headPitch: -2, headRoll: 0, gazeX: 0, gazeY: -0.15
    },
    surprised: {
      smile: 0, browL: 0.8, browR: 0.8, tilt: 0, upperLid: -1,
      lowerLid: 0, slant: 0, browKnit: 0, browAngle: -0.2, eyeAsym: 0,
      mouthOpen: 0.35, mouthRound: 0.6, mouthPress: 0, squashStretch: 0.85, headYaw: 0,
      headPitch: 2, headRoll: 0, gazeX: 0, gazeY: 0
    },
    concern: {
      smile: -0.1, browL: 0.15, browR: 0.15, tilt: 0, upperLid: 0.3,
      lowerLid: 0.1, slant: 0, browKnit: 0.2, browAngle: -0.7, eyeAsym: 0,
      mouthOpen: 0, mouthRound: 0, mouthPress: 0, squashStretch: 0, headYaw: 0,
      headPitch: -1, headRoll: 1.5, gazeX: 0, gazeY: 0
    },
  },
  dissolveAmount: 1,
  definition: 1,
  brightnessFloor: 0.025,
  faceDensity: 0.9,
  depthAmount: 1.6,
  mouthWarpStrength: 1,
  headAmount: 1,
  nodAmount: 1,
  rollAmount: 0.7,
  headDepth: 2.41,
  swarm: 0.42,
  swarmCoherence: 0.13,
  surroundWeight: 0,
  blinkRate: 17,
  sparkle: 0.12,
  messiness: 0.76,
  faceDrift: 1,
  edgeFlowSpeed: 1,
  breath: 1,
  filamentAmount: 1,
  starSizeSpread: 1,
  gasWrap: 1
};
const BLOOM_RESOLUTION_SCALE = 0.5;

export function startStage({ shapes, reduce, state, updateFace, onFrame, applyFaceTuning, speechLab, orbital = null, formMorph = null, idleForm = orbital, nebulaEnhancement = false }) {
  const { N, FEATURE_END = 0, PH, RATE, FACE, FACE_COL, SIZE, NEB, NEB_COL, TREE, TREE_COL } = shapes;
  const hasFace = Boolean(shapes.MAPS);
  const canvas = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  // r128 wrote linear colours directly; keep that output and the same clear colour.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(new THREE.Color().setHex(0x04060c, THREE.LinearSRGBColorSpace), 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  let baseZ = 16;
  const slope = Math.tan(camera.fov * Math.PI / 360);
  updateFace(0, state.clock);
  const headDisplay = shapes.headDisplay;
  const faceSamples = hasFace ? new Float32Array(shapes.BASE) : null;
  const nebulaLife = nebulaEnhancement ? createNebulaLife(scene, NEB, PH, reduce) : null;
  const gas = createGas(scene, nebulaLife?.uniforms);
  const stars = createStars(scene);

  const POS = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) POS[i] = NEB[i];
  // Simulation stays in local coordinates; head motion is applied only to the
  // displayed copy, after every particle has followed its original easing.
  const DISPLAY_POS = new Float32Array(POS);
  const COL = new Float32Array(NEB_COL);
  // Track the same per-particle easing for the atmospheric crossfades.
  const gasWeight = new Float32Array(N).fill(1);
  const nebulaWeight = new Float32Array(N).fill(1);
  const cameraDepth = new Float32Array(N).fill(baseZ);
  const frameRates = new Float32Array(N);
  const screenPoints = new Float32Array(N * 2);
  const frameTargets = new Float32Array(N * 3);
  // This display path is opt-in for the explicit face/orbit study. The voice
  // stage retains its existing local simulation and lifecycle.
  const formFaceColours = formMorph ? new Float32Array(FACE_COL) : null;
  let formMode = state.mode, formStarted = false, formAppearance = 1, formDepth = 0, formGas = 1.15;
  let formGasStart = formGas, formWrap = 1, formWrapStart = 1;
  const formClearStart = formMorph ? new Float32Array(4) : null;
  const formFeatureStart = formMorph ? new Float32Array(16) : null;
  const clipMatrix = new THREE.Matrix4();
  const clearCenter = new THREE.Vector2(0.5, 0.5);
  const clearExtent = new THREE.Vector2(0.1, 0.2);
  const featureClearance = Array.from({ length: 4 }, () => new THREE.Vector4());
  const featurePositions = hasFace ? [
    [...shapes.MAPS.landmarks.eyeL, 0.066, 0.026],
    [...shapes.MAPS.landmarks.eyeR, 0.066, 0.026],
    [shapes.MAPS.landmarks.noseBridge[0], 0.444, 0.032, 0.109],
    [...shapes.MAPS.landmarks.mouthCentre, 0.117, 0.058]
  ] : [];
  const projectPoint = new THREE.Vector3();
  let mapFitDepth = 16;
  let viewportWidth = 1, viewportHeight = 1, sized = false;
  const GLINT = new Float32Array(N);
  const largest = Array.from({ length: N }, (_, i) => i).sort((a, b) => SIZE[b] - SIZE[a] || a - b);
  for (let i = 0; i < Math.round(N * 0.005); i++) GLINT[largest[i]] = 1;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(DISPLAY_POS, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('color', new THREE.BufferAttribute(COL, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('size', new THREE.BufferAttribute(SIZE, 1));
  geom.setAttribute('glint', new THREE.BufferAttribute(GLINT, 1));
  geom.setAttribute('faceStarSize', new THREE.BufferAttribute(shapes.STAR_SIZE || SIZE, 1));
  geom.setAttribute('faceProtection', new THREE.BufferAttribute(shapes.PROTECT || new Float32Array(N), 1));
  if (nebulaLife) geom.setAttribute('nebulaHome', new THREE.BufferAttribute(NEB, 3));
  const uniforms = {
    ...nebulaLife?.uniforms,
    pointSize: { value: 0 },
    viewportHeight: { value: 1 },
    sizeVariation: { value: TUNING.sizeVariation },
    depthFade: { value: TUNING.depthFade },
    brightness: { value: TUNING.brightness },
    focusDistance: { value: baseZ },
    nebulaGlints: { value: 1 },
    glintStrength: { value: TUNING.glintStrength },
    faceDisplayMix: { value: 0 },
    starSizeSpread: { value: TUNING.starSizeSpread }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexColors: true,
    defines: nebulaLife ? { NEBULA_LIFE: 1 } : {},
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      #ifdef NEBULA_LIFE
      attribute vec3 nebulaHome;
      ${nebulaLightGLSL}
      #endif
      attribute float size;
      attribute float glint;
      attribute float faceStarSize;
      attribute float faceProtection;
      uniform float pointSize;
      uniform float viewportHeight;
      uniform float sizeVariation;
      uniform float depthFade;
      uniform float focusDistance;
      uniform float nebulaGlints;
      uniform float faceDisplayMix;
      uniform float starSizeSpread;
      varying vec3 particleColor;
      varying float particleFade;
      varying float sparkle;
      varying float spriteScale;
      varying float faceStarGlow;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float distance = max(0.1, -viewPosition.z);
        gl_Position = projectionMatrix * viewPosition;
        faceStarGlow = smoothstep(1.55, 3.0, faceStarSize) * faceDisplayMix * (1.0 - faceProtection);
        sparkle = glint * nebulaGlints + faceStarGlow;
        spriteScale = 1.0 + sparkle * 1.4;
        // The rare big stars bloom around a small core rather than becoming
        // opaque disks. Preserve a broad size range at the portrait scale.
        float compactSize = faceStarSize > 1.0 ? 1.0 + (faceStarSize - 1.0) * 0.52 : faceStarSize;
        // Retain the fine grains at the features, while suppressing oversized
        // cores and their halos so bright stars cannot obscure the lips/eyes.
        compactSize = mix(compactSize, min(compactSize, 0.85), faceProtection * 0.95);
        float starSize = max(0.18, 1.0 + (compactSize - 1.0) * starSizeSpread);
        float particleSize = mix(mix(1.0, size, sizeVariation), starSize, faceDisplayMix);
        gl_PointSize = pointSize * particleSize * viewportHeight * 0.5 / distance * spriteScale;
        particleColor = color;
        #ifdef NEBULA_LIFE
        if (lifeAmount > 0.0) {
          vec2 disk = vec2(nebulaHome.x, (nebulaHome.z * 0.852525 - nebulaHome.y * 0.522687) / 0.7);
          float flash = 0.0;
          for (int i = 0; i < 2; i++) {
            if (lifeGlow[i].w > 0.0) {
              vec3 d = position - lifeGlow[i].xyz;
              flash += exp(-dot(d, d) * 0.65) * lifeGlow[i].w;
            }
          }
          particleColor = lifeColour(color, disk, flash);
        }
        #endif
        float depth = max(0.0, distance - (focusDistance - 4.0));
        particleFade = mix(1.0, exp(-depth * 0.12), depthFade);
      }
    `,
    fragmentShader: `
      uniform float brightness;
      uniform float glintStrength;
      varying vec3 particleColor;
      varying float particleFade;
      varying float sparkle;
      varying float spriteScale;
      varying float faceStarGlow;
      void main() {
        vec2 p = (gl_PointCoord * 2.0 - 1.0) * spriteScale;
        float radius = length(p);
        float alpha = pow(max(0.0, 1.0 - radius), 1.5);
        // Large face stars retain a hot pinprick and a soft luminous skirt.
        if (faceStarGlow > 0.0) alpha += faceStarGlow * exp(-radius * radius * 2.3) * 0.22;
        // Diffraction belongs to rare stars, never to the small face grains.
        // Scaling the coordinates preserves the original round particle core.
        if (sparkle > 0.0) {
          float crossLight = exp(-abs(p.x) * 26.0 - abs(p.y) * 2.1)
                           + exp(-abs(p.y) * 26.0 - abs(p.x) * 2.1);
          alpha += sparkle * glintStrength * 0.11 * crossLight * (1.0 - smoothstep(1.6, 2.4, radius));
        }
        if (alpha <= 0.0) discard;
        gl_FragColor = vec4(particleColor * brightness * particleFade, alpha);
      }
    `
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const trails = new AfterimagePass(0);
  trails.enabled = false;
  composer.addPass(trails);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), TUNING.bloomStrength, TUNING.bloomRadius, TUNING.bloomThreshold);
  // Only the glow buffers are reduced; the particles and final output stay sharp.
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setBloomSize(
    Math.max(1, Math.round(w * BLOOM_RESOLUTION_SCALE)),
    Math.max(1, Math.round(h * BLOOM_RESOLUTION_SCALE))
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function applyTuning() {
    setFlangerTuning(TUNING);
    bloom.strength = TUNING.bloomStrength;
    bloom.radius = TUNING.bloomRadius;
    bloom.threshold = TUNING.bloomThreshold;
    uniforms.pointSize.value = TUNING.pointSize * (N > 10000 ? 1 : 1.2);
    uniforms.sizeVariation.value = TUNING.sizeVariation;
    uniforms.depthFade.value = TUNING.depthFade;
    uniforms.brightness.value = TUNING.brightness;
    uniforms.glintStrength.value = TUNING.glintStrength;
    uniforms.starSizeSpread.value = TUNING.starSizeSpread;
    gas.applyTuning(TUNING);
    stars.applyTuning(TUNING);
    applyFaceTuning(TUNING);
    fitMapFace();
  }
  applyTuning();
  if (new URLSearchParams(window.location.search).get('tune') === '1') {
    import('./tuning.js').then(({ createTuningPanel }) => createTuningPanel(TUNING,
      (_, key) => key?.startsWith('flanger') ? setFlangerTuning(TUNING) : applyTuning(), speechLab));
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight, asp = w / h;
    viewportWidth = w; viewportHeight = h;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    uniforms.viewportHeight.value = h * pixelRatio;
    camera.aspect = asp;
    baseZ = asp < 0.75 ? Math.min(26, 16 * 0.75 / asp) : 16;
    uniforms.focusDistance.value = baseZ;
    if (!sized) {
      cameraDepth.fill(baseZ);
      camera.position.z = baseZ;
      sized = true;
    }
    camera.updateProjectionMatrix();
    fitMapFace();
    gas.resize(w, h, pixelRatio, camera);
    stars.resize(w, h, pixelRatio, camera);
  }
  resize();
  if (formMorph) {
    POS.set(FACE); COL.set(FACE_COL);
    headDisplay.apply(POS, DISPLAY_POS, 1);
    uniforms.faceDisplayMix.value = 1;
    uniforms.nebulaGlints.value = 0;
    cameraDepth.fill(mapFitDepth);
    camera.position.z = mapFitDepth;
  }
  window.addEventListener('resize', resize);

  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', function (e) {
    mouse.x = e.clientX / window.innerWidth * 2 - 1;
    mouse.y = e.clientY / window.innerHeight * 2 - 1;
  });

  let last = performance.now() / 1000, rotY = 0;
  let morphMode = state.mode, morphAge = 0, morphRemaining = 0;
  const slowestMorphRate = RATE.reduce((slowest, rate) => Math.min(slowest, rate), 1);

  function updateTrails(mode, dt) {
    const changed = mode !== morphMode;
    if (changed) {
      morphMode = mode;
      morphAge = 0;
      morphRemaining = 1;
    }
    morphAge += dt;
    // Follow the slowest particle's original morph easing, not the moving
    // face targets. Use wall time so trails end before the speech timers even
    // when a slow frame caps the particle simulation's dt.
    morphRemaining *= Math.pow(1 - slowestMorphRate, dt * 60);
    const envelope = THREE.MathUtils.smoothstep(morphAge, 0, 0.18)
      * THREE.MathUtils.smoothstep(morphRemaining, 0.09, 0.5);
    const strength = reduce || (mode === 'face' && state.speaking)
      ? 0 : TUNING.trailStrength * envelope;
    // A zero-damp first frame replaces stale history, including interrupted
    // morphs. At rest bypass the pass entirely, leaving the face exactly crisp.
    trails.uniforms.damp.value = strength > 0 && trails.enabled && !changed
      ? Math.pow(strength, dt * 60) : 0;
    trails.enabled = strength > 0;
  }

  function tiltPreviewPoint() {
    if (!formMorph) return;
    const { x, y, z } = projectPoint;
    const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(formTilt), sx = Math.sin(formTilt);
    const tz = z * cy - x * sy;
    projectPoint.set(x * cy + z * sy, y * cx - tz * sx, y * sx + tz * cx);
  }

  function projectClearance(settledFace = state.mode === 'face') {
    camera.updateMatrixWorld();
    points.updateMatrixWorld();
    clipMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(points.matrixWorld);
    if (settledFace) {
      // Only these small feature islands exclude gas. The temples, cheeks and
      // fraying silhouette remain part of the surrounding cosmic field.
      for (let i = 0; i < featurePositions.length; i++) {
        const [u, v, rx, ry] = featurePositions[i], scale = shapes.MAP_SCALE;
        const x = (u - 0.5) * scale, y = (0.5 - v) * scale;
        const z = (sampleScalar(shapes.MAPS.depth, u, v) - 0.5) * TUNING.depthAmount;
        projectPoint.set(x, y, z);
        headDisplay?.transformPoint(projectPoint);
        tiltPreviewPoint();
        projectPoint.applyMatrix4(clipMatrix);
        const sx = projectPoint.x * 0.5 + 0.5, sy = projectPoint.y * 0.5 + 0.5;
        projectPoint.set(x + rx * scale, y, z);
        headDisplay?.transformPoint(projectPoint);
        tiltPreviewPoint();
        projectPoint.applyMatrix4(clipMatrix);
        const rightX = projectPoint.x * 0.5 + 0.5 - sx, rightY = projectPoint.y * 0.5 + 0.5 - sy;
        projectPoint.set(x, y + ry * scale, z);
        headDisplay?.transformPoint(projectPoint);
        tiltPreviewPoint();
        projectPoint.applyMatrix4(clipMatrix);
        featureClearance[i].set(sx, sy,
          Math.hypot(rightX, projectPoint.x * 0.5 + 0.5 - sx),
          Math.hypot(rightY, projectPoint.y * 0.5 + 0.5 - sy));
      }
      projectPoint.set(0, 0, 0);
      headDisplay?.transformPoint(projectPoint);
      tiltPreviewPoint();
      projectPoint.applyMatrix4(clipMatrix);
      clearCenter.set(projectPoint.x * 0.5 + 0.5, projectPoint.y * 0.5 + 0.5);
      clearExtent.set(TUNING.faceFrame / camera.aspect * 0.53, TUNING.faceFrame * 0.6);
      return;
    }
    const m = clipMatrix.elements;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0, j = 0; i < N; i++, j += 3) {
      const x = DISPLAY_POS[j], y = DISPLAY_POS[j + 1], z = DISPLAY_POS[j + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.1) { screenPoints[i * 2] = NaN; continue; }
      const sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5;
      const sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5 + 0.5;
      screenPoints[i * 2] = sx; screenPoints[i * 2 + 1] = sy;
      minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
    }
    if (!Number.isFinite(minX)) return;
    clearCenter.set((minX + maxX) * 0.5, (minY + maxY) * 0.5);
    const rx = Math.max(0.001, (maxX - minX) * 0.5);
    const ry = Math.max(0.001, (maxY - minY) * 0.5);
    let radiusSquared = 1;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(screenPoints[i * 2])) continue;
      const x = (screenPoints[i * 2] - clearCenter.x) / rx;
      const y = (screenPoints[i * 2 + 1] - clearCenter.y) / ry;
      radiusSquared = Math.max(radiusSquared, x * x + y * y);
    }
    // Enclose the complete silhouette, then leave room for bloom before the
    // feather starts. Reused buffers keep this independent of the shape's name.
    const margin = Math.sqrt(radiusSquared) * 1.12;
    clearExtent.set(rx * margin + 12 / viewportWidth, ry * margin + 12 / viewportHeight);
  }

  function fitFormHeight(distance, fraction, count = N) {
    // Refine the conservative fit against the actual projected top and bottom.
    // Two Newton steps avoid wasting height on asymmetric canopy/root bounds.
    for (let pass = 0; pass < 2; pass++) {
      let top = -Infinity, bottom = Infinity, topDerivative = 0, bottomDerivative = 0, nearest = 0;
      for (let j = 0; j < count * 3; j += 3) {
        const y = frameTargets[j + 1], z = frameTargets[j + 2];
        const inverseDepth = 1 / Math.max(0.1, distance - z);
        const projected = y * inverseDepth;
        const derivative = -projected * inverseDepth;
        if (projected > top) { top = projected; topDerivative = derivative; }
        if (projected < bottom) { bottom = projected; bottomDerivative = derivative; }
        nearest = Math.max(nearest, z);
      }
      const derivative = topDerivative - bottomDerivative;
      if (Math.abs(derivative) < 0.00001) break;
      distance = Math.max(nearest + 0.5, distance - (top - bottom - 2 * slope * fraction) / derivative);
    }
    return distance;
  }

  function fitMapFace() {
    if (!hasFace) return;
    const heightSlope = slope * TUNING.faceFrame;
    const widthSlope = slope * camera.aspect * 0.92;
    const widthGuard = Math.sqrt(1 + 1 / (widthSlope * widthSlope));
    let height = 0, width = 0;
    for (let i = 0, j = 0; i < FEATURE_END; i++, j += 3) {
      const x = faceSamples[j], y = faceSamples[j + 1];
      const z = (shapes.MAP_DEPTH[i] - 0.5) * TUNING.depthAmount;
      frameTargets[j] = x; frameTargets[j + 1] = y; frameTargets[j + 2] = z;
      height = Math.max(height, z + Math.abs(y) / heightSlope);
      width = Math.max(width, Math.hypot(x, z) * widthGuard);
    }
    mapFitDepth = Math.max(4, fitFormHeight(height, TUNING.faceFrame, FEATURE_END), width);
  }

  function frameFormMorph(dt, elapsed, mode, clock) {
    const changed = mode !== formMode;
    if (changed) {
      // Preview vertices are always in display coordinates, including their
      // head and pointer rotation. Snapshot the exact last rendered frame.
      formMorph.begin(DISPLAY_POS, COL, clock, { reverse: mode === 'face', ...idleForm.morphOptions?.() });
      formMode = mode; formStarted = true;
      formAppearance = uniforms.faceDisplayMix.value;
      formDepth = camera.position.z;
      formGasStart = formGas; formWrapStart = formWrap;
      formClearStart[0] = clearCenter.x; formClearStart[1] = clearCenter.y;
      formClearStart[2] = clearExtent.x; formClearStart[3] = clearExtent.y;
      for (let i = 0; i < featureClearance.length; i++) featureClearance[i].toArray(formFeatureStart, i * 4);
    }
    let targetPositions, targetColours;
    if (mode === 'face') {
      const fastColour = 1 - Math.exp(-dt / 0.018);
      for (let i = 0, j = 0; i < N; i++, j += 3) {
        const k = 1 - Math.pow(1 - (i < FEATURE_END ? 0.45 : RATE[i]), dt * 60);
        if (shapes.RECYCLED?.[i]) {
          POS[j] = FACE[j]; POS[j + 1] = FACE[j + 1]; POS[j + 2] = FACE[j + 2];
          formFaceColours[j] = formFaceColours[j + 1] = formFaceColours[j + 2] = 0;
        }
        for (let c = 0; c < 3; c++) {
          POS[j + c] += (FACE[j + c] - POS[j + c]) * k;
          formFaceColours[j + c] += (FACE_COL[j + c] - formFaceColours[j + c]) * (i < FEATURE_END ? fastColour : k);
        }
      }
      headDisplay.apply(POS, frameTargets, 1);
      rotY += (mouse.x * 0.22 - rotY) * Math.min(1, dt * 2);
      // Bake the same pointer tilt into the live target. The Points object
      // stays at identity, so no head transform is applied twice on reversal.
      formTilt += (mouse.y * 0.08 - formTilt) * Math.min(1, dt * 2);
      const cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(formTilt), sx = Math.sin(formTilt);
      for (let j = 0; j < N * 3; j += 3) {
        const x = frameTargets[j], y = frameTargets[j + 1], z = frameTargets[j + 2];
        const tz = z * cy - x * sy;
        frameTargets[j] = x * cy + z * sy;
        frameTargets[j + 1] = y * cx - tz * sx;
        frameTargets[j + 2] = y * sx + tz * cx;
      }
      targetPositions = frameTargets; targetColours = formFaceColours;
    } else {
      targetPositions = idleForm.positions; targetColours = idleForm.colours;
    }
    if (formStarted && (formMorph.active || mode !== 'face')) {
      formMorph.sample(clock, targetPositions, targetColours);
      DISPLAY_POS.set(formMorph.positions); COL.set(formMorph.colours);
    } else {
      DISPLAY_POS.set(targetPositions); COL.set(targetColours);
    }
    const progress = formStarted ? formMorph.progress : 1;
    const ease = formStarted ? formMorph.blend : 1;
    uniforms.faceDisplayMix.value = formStarted
      ? formAppearance + ((mode === 'face' ? 1 : 0) - formAppearance) * ease : 1;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;
    const orbitSlope = slope * Math.min(0.84, camera.aspect * 0.84);
    const targetDepth = mode === 'face' ? mapFitDepth : idleForm.cameraDepth?.(camera.aspect, slope)
      ?? idleForm.bounds.radius * Math.sqrt(1 + 1 / (orbitSlope * orbitSlope));
    camera.position.z = formMorph.active ? formDepth + (targetDepth - formDepth) * ease
      : camera.position.z + (targetDepth - camera.position.z) * Math.min(1, dt * 3);
    camera.position.x += (mouse.x * 0.6 - camera.position.x) * Math.min(1, dt * 1.5);
    camera.position.y += (-mouse.y * 0.4 - camera.position.y) * Math.min(1, dt * 1.5);
    uniforms.focusDistance.value = camera.position.z;
    camera.lookAt(0, 0, 0);
    // Fade the atmosphere from its exact current mask. The destination uses
    // the moving orbital silhouette or the fully posed face landmarks.
    projectClearance(mode === 'face');
    if (formMorph.active) {
      clearCenter.set(formClearStart[0] + (clearCenter.x - formClearStart[0]) * ease,
        formClearStart[1] + (clearCenter.y - formClearStart[1]) * ease);
      clearExtent.set(formClearStart[2] + (clearExtent.x - formClearStart[2]) * ease,
        formClearStart[3] + (clearExtent.y - formClearStart[3]) * ease);
      for (let i = 0; i < featureClearance.length; i++) {
        const feature = featureClearance[i], j = i * 4;
        feature.set(formFeatureStart[j] + (feature.x - formFeatureStart[j]) * ease,
          formFeatureStart[j + 1] + (feature.y - formFeatureStart[j + 1]) * ease,
          formFeatureStart[j + 2] + (feature.z - formFeatureStart[j + 2]) * ease,
          formFeatureStart[j + 3] + (feature.w - formFeatureStart[j + 3]) * ease);
      }
    }
    formWrap = formStarted ? formWrapStart + ((mode === 'face' ? 1 : 0) - formWrapStart) * ease : 1;
    const targetGas = mode === 'face' ? 0.25 + TUNING.gasWrap * 0.9 : 0.3;
    formGas = formStarted ? formGasStart + (targetGas - formGasStart) * ease : targetGas;
    stars.update(clock, reduce);
    gas.update(dt, clock * (reduce ? 0.4 : 1), clock * 0.025, formGas, 1, 0, clearCenter, clearExtent,
      formWrap * Math.min(1, TUNING.gasWrap), featureClearance);
    gas.render(renderer);
    // Catch the initial rush, then let the new form resolve cleanly. Matching
    // the old nebula's early trails avoids a second flourish after arrival.
    const trail = reduce || !formMorph.active ? 0
      : 0.65 * THREE.MathUtils.smoothstep(progress, 0, 0.035) * Math.pow(1 - ease, 0.35);
    trails.uniforms.damp.value = trail > 0 && trails.enabled && !changed ? Math.pow(trail, elapsed * 60) : 0;
    trails.enabled = trail > 0;
    composer.render();
  }
  let formTilt = 0;

  function frame(nowMs) {
    const now = nowMs / 1000, elapsed = now - last, dt = Math.min(0.05, elapsed);
    last = now;
    state.clock += dt;
    const { mode, modeT, clock } = state;
    onFrame(dt, clock);
    updateFace(dt, clock);
    if (formMorph && mode !== 'face') idleForm.update(clock);
    else if (mode === 'orbit') orbital.update(clock);
    if (formMorph) {
      frameFormMorph(dt, elapsed, mode, clock);
      requestAnimationFrame(frame);
      return;
    }

    const speed = reduce ? 0.4 : 1;
    const aN = clock * 0.025 * speed, cN = Math.cos(aN), sN = Math.sin(aN);
    const aT = (clock - modeT) * 0.22 * speed, cT = Math.cos(aT), sT = Math.sin(aT);
    const orbitFollow = mode === 'orbit' ? THREE.MathUtils.smoothstep(clock - modeT, 0, 1.1) : 0;
    const ramp = mode === 'face' ? Math.min(1, Math.max(0, (clock - modeT - 1.6) / 1.2)) : 0;
    const shimmer = reduce ? 0.004 : 0.012, t2 = clock * 2;
    const f60 = dt * 60;
    const fastColourRate = 1 - Math.exp(-dt / 0.018);
    const settledPositionRate = 1 - Math.pow(0.55, f60);
    const targetCol = mode === 'orbit' ? orbital.colours
      : mode === 'nebula' ? NEB_COL : mode === 'tree' ? TREE_COL : FACE_COL;
    const targetGas = mode === 'nebula' ? 1 : mode === 'face' ? 0.25 + TUNING.gasWrap * 0.9 : mode === 'orbit' ? 0.3 : 0.5;
    const targetNebula = mode === 'nebula' ? 1 : 0;
    const recycled = mode === 'face' && clock - modeT > 3.5 ? shapes.RECYCLED : null;
    let gasSum = 0, nebulaSum = 0, fitHeight = 0, fitWidth = 0;
    const frameHeight = mode === 'face' ? TUNING.faceFrame : TUNING.shapeFrame;
    const heightSlope = slope * frameHeight;
    const widthSlope = slope * camera.aspect * 0.86;
    const widthGuard = Math.sqrt(1 + 1 / (widthSlope * widthSlope));

    const wantY = mode === 'face' ? mouse.x * 0.22 : 0;
    rotY += (wantY - rotY) * Math.min(1, dt * 2);
    points.rotation.y = rotY;
    points.rotation.x += ((mode === 'face' ? mouse.y * 0.08 : 0) - points.rotation.x) * Math.min(1, dt * 2);

    for (let i = 0, j = 0; i < N; i++, j += 3) {
      let tx, ty, tz, bx, by, bz;
      if (mode === 'nebula') {
        bx = NEB[j]; by = NEB[j + 1]; bz = NEB[j + 2];
        tx = bx * cN - bz * sN; tz = bx * sN + bz * cN;
        ty = by + Math.sin(clock * 0.35 + PH[i]) * 0.22 * speed;
      } else if (mode === 'orbit') {
        tx = orbital.positions[j]; ty = orbital.positions[j + 1]; tz = orbital.positions[j + 2];
      } else if (mode === 'tree') {
        bx = TREE[j]; by = TREE[j + 1]; bz = TREE[j + 2];
        tx = bx * cT - bz * sT; tz = bx * sT + bz * cT;
        ty = by + Math.sin(t2 + PH[i]) * shimmer;
      } else {
        tx = FACE[j]; ty = FACE[j + 1]; tz = FACE[j + 2];
      }
      if (mode === 'tree') {
        frameTargets[j] = tx; frameTargets[j + 1] = ty; frameTargets[j + 2] = tz;
        fitHeight = Math.max(fitHeight, tz + Math.abs(ty) / heightSlope);
        // Fit every orientation on narrow screens, without chasing the tree's
        // rotating width and clipping while the camera catches up.
        fitWidth = Math.max(fitWidth, Math.hypot(tx, tz) * widthGuard);
      }
      let rate = RATE[i];
      if (mode === 'orbit') rate += (0.16 - rate) * orbitFollow;
      if (i < FEATURE_END && ramp > 0) rate = rate + (0.45 - rate) * ramp;
      const k = i < FEATURE_END && ramp === 1 ? settledPositionRate : 1 - Math.pow(1 - rate, f60);
      frameRates[i] = k;
      if (recycled && recycled[i]) {
        // A streaming star wraps only after fading out. Move its invisible
        // sprite directly to the new root instead of easing across the face.
        POS[j] = tx; POS[j + 1] = ty; POS[j + 2] = tz;
        COL[j] = 0; COL[j + 1] = 0; COL[j + 2] = 0;
      }
      POS[j] += (tx - POS[j]) * k;
      POS[j + 1] += (ty - POS[j + 1]) * k;
      POS[j + 2] += (tz - POS[j + 2]) * k;
      // The image resolves locally as each display particle reaches its tile.
      // Once formed, fast colour tracking preserves the voice and blink timing.
      let colourRate = k, light = 1;
      if (mode === 'face' && i < FEATURE_END) {
        const dx = tx - POS[j], dy = ty - POS[j + 1], dz = tz - POS[j + 2];
        const settled = 1 / (1 + (dx * dx + dy * dy + dz * dz) * 2.5);
        light = 0.08 + 0.92 * settled;
        colourRate = k + (fastColourRate - k) * ramp * settled;
      }
      COL[j] += (targetCol[j] * light - COL[j]) * colourRate;
      COL[j + 1] += (targetCol[j + 1] * light - COL[j + 1]) * colourRate;
      COL[j + 2] += (targetCol[j + 2] * light - COL[j + 2]) * colourRate;
      gasWeight[i] += (targetGas - gasWeight[i]) * k;
      nebulaWeight[i] += (targetNebula - nebulaWeight[i]) * k;
      gasSum += gasWeight[i];
      nebulaSum += nebulaWeight[i];
    }
    const nebulaProgress = nebulaSum / N;
    const nebulaMix = nebulaProgress < 0.0001 ? 0 : nebulaProgress > 0.9999 ? 1 : nebulaProgress;
    uniforms.nebulaGlints.value = nebulaMix;
    uniforms.faceDisplayMix.value += ((mode === 'face' ? 1 : 0) - uniforms.faceDisplayMix.value) * Math.min(1, dt * 3);
    const headMix = uniforms.faceDisplayMix.value;
    if (headDisplay) headDisplay.apply(POS, DISPLAY_POS, headMix);
    else DISPLAY_POS.set(POS);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;

    if (mode === 'tree') fitHeight = fitFormHeight(fitHeight, frameHeight);
    // Fit the whole moving orbital volume without chasing its silhouette.
    const orbitSlope = slope * Math.min(0.84, camera.aspect * 0.84);
    const orbitDepth = mode === 'orbit' ? orbital.bounds.radius * Math.sqrt(1 + 1 / (orbitSlope * orbitSlope)) : 0;
    const targetDepth = mode === 'nebula' ? baseZ : mode === 'face' ? mapFitDepth
      : mode === 'orbit' ? orbitDepth : Math.max(4, fitHeight, fitWidth);
    let depthSum = 0;
    for (let i = 0; i < N; i++) {
      cameraDepth[i] += (targetDepth - cameraDepth[i]) * frameRates[i];
      depthSum += cameraDepth[i];
    }
    const drift = reduce ? 0 : TUNING.driftAmount * nebulaMix;
    camera.position.x += (mouse.x * 0.6 + Math.sin(clock * 0.028) * 0.55 * drift - camera.position.x) * Math.min(1, dt * 1.5);
    camera.position.y += (-mouse.y * 0.4 + Math.sin(clock * 0.019) * 0.25 * drift - camera.position.y) * Math.min(1, dt * 1.5);
    camera.position.z = depthSum / N + Math.sin(clock * 0.021) * 0.35 * drift;
    uniforms.focusDistance.value = camera.position.z;
    camera.lookAt(0, 0, 0);

    // Effect buffers follow the displayed particles, without entering their simulation.
    if (nebulaLife) {
      camera.updateMatrixWorld();
      nebulaLife.update(dt, clock, DISPLAY_POS, nebulaMix, mode === 'nebula', camera, points.rotation);
    }
    const formMix = 1 - nebulaMix;
    if (formMix > 0.0001) projectClearance();
    stars.update(clock, reduce);
    gas.update(dt, clock * speed, aN, gasSum / N, formMix, nebulaMix, clearCenter, clearExtent,
      mode === 'face' ? uniforms.faceDisplayMix.value * Math.min(1, TUNING.gasWrap) : 0, featureClearance);
    gas.render(renderer);
    updateTrails(mode, elapsed);
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { setNebulaEnhanced(value) { nebulaLife?.setEnabled(value); } };
}
