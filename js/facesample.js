// Pure, allocation-free bilinear lookups shared by construction and animation.
// Pixel centres at the image corners correspond to UV 0 and 1 respectively.
export function sampleScalar(map, u, v) {
  const x = Math.max(0, Math.min(1, u)) * (map.width - 1);
  const y = Math.max(0, Math.min(1, v)) * (map.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, map.width - 1);
  const y1 = Math.min(y0 + 1, map.height - 1);
  const fx = x - x0, fy = y - y0, data = map.data;
  const a = data[y0 * map.width + x0], b = data[y0 * map.width + x1];
  const c = data[y1 * map.width + x0], d = data[y1 * map.width + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function sampleRGB(map, u, v, out, offset = 0) {
  const x = Math.max(0, Math.min(1, u)) * (map.width - 1);
  const y = Math.max(0, Math.min(1, v)) * (map.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, map.width - 1);
  const y1 = Math.min(y0 + 1, map.height - 1);
  const fx = x - x0, fy = y - y0, data = map.data;
  const a = (y0 * map.width + x0) * 3, b = (y0 * map.width + x1) * 3;
  const c = (y1 * map.width + x0) * 3, d = (y1 * map.width + x1) * 3;
  const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy);
  const wc = (1 - fx) * fy, wd = fx * fy;
  out[offset] = data[a] * wa + data[b] * wb + data[c] * wc + data[d] * wd;
  out[offset + 1] = data[a + 1] * wa + data[b + 1] * wb + data[c + 1] * wc + data[d + 1] * wd;
  out[offset + 2] = data[a + 2] * wa + data[b + 2] * wb + data[c + 2] * wc + data[d + 2] * wd;
  return out;
}
