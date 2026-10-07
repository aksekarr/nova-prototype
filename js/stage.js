import * as THREE from 'three';

export function startStage({ shapes, reduce, state, updateFace, onFrame }) {
  const { N, FEATURE_END, PH, RATE, FACE, COL, NEB, TREE } = shapes;
  const canvas = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  // r128 wrote linear colours directly; keep that output and the same clear colour.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(new THREE.Color().setHex(0x04060c, THREE.LinearSRGBColorSpace), 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  let baseZ = 16;

  function resize() {
    const w = window.innerWidth, h = window.innerHeight, asp = w / h;
    renderer.setSize(w, h, false);
    camera.aspect = asp;
    baseZ = asp < 0.75 ? Math.min(26, 16 * 0.75 / asp) : 16;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = 64;
  const sx = sprite.getContext('2d');
  const grd = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  sx.fillStyle = grd;
  sx.fillRect(0, 0, 64, 64);

  const POS = new Float32Array(N * 3);
  for (let i = 0; i < N * 3; i++) POS[i] = NEB[i];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(POS, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(COL, 3));
  const mat = new THREE.PointsMaterial({
    size: N > 10000 ? 0.075 : 0.09, map: new THREE.CanvasTexture(sprite), vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  const points = new THREE.Points(geom, mat);
  scene.add(points);

  const mouse = { x: 0, y: 0 };
  window.addEventListener('pointermove', function (e) {
    mouse.x = e.clientX / window.innerWidth * 2 - 1;
    mouse.y = e.clientY / window.innerHeight * 2 - 1;
  });

  let last = performance.now() / 1000, rotY = 0;
  function frame(nowMs) {
    const now = nowMs / 1000, dt = Math.min(0.05, now - last);
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
      let rate = RATE[i];
      if (i < FEATURE_END && ramp > 0) rate = rate + (0.45 - rate) * ramp;
      const k = 1 - Math.pow(1 - rate, f60);
      POS[j] += (tx - POS[j]) * k;
      POS[j + 1] += (ty - POS[j + 1]) * k;
      POS[j + 2] += (tz - POS[j + 2]) * k;
    }
    geom.attributes.position.needsUpdate = true;

    const wantY = mode === 'face' ? 0.12 * Math.sin(clock * 0.4) + mouse.x * 0.22 : 0;
    rotY += (wantY - rotY) * Math.min(1, dt * 2);
    points.rotation.y = rotY;
    points.rotation.x += ((mode === 'face' ? mouse.y * 0.08 : 0) - points.rotation.x) * Math.min(1, dt * 2);
    camera.position.x += (mouse.x * 0.6 - camera.position.x) * Math.min(1, dt * 1.5);
    camera.position.y += (-mouse.y * 0.4 - camera.position.y) * Math.min(1, dt * 1.5);
    camera.position.z = baseZ;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
