// Pure animation over supplied buffers. The warp runs first and writes each
// core star's fresh colour and voiced depth; fixed UVs and home colours stay put.
const TAU = Math.PI * 2;
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};

export function createFaceMotion(shapes, reduce) {
  const { I, FACE, BASE, FACE_COL, BASE_COL, P1, MAP_DEPTH, RECYCLED, MOTION } = shapes;
  const N = shapes.N ?? I.halo[1];
  const { CORE_LOOP, CORE_GROUP, EDGE_INDEX, EDGE_DATA, DETACH_INDEX, DETACH_DATA,
    FLOW_PATHS, FLOW_STEPS, FLOW_IDS, FLOW_PHASE, FLOW_RATE, FLOW_OFFSET } = MOTION;
  const count = I.face[1], filamentEnd = I.filaments[1];
  const phase = new Float32Array(FLOW_PHASE);
  const departPhase = new Float32Array(DETACH_INDEX.length);
  for (let k = 0; k < departPhase.length; k++) departPhase[k] = DETACH_DATA[k * 5];
  const sine = new Float32Array(32), cosine = new Float32Array(32);
  const flowSine = new Float32Array(32), flowCosine = new Float32Array(32);
  const DEPART_FADE = new Float32Array(N).fill(1);
  let faceDrift = 1, edgeFlowSpeed = 1, breath = 1;
  let filamentAmount = 1, dissolveAmount = 1, depthAmount = 1.6;
  let previousClock = null, life = 0, flowLife = 0;

  function applyTuning(tuning) {
    faceDrift = Math.max(0, tuning.faceDrift ?? faceDrift);
    edgeFlowSpeed = Math.max(0, tuning.edgeFlowSpeed ?? edgeFlowSpeed);
    breath = Math.max(0, tuning.breath ?? breath);
    filamentAmount = Math.max(0, tuning.filamentAmount ?? filamentAmount);
    dissolveAmount = Math.max(0, tuning.dissolveAmount ?? dissolveAmount);
    depthAmount = Math.max(0, tuning.depthAmount ?? depthAmount);
  }

  // Short independent passes let Safari optimize the hot loops promptly, and
  // keep protected home drift separate from the much smaller outgoing pools.
  function updateCore(scale, glow, drift) {
    for (let i = 0; i < count; i++) {
      const j = i * 3, k = i * 6, group = CORE_GROUP[i];
      const s = sine[group], c = cosine[group];
      const dx = (CORE_LOOP[k] * s + CORE_LOOP[k + 1] * c) * drift;
      const dy = (CORE_LOOP[k + 2] * s + CORE_LOOP[k + 3] * c) * drift;
      const dz = (CORE_LOOP[k + 4] * s + CORE_LOOP[k + 5] * c) * drift;
      // Preserve the round-mouth depth offset the image warp just supplied.
      const mappedDepth = (MAP_DEPTH[i] - 0.5) * depthAmount;
      const voicedDepth = FACE[j + 2] - mappedDepth;
      FACE[j] = BASE[j] * scale + dx;
      FACE[j + 1] = BASE[j + 1] * scale + dy;
      FACE[j + 2] = mappedDepth * scale + voicedDepth + dz;
      const light = reduce ? 1 + s * 0.003 : glow;
      FACE_COL[j] *= light; FACE_COL[j + 1] *= light; FACE_COL[j + 2] *= light;
    }

  }

  function updateEdges(dt) {
    for (let n = 0; n < EDGE_INDEX.length; n++) {
        const i = EDGE_INDEX[n], j = i * 3, k = n * 5;
        let u = phase[i] + dt * FLOW_RATE[i] * edgeFlowSpeed;
        if (u >= 1) { u -= Math.floor(u); RECYCLED[i] = 1; }
        phase[i] = u;
        const outward = u * (0.65 + u * 0.35), curl = 4 * u * (1 - u);
        FACE[j] += (EDGE_DATA[k] * outward + EDGE_DATA[k + 2] * curl) * dissolveAmount;
        FACE[j + 1] += (EDGE_DATA[k + 1] * outward + EDGE_DATA[k + 3] * curl) * dissolveAmount;
        FACE[j + 2] += EDGE_DATA[k + 4] * outward * dissolveAmount;
        const fade = smooth(u / 0.10) * (1 - smooth((u - 0.66) / 0.34));
        DEPART_FADE[i] = fade;
        FACE_COL[j] *= fade; FACE_COL[j + 1] *= fade; FACE_COL[j + 2] *= fade;
    }
  }

  function updateDepartures(dt) {
    for (let n = 0; n < DETACH_INDEX.length; n++) {
        const i = DETACH_INDEX[n], j = i * 3, k = n * 5;
        let u = departPhase[n] + dt * DETACH_DATA[k + 1] * faceDrift;
        if (u >= 1) u -= Math.floor(u);
        departPhase[n] = u;
        if (u <= 0.82 || faceDrift === 0) continue;
        const t = (u - 0.82) / 0.18;
        const out = Math.sin(Math.PI * t), excursion = out * out * faceDrift;
        FACE[j] += DETACH_DATA[k + 2] * excursion;
        FACE[j + 1] += DETACH_DATA[k + 3] * excursion;
        FACE[j + 2] += DETACH_DATA[k + 4] * excursion;
        const fade = 1 - Math.min(0.88, excursion * 0.78);
        DEPART_FADE[i] = fade;
        FACE_COL[j] *= fade; FACE_COL[j + 1] *= fade; FACE_COL[j + 2] *= fade;
    }
  }

  function updateFilaments(dt, scale, glow) {
    for (let i = I.filaments[0]; i < filamentEnd; i++) {
      const j = i * 3, group = (FLOW_IDS[i] / 3 | 0) & 31;
      const membership = filamentAmount >= 1 ? 1 : filamentAmount <= 0 ? 0
        : smooth((filamentAmount - P1[i] / TAU) * 5 + 0.5);
      const amount = dissolveAmount * membership * (1 + Math.max(0, filamentAmount - 1) * 0.6);
      let u = phase[i] + dt * FLOW_RATE[i] * edgeFlowSpeed;
      if (u >= 1) { u -= Math.floor(u); RECYCLED[i] = 1; }
      phase[i] = u;
      const t = u * (0.65 + u * 0.35), sample = t * FLOW_STEPS;
      const lower = Math.min(FLOW_STEPS - 1, Math.floor(sample)), blend = sample - lower;
      const p = (FLOW_IDS[i] * (FLOW_STEPS + 1) + lower) * 4;
      const width = FLOW_PATHS[p + 3] + (FLOW_PATHS[p + 7] - FLOW_PATHS[p + 3]) * blend;
      const x = FLOW_PATHS[p] + (FLOW_PATHS[p + 4] - FLOW_PATHS[p]) * blend + FLOW_OFFSET[j] * width;
      const y = FLOW_PATHS[p + 1] + (FLOW_PATHS[p + 5] - FLOW_PATHS[p + 1]) * blend + FLOW_OFFSET[j + 1] * width;
      const z = FLOW_PATHS[p + 2] + (FLOW_PATHS[p + 6] - FLOW_PATHS[p + 2]) * blend + FLOW_OFFSET[j + 2] * width;
      const wave = t * t * dissolveAmount;
      FACE[j] = x * scale + flowSine[group] * wave * 0.035;
      FACE[j + 1] = y * scale + flowCosine[group] * wave * 0.025;
      FACE[j + 2] = z / 1.6 * depthAmount + flowSine[group] * wave * 0.018;
      const fade = smooth(u / 0.055) * (1 - smooth((u - 0.80) / 0.20))
        * (1 - t * 0.46) * amount * glow;
      DEPART_FADE[i] = fade;
      FACE_COL[j] = BASE_COL[j] * fade;
      FACE_COL[j + 1] = BASE_COL[j + 1] * fade;
      FACE_COL[j + 2] = BASE_COL[j + 2] * fade;
    }
  }

  function updateLoose(dt, glow) {
    for (let i = filamentEnd; i < N; i++) {
      const j = i * 3;
      let u = phase[i] + dt * FLOW_RATE[i] * edgeFlowSpeed;
      if (u >= 1) { u -= Math.floor(u); RECYCLED[i] = 1; }
      phase[i] = u;
      const distance = (u - 0.5) * dissolveAmount;
      FACE[j] = BASE[j] + FLOW_OFFSET[j] * distance;
      FACE[j + 1] = BASE[j + 1] + FLOW_OFFSET[j + 1] * distance;
      FACE[j + 2] = BASE[j + 2] / 1.6 * depthAmount + FLOW_OFFSET[j + 2] * distance;
      const fade = dissolveAmount * smooth(u / 0.1) * (1 - smooth((u - 0.85) / 0.15)) * glow;
      DEPART_FADE[i] = fade;
      FACE_COL[j] = BASE_COL[j] * fade;
      FACE_COL[j + 1] = BASE_COL[j + 1] * fade;
      FACE_COL[j + 2] = BASE_COL[j + 2] * fade;
    }
  }

  function updateReducedHalo() {
    for (let i = I.halo[0]; i < N; i++) {
      const j = i * 3, group = i & 31;
      const membership = i >= filamentEnd || filamentAmount >= 1 ? 1 : filamentAmount <= 0 ? 0
        : smooth((filamentAmount - P1[i] / TAU) * 5 + 0.5);
      const amount = dissolveAmount * membership
        * (i < filamentEnd ? 1 + Math.max(0, filamentAmount - 1) * 0.6 : 1);
      FACE[j] = BASE[j] + flowSine[group] * 0.0006;
      FACE[j + 1] = BASE[j + 1] + flowCosine[group] * 0.0006;
      FACE[j + 2] = BASE[j + 2] / 1.6 * depthAmount;
      const fade = amount * (1 + sine[group] * 0.003);
      DEPART_FADE[i] = fade;
      FACE_COL[j] = BASE_COL[j] * fade;
      FACE_COL[j + 1] = BASE_COL[j + 1] * fade;
      FACE_COL[j + 2] = BASE_COL[j + 2] * fade;
    }
  }

  function update(clock) {
    const dt = previousClock === null ? 0 : Math.min(0.10, Math.max(0, clock - previousClock));
    previousClock = clock;
    life += dt;
    flowLife += dt * edgeFlowSpeed;
    RECYCLED.fill(0);
    DEPART_FADE.fill(1);
    for (let group = 0; group < 32; group++) {
      const angle = life * (0.112 + group * 0.0034);
      sine[group] = Math.sin(angle); cosine[group] = Math.cos(angle);
      const flowAngle = flowLife * (0.047 + group * 0.0012) + group * 1.73;
      flowSine[group] = Math.sin(flowAngle); flowCosine[group] = Math.cos(flowAngle);
    }
    const breathe = reduce ? 0 : Math.sin(life * 0.14) * breath;
    const scale = 1 + breathe * 0.0015, glow = 1 + breathe * 0.04;
    updateCore(scale, glow, faceDrift * (reduce ? 0.025 : 1));
    if (reduce) { updateReducedHalo(); return; }
    updateEdges(dt);
    updateDepartures(dt);
    updateFilaments(dt, scale, glow);
    updateLoose(dt, glow);
  }

  // These read-only views support motion QA without changing its clock or UVs.
  return { applyTuning, update, phase, DEPART_FADE };
}
