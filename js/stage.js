import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGas } from './gas.js';
import { createStars } from './stars.js';

const TUNING = {
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
  faceFrame: 0.44,
  shapeFrame: 0.7,
  driftAmount: 1
};
const BLOOM_RESOLUTION_SCALE = 0.5;

export function startStage({ shapes, reduce, state, updateFace, onFrame }) {
  const { N, FEATURE_END, PH, RATE, FACE, FACE_COL, SIZE, NEB, NEB_COL, TREE, TREE_COL } = shapes;
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
  // Calibrate against the old camera, independently for the two particle counts.
  // Keep these samples fixed so expressions and the orbiting halo cannot cause
  // the face camera to breathe. Its existing rotation remains untouched.
  updateFace(0, state.clock);
  const faceSamples = new Float32Array(FACE);
  let legacyFaceFrame = 0;
  for (let j = 0; j < faceSamples.length; j += 3) {
    legacyFaceFrame = Math.max(legacyFaceFrame, Math.abs(faceSamples[j + 1]) / ((16 - faceSamples[j + 2]) * slope));
  }
  TUNING.faceFrame = Math.round(legacyFaceFrame * 1000) / 1000;
  const gas = createGas(scene);
  const stars = createStars(scene);

  const POS = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) POS[i] = NEB[i];
  const COL = new Float32Array(NEB_COL);
  // Track the same per-particle easing for the atmospheric crossfades.
  const gasWeight = new Float32Array(N).fill(1);
  const nebulaWeight = new Float32Array(N).fill(1);
  const cameraDepth = new Float32Array(N).fill(baseZ);
  const frameRates = new Float32Array(N);
  const screenPoints = new Float32Array(N * 2);
  const frameTargets = new Float32Array(N * 3);
  const clipMatrix = new THREE.Matrix4();
  const clearCenter = new THREE.Vector2(0.5, 0.5);
  const clearExtent = new THREE.Vector2(0.1, 0.2);
  let viewportWidth = 1, viewportHeight = 1, sized = false;
  const GLINT = new Float32Array(N);
  const largest = Array.from({ length: N }, (_, i) => i).sort((a, b) => SIZE[b] - SIZE[a] || a - b);
  for (let i = 0; i < Math.round(N * 0.005); i++) GLINT[largest[i]] = 1;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(POS, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(COL, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('size', new THREE.BufferAttribute(SIZE, 1));
  geom.setAttribute('glint', new THREE.BufferAttribute(GLINT, 1));
  const uniforms = {
    pointSize: { value: 0 },
    viewportHeight: { value: 1 },
    sizeVariation: { value: TUNING.sizeVariation },
    depthFade: { value: TUNING.depthFade },
    brightness: { value: TUNING.brightness },
    focusDistance: { value: baseZ },
    nebulaGlints: { value: 1 },
    glintStrength: { value: TUNING.glintStrength }
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      attribute float glint;
      uniform float pointSize;
      uniform float viewportHeight;
      uniform float sizeVariation;
      uniform float depthFade;
      uniform float focusDistance;
      uniform float nebulaGlints;
      varying vec3 particleColor;
      varying float particleFade;
      varying float sparkle;
      varying float spriteScale;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        float distance = max(0.1, -viewPosition.z);
        gl_Position = projectionMatrix * viewPosition;
        sparkle = glint * nebulaGlints;
        spriteScale = 1.0 + sparkle * 1.4;
        gl_PointSize = pointSize * mix(1.0, size, sizeVariation) * viewportHeight * 0.5 / distance * spriteScale;
        particleColor = color;
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
      void main() {
        vec2 p = (gl_PointCoord * 2.0 - 1.0) * spriteScale;
        float radius = length(p);
        float alpha = pow(max(0.0, 1.0 - radius), 1.5);
        // A faint diffraction cross only extends the very largest nebula stars.
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
    bloom.strength = TUNING.bloomStrength;
    bloom.radius = TUNING.bloomRadius;
    bloom.threshold = TUNING.bloomThreshold;
    uniforms.pointSize.value = TUNING.pointSize * (N > 10000 ? 1 : 1.2);
    uniforms.sizeVariation.value = TUNING.sizeVariation;
    uniforms.depthFade.value = TUNING.depthFade;
    uniforms.brightness.value = TUNING.brightness;
    uniforms.glintStrength.value = TUNING.glintStrength;
    gas.applyTuning(TUNING);
    stars.applyTuning(TUNING);
  }
  applyTuning();
  if (new URLSearchParams(window.location.search).get('tune') === '1') {
    import('./tuning.js').then(({ createTuningPanel }) => createTuningPanel(TUNING, applyTuning));
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
    gas.resize(w, h, pixelRatio, camera);
    stars.resize(w, h, pixelRatio, camera);
  }
  resize();
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

  function projectClearance() {
    camera.updateMatrixWorld();
    points.updateMatrixWorld();
    clipMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(points.matrixWorld);
    const m = clipMatrix.elements;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0, j = 0; i < N; i++, j += 3) {
      const x = POS[j], y = POS[j + 1], z = POS[j + 2];
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

  function fitFormHeight(distance, fraction) {
    // Refine the conservative fit against the actual projected top and bottom.
    // Two Newton steps avoid wasting height on asymmetric canopy/root bounds.
    for (let pass = 0; pass < 2; pass++) {
      let top = -Infinity, bottom = Infinity, topDerivative = 0, bottomDerivative = 0, nearest = 0;
      for (let j = 0; j < frameTargets.length; j += 3) {
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

  function frame(nowMs) {
    const now = nowMs / 1000, elapsed = now - last, dt = Math.min(0.05, elapsed);
    last = now;
    state.clock += dt;
    const { mode, modeT, clock } = state;
    onFrame(dt, clock);
    updateFace(dt, clock);

    const speed = reduce ? 0.4 : 1;
    const aN = clock * 0.025 * speed, cN = Math.cos(aN), sN = Math.sin(aN);
    const aT = (clock - modeT) * 0.22 * speed, cT = Math.cos(aT), sT = Math.sin(aT);
    const ramp = mode === 'face' ? Math.min(1, Math.max(0, (clock - modeT - 1.6) / 1.2)) : 0;
    const shimmer = reduce ? 0.004 : 0.012, t2 = clock * 2;
    const f60 = dt * 60;
    const targetCol = mode === 'nebula' ? NEB_COL : mode === 'tree' ? TREE_COL : FACE_COL;
    const targetGas = mode === 'nebula' ? 1 : mode === 'face' ? 0.25 : 0.5;
    const targetNebula = mode === 'nebula' ? 1 : 0;
    let gasSum = 0, nebulaSum = 0, fitHeight = 0, fitWidth = 0;
    const frameHeight = mode === 'face' ? TUNING.faceFrame : TUNING.shapeFrame;
    const heightSlope = slope * frameHeight;
    // The face's spherical guard already includes its full orbiting halo;
    // a little less padding preserves the legacy portrait face size.
    const widthSlope = slope * camera.aspect * (mode === 'face' ? 0.92 : 0.86);
    const widthGuard = Math.sqrt(1 + 1 / (widthSlope * widthSlope));

    const wantY = mode === 'face' ? 0.12 * Math.sin(clock * 0.4) + mouse.x * 0.22 : 0;
    rotY += (wantY - rotY) * Math.min(1, dt * 2);
    points.rotation.y = rotY;
    points.rotation.x += ((mode === 'face' ? mouse.y * 0.08 : 0) - points.rotation.x) * Math.min(1, dt * 2);

    for (let i = 0, j = 0; i < N; i++, j += 3) {
      let tx, ty, tz, bx, by, bz;
      if (mode === 'nebula') {
        bx = NEB[j]; by = NEB[j + 1]; bz = NEB[j + 2];
        tx = bx * cN - bz * sN; tz = bx * sN + bz * cN;
        ty = by + Math.sin(clock * 0.35 + PH[i]) * 0.22 * speed;
      } else if (mode === 'tree') {
        bx = TREE[j]; by = TREE[j + 1]; bz = TREE[j + 2];
        tx = bx * cT - bz * sT; tz = bx * sT + bz * cT;
        ty = by + Math.sin(t2 + PH[i]) * shimmer;
      } else {
        tx = FACE[j]; ty = FACE[j + 1] + Math.sin(t2 + PH[i]) * shimmer; tz = FACE[j + 2];
      }
      if (mode !== 'nebula') {
        const fx = mode === 'face' ? faceSamples[j] : tx;
        const fy = mode === 'face' ? faceSamples[j + 1] : ty;
        const fz = mode === 'face' ? faceSamples[j + 2] : tz;
        frameTargets[j] = fx; frameTargets[j + 1] = fy; frameTargets[j + 2] = fz;
        fitHeight = Math.max(fitHeight, fz + Math.abs(fy) / heightSlope);
        // Fit every orientation on narrow screens, without chasing the tree's
        // rotating width and clipping while the camera catches up.
        const radius = mode === 'face' ? Math.hypot(fx, fy, fz) : Math.hypot(fx, fz);
        fitWidth = Math.max(fitWidth, radius * widthGuard);
      }
      let rate = RATE[i];
      if (i < FEATURE_END && ramp > 0) rate = rate + (0.45 - rate) * ramp;
      const k = 1 - Math.pow(1 - rate, f60);
      frameRates[i] = k;
      POS[j] += (tx - POS[j]) * k;
      POS[j + 1] += (ty - POS[j + 1]) * k;
      POS[j + 2] += (tz - POS[j + 2]) * k;
      COL[j] += (targetCol[j] - COL[j]) * k;
      COL[j + 1] += (targetCol[j + 1] - COL[j + 1]) * k;
      COL[j + 2] += (targetCol[j + 2] - COL[j + 2]) * k;
      gasWeight[i] += (targetGas - gasWeight[i]) * k;
      nebulaWeight[i] += (targetNebula - nebulaWeight[i]) * k;
      gasSum += gasWeight[i];
      nebulaSum += nebulaWeight[i];
    }
    const nebulaProgress = nebulaSum / N;
    const nebulaMix = nebulaProgress < 0.0001 ? 0 : nebulaProgress > 0.9999 ? 1 : nebulaProgress;
    uniforms.nebulaGlints.value = nebulaMix;
    geom.attributes.position.needsUpdate = true;
    geom.attributes.color.needsUpdate = true;

    if (mode !== 'nebula' && mode !== 'face') fitHeight = fitFormHeight(fitHeight, frameHeight);
    const targetDepth = mode === 'nebula' ? baseZ : Math.max(4, fitHeight, fitWidth);
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

    const formMix = 1 - nebulaMix;
    if (formMix > 0.0001) projectClearance();
    stars.update(clock, reduce);
    gas.update(dt, clock * speed, aN, gasSum / N, formMix, nebulaMix, clearCenter, clearExtent);
    gas.render(renderer);
    updateTrails(mode, elapsed);
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
