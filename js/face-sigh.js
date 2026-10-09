// One playback-timed gather / outward release / reform. Shares the existing
// gesture field and handover; it never owns another clock or particle buffer.
export const SIGH_GESTURE = Object.freeze({ gather: .18, hold: .06, release: .28,
  settle: .4, amount: .075, tighten: .7, widen: .95,
  coreDelay: .025, edgeDelay: .14, edgeOvershoot: .3 });
const ramp = (age, duration) => {
  const t = duration > 0 ? Math.max(0, Math.min(1, age / duration)) : Number(age >= 0);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function sampleSighGesture(age, settings, strength, out) {
  out[0] = out[1] = out[2] = 0;
  if (age <= 0) return;
  const g = settings;
  out[2] = ramp(age, g.gather);
  if (age < g.gather) out[0] = g.tighten * out[2];
  else if ((age -= g.gather) < g.hold) out[0] = g.tighten;
  else if ((age -= g.hold) < g.release) out[0] = g.tighten - (1 + g.tighten) * ramp(age, g.release);
  else if ((age -= g.release) < g.settle) out[0] = -(1 - ramp(age, g.settle));
  out[1] = Math.min(0, out[0]) * g.edgeOvershoot * strength;
  out[0] *= strength;
}
