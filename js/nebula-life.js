import * as THREE from 'three';
import { createNebulaEnergy } from './nebula-energy.js';

// Illumination only: never writes the original galaxy's positions or colours.
export const nebulaLightGLSL = `
  uniform float lifeAmount;
  uniform float lifeTime;
  uniform vec4 lifeGlow[2];
  uniform vec4 lifeGlowScreen[2];
  float lifePulse() {
    return 0.5 + 0.5 * sin(lifeTime * 0.57 + 0.3 * sin(lifeTime * 0.21));
  }
  vec3 lifeColour(vec3 base, vec2 disk, float flash) {
    float radius = length(disk);
    float angle = atan(disk.y, disk.x);
    float outer = smoothstep(1.7, 4.1, radius);
    float crest = pow(0.5 + 0.5 * sin(radius * 0.78 - angle * 2.0 - lifeTime * 0.48), 4.0);
    float echo = pow(0.5 + 0.5 * sin(radius * 0.52 + angle * 2.0 + lifeTime * 0.29), 7.0);
    float wave = (crest * 0.8 + echo * 0.35) * outer;
    float hue = 0.5 + 0.5 * sin(angle + radius * 0.23 - lifeTime * 0.13);
    vec3 tint = mix(vec3(0.10, 0.86, 1.0), vec3(0.85, 0.16, 0.95), hue);
    float light = max(base.r, max(base.g, base.b));
    vec3 addition = base * (0.12 * outer + wave * 0.28 + (1.0 - outer) * lifePulse() * 0.09)
      + tint * light * wave * 0.72
      + vec3(0.34, 0.73, 1.0) * light * flash * 1.65;
    return base + lifeAmount * addition;
  }
`;

export function createNebulaLife(scene, positions, phases, reduce) {
  const energy = createNebulaEnergy(positions, phases, { reduce });
  const uniforms = {
    lifeAmount: { value: 0 }, lifeTime: { value: 0 },
    lifeGlow: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    lifeGlowScreen: { value: [new THREE.Vector4(), new THREE.Vector4()] }
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(energy.positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('strength', new THREE.BufferAttribute(energy.strengths, 1).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float strength;
      varying float light;
      void main() {
        light = strength;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float light;
      void main() { gl_FragColor = vec4(vec3(0.43, 0.80, 1.0) * 1.6, light); }
    `
  });
  const arcs = new THREE.LineSegments(geometry, material);
  // Endpoints move within the existing nebula; avoid a stale bounding sphere.
  arcs.frustumCulled = false;
  arcs.visible = false;
  scene.add(arcs);
  const projected = new THREE.Vector3();
  let enabled = true;
  return {
    uniforms,
    setEnabled(value) { enabled = Boolean(value); },
    update(dt, clock, displayedPositions, nebulaMix, inNebula, camera, rotation) {
      const target = enabled && inNebula ? nebulaMix : 0;
      const amount = uniforms.lifeAmount.value + (target - uniforms.lifeAmount.value) * (1 - Math.exp(-dt * 6));
      uniforms.lifeAmount.value = amount < 0.0001 ? 0 : amount;
      uniforms.lifeTime.value = reduce ? 0 : clock;
      energy.update(clock, displayedPositions, uniforms.lifeAmount.value);
      arcs.rotation.copy(rotation);
      let visible = false;
      for (let i = 0; i < 2; i++) {
        const j = i * 3, strength = energy.glowStrengths[i];
        uniforms.lifeGlow.value[i].set(energy.glowPositions[j], energy.glowPositions[j + 1], energy.glowPositions[j + 2], strength);
        projected.set(energy.glowPositions[j], energy.glowPositions[j + 1], energy.glowPositions[j + 2]).applyEuler(rotation).project(camera);
        uniforms.lifeGlowScreen.value[i].set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5, 0, strength);
        visible ||= strength > 0.0001;
      }
      arcs.visible = visible;
      if (visible) {
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.strength.needsUpdate = true;
      }
    }
  };
}
