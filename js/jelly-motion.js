// Local +y is the head. The bell steers; the trailing body occupies earlier
// points on the same route. Distance, rather than frame history, drives motion.
const TAU = Math.PI * 2;
const HOLD = 2.35;
const ACCEL = 2.2;
const SPEED = .82;
const RIM = .58;
const MIN_Y = -3.35;
const MAX_Y = 2.45;
const SPINE_STEPS = 128;
const ROUTE_STEPS = 640;

export function createJellyMotion(reduce = false) {
  const route = new Float64Array((ROUTE_STEPS + 1) * 3);
  const lengths = new Float64Array(ROUTE_STEPS + 1);
  // Each spine station stores centre, lateral axis and depth axis.
  const spine = new Float64Array((SPINE_STEPS + 1) * 9);
  const scratch = new Float64Array(6);
  const head = new Float64Array(6);
  const inlet = new Float32Array(3);
  const bounds = { radius: 6.6 };
  let currentAspect = NaN, circumference = 1, startDistance = 0;
  let rx = 3.2;
  const ry = 2.55;

  function configure(aspect) {
    const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    if (safeAspect === currentAspect) return;
    currentAspect = safeAspect;
    rx = Math.min(3.2, Math.max(2.85, safeAspect * 1.8));
    lengths[0] = 0;
    for (let i = 0; i <= ROUTE_STEPS; i++) {
      const a = i * TAU / ROUTE_STEPS, j = i * 3;
      route[j] = rx * Math.cos(a);
      route[j + 1] = .35 + ry * Math.sin(a);
      route[j + 2] = .18 * Math.sin(a * 2);
      if (i) lengths[i] = lengths[i - 1] + Math.hypot(
        route[j] - route[j - 3], route[j + 1] - route[j - 2], route[j + 2] - route[j - 1]);
    }
    circumference = lengths[ROUTE_STEPS];
    // Upper-right receiving pose, already facing along its eventual route.
    const index = .48 / TAU * ROUTE_STEPS, lo = Math.floor(index);
    startDistance = lengths[lo] + (lengths[lo + 1] - lengths[lo]) * (index - lo);
  }

  function path(distance, out) {
    const s = ((distance % circumference) + circumference) % circumference;
    let lo = 0, hi = ROUTE_STEPS;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] <= s) lo = mid; else hi = mid;
    }
    const f = (s - lengths[lo]) / (lengths[hi] - lengths[lo]);
    const j = lo * 3, k = hi * 3;
    for (let c = 0; c < 3; c++) out[c] = route[j + c] + (route[k + c] - route[j + c]) * f;
    // Analytic tangent keeps headings smooth across lookup stations.
    const a = (lo + f) * TAU / ROUTE_STEPS;
    const tx = -rx * Math.sin(a), ty = ry * Math.cos(a), tz = .36 * Math.cos(a * 2);
    const inverse = 1 / Math.hypot(tx, ty, tz);
    out[3] = tx * inverse; out[4] = ty * inverse; out[5] = tz * inverse;
  }

  function mapPoint(x, y, z, output, offset) {
    const index = Math.max(0, Math.min(SPINE_STEPS, (y - MIN_Y) * SPINE_STEPS / (MAX_Y - MIN_Y)));
    const lo = Math.min(SPINE_STEPS - 1, Math.floor(index)), f = index - lo;
    const j = lo * 9, k = j + 9;
    for (let c = 0; c < 3; c++) {
      output[offset + c] = spine[j + c] + (spine[k + c] - spine[j + c]) * f
        + x * (spine[j + 3 + c] + (spine[k + 3 + c] - spine[j + 3 + c]) * f)
        + z * (spine[j + 6 + c] + (spine[k + 6 + c] - spine[j + 6 + c]) * f);
    }
  }

  function apply(positions, clock, aspect) {
    configure(aspect);
    const t = reduce || !Number.isFinite(clock) ? 0 : Math.max(0, clock - HOLD);
    const u = Math.min(1, t / ACCEL);
    const wake = u * u * (3 - 2 * u);
    const distance = t < ACCEL
      ? SPEED * ACCEL * (u * u * u - .5 * u * u * u * u)
      : SPEED * (t - ACCEL * .5);
    const s = startDistance + distance;
    path(s, head);
    const pulse = t * 1.35;
    const globalStretch = 1 + .038 * Math.sin(pulse) * wake;
    for (let i = 0; i <= SPINE_STEPS; i++) {
      const y = MIN_Y + i * (MAX_Y - MIN_Y) / SPINE_STEPS;
      const localDistance = y - RIM;
      // The integral of a small travelling strain keeps the centreline ordered.
      const wave = .052 * wake;
      const d = localDistance * globalStretch
        + wave * (Math.cos(pulse - localDistance * 1.45) - Math.cos(pulse)) / 1.45;
      const strain = globalStretch + wave * Math.sin(pulse - localDistance * 1.45);
      if (localDistance >= 0) {
        // Preserve the dome's broad silhouette while its heading changes.
        for (let c = 0; c < 3; c++) {
          scratch[c] = head[c] + head[c + 3] * d;
          scratch[c + 3] = head[c + 3];
        }
      } else path(s + d, scratch);
      const tx = scratch[3], ty = scratch[4], tz = scratch[5];
      const flat = Math.hypot(tx, ty), nx = ty / flat, ny = -tx / flat;
      const bx = -tx * tz / flat, by = -ty * tz / flat, bz = flat;
      const roll = .065 * wake * Math.sin(t * .43 - Math.min(0, localDistance) * .24);
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const width = 1 / Math.sqrt(strain);
      const j = i * 9;
      spine[j] = scratch[0]; spine[j + 1] = scratch[1]; spine[j + 2] = scratch[2];
      spine[j + 3] = (nx * cr + bx * sr) * width;
      spine[j + 4] = (ny * cr + by * sr) * width;
      spine[j + 5] = bz * sr * width;
      spine[j + 6] = (-nx * sr + bx * cr) * width;
      spine[j + 7] = (-ny * sr + by * cr) * width;
      spine[j + 8] = bz * cr * width;
    }
    // No allocation or trigonometry in this particle loop.
    for (let j = 0; j < positions.length; j += 3) {
      const x = positions[j], y = positions[j + 1], z = positions[j + 2];
      mapPoint(x, y, z, positions, j);
    }
    mapPoint(-.5, .8, .08, inlet, 0);
    return positions;
  }

  function cameraDepth(aspect, slope) {
    configure(aspect);
    const safeSlope = Number.isFinite(slope) && slope > 0 ? slope : Math.tan(25 * Math.PI / 180);
    // Enclose the route plus body width at every heading, with pointer/glow room.
    return 1.75 + Math.max(4.75, (rx + 1.95) / currentAspect) / (safeSlope * .90);
  }

  configure(1);
  return { apply, inlet, bounds, cameraDepth };
}
