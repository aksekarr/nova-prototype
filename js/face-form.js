// Display-only silhouette flow. No random draws, scene state or particle identity changes.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function createFaceForm({ base, edge, end, width, height, centreX, centreY }, reduce = false) {
  const output = new Float32Array(base.length);
  const field = new Float32Array(end * 2);
  for (let i = 0; i < end; i++) {
    field[i * 2] = clamp((base[i * 3] - centreX) / (width * .5), -1.5, 1.5);
    field[i * 2 + 1] = clamp((base[i * 3 + 1] - centreY) / (height * .5), -1.5, 1.5);
  }
  let time = 0, amount = 1, weight = 0;
  const state = { weight: 0, attention: 0, width: 0, height: 0, bend: 0, asymmetry: 0 };
  function update(dt, eligible, attention = 0) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    time += dt;
    const target = !reduce && eligible ? amount : 0;
    // Suppress during the whole reply, including transport gaps. Ease rather
    // than resetting the phase, so interruptions cannot restart a shape cycle.
    weight += (target - weight) * (1 - Math.exp(-dt / (target > weight ? .9 : .22)));
    if (Math.abs(weight - target) < 1e-6) weight = target;
    state.weight = weight;
    state.attention = Number.isFinite(attention) ? clamp(attention, 0, 1) : 0;
    const a = state.attention, freedom = 1 - .7 * a;
    const swell = Math.sin(time * .72) * .085 + Math.sin(time * .31 + .8) * .035;
    state.width = weight * (swell * freedom - .11 * a);
    state.height = weight * (-swell * .65 * freedom + .045 * a);
    state.bend = weight * freedom * .036 * Math.sin(time * .53 + .4);
    state.asymmetry = weight * freedom * .035 * Math.sin(time * .41 + 1.7);
  }
  function apply(source, attachment, mix = 1) {
    if (weight === 0 || mix === 0) return source;
    output.set(source);
    for (let i = 0, j = 0; i < end; i++, j += 3) {
      // Reuse the broad expression protection field. Eyes, nose and lips stay
      // exact; detached particles and background stars do not get pulled back.
      const w = edge[i] * attachment[i] * mix;
      if (w === 0) continue;
      const x = source[j] - centreX, y = source[j + 1] - centreY;
      const nx = field[i * 2], ny = field[i * 2 + 1];
      output[j] += w * (x * state.width + width * (state.bend * ny * ny + state.asymmetry * nx * ny));
      output[j + 1] += w * (y * state.height + height * state.asymmetry * nx * .35);
    }
    return output;
  }
  return { update, apply, state, setAmount(value) {
    if (Number.isFinite(value)) amount = clamp(value, 0, 1);
  } };
}
