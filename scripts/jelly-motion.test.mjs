import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../js/jelly-motion.js', import.meta.url), 'utf8');
const { createJellyMotion } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const distance = (a, b, j = 0, k = 0) => Math.hypot(a[j] - b[k], a[j + 1] - b[k + 1], a[j + 2] - b[k + 2]);
const position = (motion, clock, y = .58, aspect = 16 / 9) => {
  const points = new Float32Array([0, y, 0]);
  motion.apply(points, clock, aspect);
  return points;
};

test('receiving posture holds, then starts with zero velocity and no position jump', () => {
  const motion = createJellyMotion();
  const initial = position(motion, 0);
  for (const t of [-2, .5, 2.35, NaN, Infinity]) assert.deepEqual(position(motion, t), initial);
  const started = position(motion, 2.36);
  assert.ok(distance(started, initial) < .000001, 'smooth acceleration has no first-frame kick');
  assert.ok(distance(position(motion, 5), initial) > .6, 'motion subsequently makes progress');
  assert.ok(motion.inlet[0] > 0);
  for (const aspect of [.46, 1, 1.78]) {
    position(motion, 0, .58, aspect);
    assert.ok(motion.inlet[0] > 1.5 && motion.inlet[1] > 1, 'receiving inlet stays above/right of centre');
  }
});

test('head points along its direction of travel throughout the route', () => {
  const motion = createJellyMotion();
  for (const t of [5, 8, 12, 17, 22, 30, 50]) {
    const body = new Float32Array([0, .58, 0, 0, 1.58, 0]);
    motion.apply(body, t, 16 / 9);
    const before = position(motion, t - .01), after = position(motion, t + .01);
    const heading = [body[3] - body[0], body[4] - body[1], body[5] - body[2]];
    const velocity = after.map((value, c) => value - before[c]);
    const dot = heading.reduce((sum, value, c) => sum + value * velocity[c], 0)
      / (Math.hypot(...heading) * Math.hypot(...velocity));
    assert.ok(dot > .999, `head follows tangent at ${t}: ${dot}`);
  }
});

test('trailing centreline occupies the route the head has already travelled', () => {
  const motion = createJellyMotion();
  for (const t of [12, 20, 28]) {
    const tail = position(motion, t, -1.42);
    let nearest = Infinity, delay = 0;
    for (let lag = 1.5; lag <= 3; lag += .01) {
      const separation = distance(position(motion, t - lag), tail);
      if (separation < nearest) { nearest = separation; delay = lag; }
    }
    assert.ok(nearest < .005, `tail follows previous route: ${nearest}`);
    assert.ok(delay > 2 && delay < 2.8, `tail follows with a real delay: ${delay}`);
    const straightBody = new Float32Array([0, .58, 0, 0, 1.58, 0]);
    motion.apply(straightBody, t, 16 / 9);
    const headLength = distance(straightBody, straightBody, 0, 3);
    const straightTail = new Float32Array(3);
    for (let c = 0; c < 3; c++) straightTail[c] = straightBody[c]
      - (straightBody[c + 3] - straightBody[c]) / headLength * 2;
    assert.ok(distance(tail, straightTail) > .35, 'trailing shape bends instead of translating rigidly');
  }
});

test('length contracts and extends subtly without reversing neighbouring body slices', () => {
  const motion = createJellyMotion();
  let shortest = Infinity, longest = 0;
  for (let t = 5; t < 16; t += .25) {
    const line = new Float32Array(121 * 3);
    for (let i = 0; i <= 120; i++) line[i * 3 + 1] = -2.8 + i * 4.9 / 120;
    motion.apply(line, t, 16 / 9);
    let length = 0;
    for (let i = 1; i <= 120; i++) {
      const gap = distance(line, line, i * 3, (i - 1) * 3);
      assert.ok(gap > .035 && gap < .046, `local strain stays gentle and ordered: ${gap}`);
      length += gap;
    }
    shortest = Math.min(shortest, length); longest = Math.max(longest, length);
  }
  assert.ok(longest - shortest > .22, 'whole body has visible length variation');
  assert.ok(shortest > 4.6 && longest < 5.2, 'length changes stay subtle');
});

test('large pools stay finite, deterministic and bounded while seeking in any order', () => {
  const motion = createJellyMotion(), other = createJellyMotion();
  const inlet = motion.inlet;
  const local = new Float32Array(48000 * 3);
  for (let i = 0; i < 48000; i++) {
    const a = i * 2.39996, j = i * 3;
    local[j] = Math.cos(a) * 1.75;
    local[j + 1] = -2.95 + (i % 1000) * 5.15 / 999;
    local[j + 2] = Math.sin(a) * 1.35;
  }
  for (const t of [0, 1.1, 8, 40, 100000, 3, 8]) {
    const first = local.slice(), second = local.slice();
    assert.equal(motion.apply(first, t, 16 / 9), first, 'mutates the caller pool');
    other.apply(second, t, 16 / 9);
    assert.deepEqual(first, second);
    assert.equal(motion.inlet, inlet, 'inlet storage stays stable');
    for (let j = 0; j < first.length; j += 3) {
      const radius = Math.hypot(first[j], first[j + 1], first[j + 2]);
      assert.ok(Number.isFinite(radius) && radius < motion.bounds.radius);
    }
  }
});

test('reduced motion stays stationary; framing helpers remain finite on narrow screens', () => {
  const motion = createJellyMotion(true);
  const initial = position(motion, 0, -2);
  for (const t of [4, 20, 100000]) assert.deepEqual(position(motion, t, -2), initial);
  const slope = Math.tan(25 * Math.PI / 180);
  assert.ok(motion.cameraDepth(.46, slope) > motion.cameraDepth(1.78, slope));
  for (const aspect of [.46, 1, 1.78, NaN, 0]) assert.ok(Number.isFinite(motion.cameraDepth(aspect, slope)));
  assert.doesNotThrow(() => motion.apply(new Float32Array(), 0, 1));
});
