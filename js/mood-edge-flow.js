// Display-only expression response. Cue weights own strength and playback
// position owns phase; intrinsic paths, lifetimes and colours stay with motion.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };
const names = ['thinking', 'warm', 'focused', 'confident', 'content', 'delighted', 'laugh', 'sigh'];
const frequencies = [1.1, 1.5, 1.7, .8, 2.8, 1.3];
const stride = 15;

export function createMoodEdgeFlow({ base, edge, coreEnd, end, width, height,
  centreX, centreY, departing }, reduce = false) {
  const output = new Float32Array(base.length);
  // Neighbours share coherent waves. Cache spatial trig terms once, leaving
  // only twelve global trig calls per frame, independent of particle count.
  const field = new Float32Array(end * stride);
  for (let i = 0; i < end; i++) {
    const x = (base[i * 3] - centreX) / (width * .5);
    const y = (base[i * 3 + 1] - centreY) / (height * .5);
    const radius = Math.hypot(x, y), length = radius || 1, k = i * stride;
    field[k] = x / length; field[k + 1] = y / length;
    field[k + 2] = edge[i] * edge[i] * smooth((radius - .35) / .55);
    const phases = [-radius * 1.8 + y * .55 + Math.PI * .5,
      -radius * 2.7 + y * .3, y * 2.4 + x * .6,
      y * 2.1 - Math.abs(x) * .5, Math.abs(x) * 3.2 + y * .65,
      y * 2.3 - radius * .6];
    phases.forEach((phase, index) => {
      field[k + 3 + index * 2] = Math.sin(phase);
      field[k + 4 + index * 2] = Math.cos(phase);
    });
  }
  let amount = 0, replyId = null, position = 0, active = false;
  const sine = new Float64Array(frequencies.length), cosine = new Float64Array(frequencies.length).fill(1);
  const state = { ...Object.fromEntries(names.map(name => [name, 0])), time: 0, maxDisplacement: 0 };
  const velocity = Object.fromEntries(names.map(name => [name, 0]));

  function update(dt, cues, weights, enabled = true) {
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const nextReply = cues?.replyId ?? null;
    const nextPosition = Number.isFinite(cues?.position) ? Math.max(0, cues.position) : 0;
    const advance = cues ? nextReply === replyId ? Math.max(0, nextPosition - position) : 0 : step;
    replyId = nextReply; position = nextPosition;
    // An underrun holds both shape and phase. Reply replacement inherits the
    // in-flight wave rather than restarting it or passing through neutral.
    if (cues?.state === 'gap') return state;
    const frequency = 10, decay = Math.exp(-frequency * step);
    active = false;
    for (const name of names) {
      const value = Number.isFinite(weights?.[name]) ? clamp(weights[name], 0, 1) : 0;
      const target = !reduce && enabled ? value * amount : 0;
      const offset = state[name] - target, tangent = velocity[name] + frequency * offset;
      if (step > 0) {
        state[name] = target + (offset + tangent * step) * decay;
        velocity[name] = (velocity[name] - frequency * tangent * step) * decay;
      }
      if (Math.abs(state[name] - target) < 1e-8 && Math.abs(velocity[name]) < 1e-7) {
        state[name] = target; velocity[name] = 0;
      }
      active ||= state[name] !== 0;
    }
    if (!reduce && active) state.time += advance;
    for (let i = 0; i < frequencies.length; i++) {
      sine[i] = Math.sin(state.time * frequencies[i]);
      cosine[i] = Math.cos(state.time * frequencies[i]);
    }
    return state;
  }

  function apply(source, attachment, mix = 1) {
    state.maxDisplacement = 0;
    if (reduce || mix === 0 || !active) return source;
    output.set(source);
    for (let i = 0, j = 0, k = 0; i < end; i++, j += 3, k += stride) {
      const filament = i >= coreEnd;
      // Reach beyond filament roots without gathering detached core particles
      // or background stars. Existing lifetime fading still owns visibility.
      let attached = filament ? .4 + .6 * attachment[i] : attachment[i];
      if (!filament && departing?.[i]) {
        const distance = Math.hypot(source[j] - base[j], source[j + 1] - base[j + 1], source[j + 2] - base[j + 2]);
        attached *= 1 - smooth((distance / width - .035) / .165);
      }
      const weight = field[k + 2] * attached * mix * (filament ? 1.45 : .6);
      if (!weight) continue;
      const x = field[k], y = field[k + 1];
      const curl = sine[0] * field[k + 4] + cosine[0] * field[k + 3];
      const ripple = sine[1] * field[k + 6] + cosine[1] * field[k + 5];
      const stream = sine[2] * field[k + 8] + cosine[2] * field[k + 7];
      const lift = sine[3] * field[k + 10] + cosine[3] * field[k + 9];
      const bounce = sine[4] * field[k + 12] + cosine[4] * field[k + 11];
      const wash = sine[5] * field[k + 14] + cosine[5] * field[k + 13];
      // The approved Thoughtful/Warmly equations remain unchanged.
      const gather = state.thinking * (.72 + .28 * x);
      const warmth = state.warm * (.35 + .65 * (.5 + .5 * ripple));
      const focus = state.focused * (.66 + .34 * (.5 + .5 * stream));
      const confidence = state.confident * (.8 + .2 * lift);
      const content = state.content * (.25 + .25 * (.5 + .5 * ripple));
      const delight = state.delighted * (.55 + .45 * (.5 + .5 * bounce));
      const sigh = state.sigh * (.65 + .35 * (.5 + .5 * wash));
      // Focus converges upward; confidence rises steadily. Laughter is a
      // buoyant side ripple, with chuckle strength owned by its existing cue.
      const dx = width * .07 * weight * (gather * (-.35 * x - .8 * y * curl) + warmth * x
        - focus * .8 * x + confidence * .25 * x + content * x + delight * 1.05 * x
        + state.laugh * x * (.42 + .22 * bounce) + sigh * .3 * x);
      const dy = height * .065 * weight * (gather * (-.3 * y + .65 * x * curl) + warmth * y
        + focus * (.5 + .35 * stream - .25 * y) + confidence * (.75 + .25 * y)
        + content * (.7 * y + .2) + delight * (.8 * y + .6)
        + state.laugh * (.55 * bounce + .25 * y) - sigh * (.9 + .25 * (.5 + .5 * wash)));
      output[j] += dx; output[j + 1] += dy;
      state.maxDisplacement = Math.max(state.maxDisplacement, Math.hypot(dx, dy));
    }
    return output;
  }
  return { update, apply, state, applyTuning(tuning) {
    if (Number.isFinite(tuning.moodEdgeAmount)) amount = clamp(tuning.moodEdgeAmount, 0, 1);
  } };
}
