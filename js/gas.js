import * as THREE from 'three';
import { nebulaLightGLSL } from './nebula-life.js';

// The expensive field is sampled at low resolution; the two depth planes and
// their form exclusion mask and core fade still render at full frame rate.
const FIELD_SIZE = 512;
const FIELD_INTERVAL = 1 / 12;
const fieldVertex = `
  varying vec2 fieldUV;
  void main() {
    fieldUV = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
const fieldFragment = `
  uniform float fieldTime;
  uniform float fieldLayer;
  uniform float fieldScale;
  uniform float dustStrength;
  uniform float nebulaAngle;
  uniform float fieldAspect;
  varying vec2 fieldUV;

  // Fixed hashes are the field's seed. No host RNG, textures or external assets.
  float hash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), u.x),
               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + 1.0), u.x), u.y);
  }
  float fbm(vec2 p) {
    mat2 turn = mat2(0.8, -0.6, 0.6, 0.8);
    float sum = 0.5 * noise(p);
    p = turn * p * 2.03 + 7.1;
    sum += 0.25 * noise(p);
    p = turn * p * 2.03 + 7.1;
    sum += 0.125 * noise(p);
    p = turn * p * 2.03 + 7.1;
    return sum + 0.0625 * noise(p);
  }
  float filaments(vec2 p) {
    float ridge = 1.0 - abs(noise(p) * 2.0 - 1.0);
    float fine = 1.0 - abs(noise(p * 2.09 + 19.6) * 2.0 - 1.0);
    float finest = 1.0 - abs(noise(p * 4.17 - 8.4) * 2.0 - 1.0);
    return pow(ridge, 3.5) * (0.06 + 0.64 * pow(fine, 3.0) + 0.30 * pow(finest, 5.0));
  }
  void main() {
    vec2 screen = (fieldUV * 2.0 - 1.0) * vec2(fieldAspect, 1.0);
    vec2 p = screen / max(0.2, fieldScale);
    float t = fieldTime * 0.008;
    float layer = fieldLayer;
    float ca = cos(nebulaAngle), sa = sin(nebulaAngle);

    // Project the same tilted X/Z galaxy disk as the particle targets. The
    // background planes stay at their fixed depths, even when the disk turns.
    float safeCos = (ca < 0.0 ? -1.0 : 1.0) * max(0.14, abs(ca));
    float diskZ = -p.y / (0.7 * 0.522687);
    vec2 disk = vec2((p.x + diskZ * 0.7 * 0.852525 * sa) / safeCos, diskZ);
    float radius = length(disk);
    float phase = atan(disk.y, disk.x) - radius * 4.2;
    float diskFalloff = exp(-radius * radius * 1.65);

    // A slowly turning volume of gas surrounds the flatter spiral. Two
    // independent warped fields provide broad veils and narrow, nested wisps.
    mat2 drift = mat2(cos(nebulaAngle * 0.24), -sin(nebulaAngle * 0.24),
                      sin(nebulaAngle * 0.24), cos(nebulaAngle * 0.24));
    vec2 flow = drift * p;
    vec2 cloud = flow * vec2(1.65, 2.8) + vec2(4.7, 11.3) * layer;
    vec2 warp = vec2(fbm(cloud + vec2(t, 0.0)),
                     fbm(cloud + vec2(6.3, 9.1 - t * 0.7)));
    vec2 warped = cloud * 2.0 + 3.5 * (warp - 0.5);
    vec2 fineWarp = vec2(fbm(warped + 3.1), fbm(warped - 7.8));
    float body = fbm(warped + fineWarp * 1.4 + t * 0.2);
    float ridge = filaments(warped * vec2(3.2, 5.6) + fineWarp * 2.8);
    float cloudBody = smoothstep(0.30, 0.66, body);
    float wisps = cloudBody * (0.35 + ridge * 1.7);

    // This independent, low-frequency field breaks the light into dark lanes;
    // a spiral term threads reddish-brown gaps along the galaxy's arms.
    // Shared broad cavities remain dark through both layers. Their fine edges
    // differ, so the nearby filaments still separate from the softer rear veil.
    float dustNoise = fbm(flow * vec2(2.1, 2.8) + vec2(16.4, 3.2) - t * 0.15);
    float cloudDust = smoothstep(0.40, 0.57, dustNoise);
    float brokenPhase = 3.0 * phase + (body - 0.47) * 1.25;
    float arm = pow(0.5 + 0.5 * cos(brokenPhase), 3.0);
    float thread = pow(0.5 + 0.5 * cos(brokenPhase - 0.5), 20.0)
                   * smoothstep(0.10, 0.26, radius);
    float dust = dustStrength * (cloudDust * 0.8 + thread * diskFalloff * 1.7);
    float transmission = exp(-dust * 3.5);
    float rim = exp(-pow((dustNoise - 0.425) / 0.032, 2.0)) * cloudBody;

    vec3 violet = vec3(0.40, 0.16, 0.85);
    vec3 magenta = vec3(0.84, 0.19, 0.47);
    vec3 teal = vec3(0.10, 0.75, 0.76);
    // Large colour regions are shared in world projection; avoid blending two
    // independently coloured sheets into an undifferentiated blue haze.
    float tealRegion = smoothstep(-0.32, 0.46, -flow.x - flow.y * 0.5 + (dustNoise - 0.45));
    float pinkRegion = smoothstep(-0.12, 0.46, flow.x * 0.48 - flow.y + (body - 0.45) * 0.4);
    vec3 gasColor = mix(violet, teal, tealRegion * 0.93);
    gasColor = mix(gasColor, magenta, pinkRegion * (1.0 - tealRegion * 0.8) * 0.84);
    gasColor = mix(gasColor, vec3(0.63, 0.79, 0.90), min(0.36, ridge * 0.42 + rim * 0.12));
    float cloudEnvelope = exp(-dot(p * vec2(0.78, 1.35), p * vec2(0.78, 1.35)) * 1.55);
    float depthStructure = mix(0.7, 0.30 + arm * 0.9, layer * diskFalloff);
    vec3 clouds = gasColor * (wisps * 1.4 + rim * (0.10 + ridge * 0.65))
                  * cloudEnvelope * depthStructure;
    vec3 arms = vec3(0.50, 0.70, 0.94) * arm * diskFalloff
                * (0.14 + cloudBody * 0.34 + ridge * 0.58) * smoothstep(0.02, 0.18, radius);
    vec3 color = (clouds + arms) * transmission;
    // A very dim copper scattering edge makes the otherwise black dust read
    // as matter; its interior remains several stops below the blue arm light.
    color += vec3(0.21, 0.075, 0.035) * thread * diskFalloff
             * (0.13 + ridge * 0.15) * dustStrength;

    // A small warm nucleus anchors the spiral without filling the dark sky.
    float core = exp(-radius * radius * 22.0);
    float coreEnvelope = core * (0.26 + body * 0.32)
                         * mix(1.0, transmission, smoothstep(0.05, 0.32, radius) * 0.85);
    float edge = 1.0 - smoothstep(0.70, 1.0, max(abs(fieldUV.x * 2.0 - 1.0), abs(fieldUV.y * 2.0 - 1.0)));
    // Keep the warm envelope separate so its morph fade never waits for the
    // next cached noise frame. The smaller nucleus is analytic in composite.
    gl_FragColor = vec4(color * edge, coreEnvelope * edge);
  }
`;

export function createGas(scene, lifeUniforms = null) {
  const fieldScene = new THREE.Scene();
  const fieldCamera = new THREE.Camera();
  const fieldUniforms = {
    fieldTime: { value: 0 }, fieldLayer: { value: 0 },
    fieldScale: { value: 1 }, dustStrength: { value: 0.7 },
    nebulaAngle: { value: 0 }, fieldAspect: { value: 1 }
  };
  const fieldMaterial = new THREE.ShaderMaterial({
    uniforms: fieldUniforms, vertexShader: fieldVertex, fragmentShader: fieldFragment,
    depthTest: false, depthWrite: false, toneMapped: false
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  fieldScene.add(new THREE.Mesh(geometry, fieldMaterial));
  const viewport = new THREE.Vector2(1, 1);
  const formCenter = new THREE.Vector2(0.5, 0.5);
  const formExtent = new THREE.Vector2(0.1, 0.2);
  const featureClearance = Array.from({ length: 4 }, () => new THREE.Vector4(0.5, 0.5, 0.01, 0.01));
  const layers = [
    { width: 66, height: 50, z: -24, gain: 0.64, order: -30 },
    { width: 46, height: 36, z: -12, gain: 1.0, order: -20 }
  ].map((layer, index) => {
    const target = new THREE.WebGLRenderTarget(FIELD_SIZE, FIELD_SIZE, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false
    });
    const uniforms = {
      ...lifeUniforms,
      gasMap: { value: target.texture }, gasStrength: { value: 0 },
      viewport: { value: viewport }, formCenter: { value: formCenter },
      formExtent: { value: formExtent }, formMask: { value: 0 },
      faceWrap: { value: 0 }, featureClearance: { value: featureClearance },
      coreStrength: { value: 1 }, coreAngle: { value: 0 },
      coreScale: { value: 1 }, fieldAspect: { value: layer.width / layer.height }
    };
    const material = new THREE.ShaderMaterial({
      uniforms, transparent: true, depthWrite: false,
      defines: lifeUniforms ? { NEBULA_LIFE: 1 } : {},
      blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `
        varying vec2 gasUV;
        void main() {
          gasUV = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #ifdef NEBULA_LIFE
        ${nebulaLightGLSL}
        #endif
        uniform sampler2D gasMap;
        uniform float gasStrength;
        uniform float formMask;
        uniform float coreStrength;
        uniform float coreAngle;
        uniform float coreScale;
        uniform float fieldAspect;
        uniform vec2 viewport;
        uniform vec2 formCenter;
        uniform vec2 formExtent;
        uniform float faceWrap;
        uniform vec4 featureClearance[4];
        varying vec2 gasUV;
        void main() {
          vec2 screenUV = gl_FragCoord.xy / viewport;
          vec2 form = (screenUV - formCenter) / max(formExtent, vec2(0.0001));
          float exclusion = 1.0 - formMask * (1.0 - smoothstep(1.0, 1.3, length(form)));
          if (faceWrap > 0.0) {
            float features = 0.0;
            for (int i = 0; i < 4; i++) {
              vec4 island = featureClearance[i];
              vec2 feature = (screenUV - island.xy) / max(island.zw, vec2(0.0001));
              features = max(features, 1.0 - smoothstep(0.5625, 2.25, dot(feature, feature)));
            }
            exclusion = mix(exclusion, 1.0 - formMask * features, faceWrap);
          }
          // In the portrait, pull the field into the fraying silhouette. The
          // same cached wisps wrap both sides instead of sitting far offstage.
          vec2 portraitUV = (screenUV - formCenter) / (formExtent * vec2(2.1, 2.8)) + 0.5;
          vec2 fieldUV = mix(gasUV, portraitUV, faceWrap);
          vec4 field = texture2D(gasMap, fieldUV);
          float portraitEdge = 1.0 - smoothstep(0.72, 1.0, max(abs(fieldUV.x * 2.0 - 1.0), abs(fieldUV.y * 2.0 - 1.0)));
          vec3 color = field.rgb * mix(1.0, portraitEdge * 0.8, faceWrap);
          // Reconstruct the original two-colour core independently of the
          // atmospheric field, at the angle/scale of this cached layer.
          if (coreStrength > 0.0) {
            vec2 p = (gasUV * 2.0 - 1.0) * vec2(fieldAspect, 1.0) / max(0.2, coreScale);
            float ca = cos(coreAngle), sa = sin(coreAngle);
            float safeCos = (ca < 0.0 ? -1.0 : 1.0) * max(0.14, abs(ca));
            float diskZ = -p.y / (0.7 * 0.522687);
            vec2 disk = vec2((p.x + diskZ * 0.7 * 0.852525 * sa) / safeCos, diskZ);
            float edge = 1.0 - smoothstep(0.70, 1.0, max(abs(gasUV.x * 2.0 - 1.0), abs(gasUV.y * 2.0 - 1.0)));
            float nucleus = exp(-dot(disk, disk) * 180.0) * 0.55 * edge;
            vec3 core = vec3(0.94, 0.74, 0.49) * field.a + vec3(1.0, 0.94, 0.82) * nucleus;
            #ifdef NEBULA_LIFE
            if (lifeAmount > 0.0) {
              // Light the existing cached clouds at display rate, preserving every dust gap.
              float flash = 0.0;
              for (int i = 0; i < 2; i++) {
                if (lifeGlowScreen[i].w > 0.0) {
                  vec2 d = (screenUV - lifeGlowScreen[i].xy) * vec2(viewport.x / viewport.y, 1.0);
                  flash += exp(-dot(d, d) * 150.0) * lifeGlowScreen[i].w;
                }
              }
              color = lifeColour(color, disk * 10.0, flash);
              core *= 1.0 + lifeAmount * lifePulse() * 0.08;
            }
            #endif
            color += core * coreStrength;
          }
          color = min(color, vec3(1.0));
          gl_FragColor = vec4(color * gasStrength * exclusion, 1.0);
        }
      `
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = layer.z;
    mesh.scale.set(layer.width * 0.5, layer.height * 0.5, 1);
    mesh.renderOrder = layer.order;
    scene.add(mesh);
    return { ...layer, index, target, uniforms, mesh };
  });
  let intensity = 0.3, elapsed = FIELD_INTERVAL, nextLayer = 0, dirty = true;
  const savedClearColor = new THREE.Color();

  return {
    resize(w, h, pixelRatio) {
      viewport.set(w * pixelRatio, h * pixelRatio);
    },
    applyTuning(tuning) {
      intensity = tuning.gasIntensity;
      fieldUniforms.fieldScale.value = tuning.gasScale;
      fieldUniforms.dustStrength.value = tuning.dustStrength;
      dirty = true;
    },
    update(dt, clock, nebulaAngle, gasStrength, formMask, coreStrength, clearCenter, clearExtent, faceWrap = 0, clearFeatures = null) {
      elapsed += dt;
      fieldUniforms.fieldTime.value = clock;
      fieldUniforms.nebulaAngle.value = nebulaAngle;
      formCenter.copy(clearCenter);
      formExtent.copy(clearExtent);
      if (clearFeatures) for (let i = 0; i < 4; i++) featureClearance[i].copy(clearFeatures[i]);
      for (const layer of layers) {
        layer.uniforms.gasStrength.value = intensity * gasStrength * layer.gain;
        layer.uniforms.formMask.value = formMask;
        layer.uniforms.coreStrength.value = coreStrength;
        layer.uniforms.faceWrap.value = faceWrap;
      }
    },
    render(renderer) {
      if (!dirty && elapsed < FIELD_INTERVAL) return;
      const previousTarget = renderer.getRenderTarget();
      const previousClearAlpha = renderer.getClearAlpha();
      renderer.getClearColor(savedClearColor);
      const autoClear = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      // Initialize both once; thereafter alternate to keep shader work bounded.
      const pending = dirty ? layers : [layers[nextLayer]];
      for (const layer of pending) {
        fieldUniforms.fieldLayer.value = layer.index;
        fieldUniforms.fieldAspect.value = layer.width / layer.height;
        layer.uniforms.coreAngle.value = fieldUniforms.nebulaAngle.value;
        layer.uniforms.coreScale.value = fieldUniforms.fieldScale.value;
        renderer.setRenderTarget(layer.target);
        renderer.render(fieldScene, fieldCamera);
      }
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(savedClearColor, previousClearAlpha);
      renderer.autoClear = autoClear;
      elapsed %= FIELD_INTERVAL;
      nextLayer = 1 - nextLayer;
      dirty = false;
    }
  };
}
