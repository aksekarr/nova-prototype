// Spatial variation of an existing speech accent, not a second gesture clock.
const DIRECTIONS = [[1, .35], [-.8, .7], [.4, -1], [-1, -.45]];
export function createSpeechFlow({ base, edge, end, width, height, pivotY }) {
  const count = base.length / 3;
  const x = new Float64Array(count), y = new Float64Array(count);
  const sourceX = new Float64Array(count), sourceY = new Float64Array(count);
  const nx = new Float32Array(end), ny = new Float32Array(end);
  for (let i = 0; i < end; i++) {
    nx[i] = Math.max(-1, Math.min(1, base[i * 3] / (width * .5)));
    ny[i] = Math.max(-1, Math.min(1, (base[i * 3 + 1] - pivotY) / (height * .5)));
  }
  let amount = 0, dx = 0, dy = 0;
  const state = { amount: 0, directionX: 0, directionY: 0 };
  function start(ordinal, strength, delays) {
    clear();
    amount = strength;
    // Advance through four distinct directions without consuming randomness or
    // changing the existing head, blink or particle decisions.
    [dx, dy] = DIRECTIONS[ordinal % DIRECTIONS.length];
    Object.assign(state, { amount, directionX: dx, directionY: dy });
    if (!amount) return;
    for (let i = 0; i < end; i++) {
      const progress = Math.max(0, Math.min(1, .5 + (nx[i] * dx + ny[i] * dy) * .3));
      delays[i] += .24 * edge[i] * progress;
    }
  }
  function write(i, value, blend) {
    x[i] = sourceX[i] * (1 - blend);
    y[i] = sourceY[i] * (1 - blend);
    if (i >= end || amount === 0) return;
    const w = amount * edge[i];
    x[i] += width * value * w * (dx * .95 + nx[i] * .35);
    // Trade some uniform vertical stretching for a directional outer sweep.
    y[i] += value * w
      * (height * dy * .65 - (base[i * 3 + 1] - pivotY) * .6);
  }
  function capture() {
    sourceX.set(x); sourceY.set(y);
    amount = 0;
  }
  function fade(weight) {
    for (let i = 0; i < count; i++) { x[i] = sourceX[i] * weight; y[i] = sourceY[i] * weight; }
  }
  function clear() {
    x.fill(0); y.fill(0); sourceX.fill(0); sourceY.fill(0);
    amount = 0;
    Object.assign(state, { amount: 0, directionX: 0, directionY: 0 });
  }
  return { x, y, state, start, write, capture, fade, clear };
}
