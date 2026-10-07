// Pure, deterministic fields: shared by placement and image-colour treatment.
const smooth = (x) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
function hash(x, y) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967295;
}
export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}
export function faceField(u, v) {
  return noise2(u * 8.7 + 13.2, v * 8.7 + 9.1) * 0.64
    + noise2(u * 23.1 + 2.7, v * 23.1 + 37.3) * 0.26
    + noise2(u * 57.3 + 91.5, v * 57.3 + 4.6) * 0.1;
}
function ellipse(u, v, x, y, rx, ry) {
  const dx = (u - x) / rx, dy = (v - y) / ry;
  return 1 - smooth((Math.sqrt(dx * dx + dy * dy) - 0.52) / 0.68);
}
export function protectionWeight(u, v, landmarks) {
  const left = landmarks.eyeL, right = landmarks.eyeR;
  const bridge = landmarks.noseBridge, tip = landmarks.noseTip;
  const mouth = landmarks.mouthCentre;
  return Math.max(
    ellipse(u, v, left[0], left[1], 0.112, 0.063),
    ellipse(u, v, right[0], right[1], 0.112, 0.063),
    ellipse(u, v, (bridge[0] + tip[0]) * 0.5, (bridge[1] + tip[1]) * 0.5, 0.061, 0.155),
    ellipse(u, v, mouth[0], mouth[1], 0.176, 0.084)
  );
}
