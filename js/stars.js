import * as THREE from 'three';

// This stream belongs only to the backdrop; shape seeds and draw order stay intact.
function starRandom() {
  let seed = 0x5a17f13d;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createStars(scene) {
  const count = 4000;
  const random = starRandom();
  const positions = new Float32Array(count * 3);
  const coordinates = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const j = i * 3;
    coordinates[i * 2] = random() * 2 - 1;
    coordinates[i * 2 + 1] = random() * 2 - 1;
    positions[j + 2] = -35 - random() * 27;
    const tint = random();
    const light = 0.055 + Math.pow(random(), 2.5) * 0.14;
    const rgb = tint < 0.055 ? [1, 0.81, 0.61]
      : tint < 0.48 ? [0.72, 0.85, 1] : [0.91, 0.94, 1];
    colors[j] = rgb[0] * light;
    colors[j + 1] = rgb[1] * light;
    colors[j + 2] = rgb[2] * light;
    sizes[i] = 0.75 + random() * 0.75;
    phases[i] = random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));
  const uniforms = { pixelRatio: { value: 1 }, time: { value: 0 }, brightness: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float starSize;
      attribute float phase;
      uniform float pixelRatio;
      uniform float time;
      varying vec3 starColor;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(1.0, starSize * pixelRatio);
        starColor = color * (0.96 + 0.04 * sin(time * 0.12 + phase));
      }
    `,
    fragmentShader: `
      uniform float brightness;
      varying vec3 starColor;
      void main() {
        float radius = length(gl_PointCoord * 2.0 - 1.0);
        if (radius >= 1.0) discard;
        float alpha = 1.0 - smoothstep(0.0, 1.0, radius);
        gl_FragColor = vec4(starColor * brightness, alpha);
      }
    `
  });
  const stars = new THREE.Points(geometry, material);
  stars.renderOrder = -40;
  stars.frustumCulled = false;
  scene.add(stars);

  return {
    applyTuning(tuning) {
      uniforms.brightness.value = tuning.starfieldBrightness;
    },
    resize(w, h, pixelRatio, camera) {
      uniforms.pixelRatio.value = pixelRatio;
      const aspect = w / Math.max(1, h);
      const slope = Math.tan(camera.fov * Math.PI / 360);
      const cameraZ = camera.position.z || 16;
      // Extra coverage keeps the frame filled during camera parallax and slow drift.
      for (let i = 0; i < count; i++) {
        const j = i * 3;
        const height = (cameraZ - positions[j + 2]) * slope * 1.18;
        positions[j] = coordinates[i * 2] * height * aspect;
        positions[j + 1] = coordinates[i * 2 + 1] * height;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    update(clock, reduce) {
      const time = reduce ? 0 : clock;
      uniforms.time.value = time;
      stars.rotation.z = time * 0.0002;
    },
    dispose() {
      scene.remove(stars);
      geometry.dispose();
      material.dispose();
    }
  };
}
