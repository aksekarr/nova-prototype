import { sampleScalar } from './facesample.js';

const ROOT = new URL('../assets/face/', import.meta.url);
const REQUIRED_LANDMARKS = [
  'eyeL', 'eyeR', 'eyeL_inner', 'eyeL_outer', 'eyeR_inner', 'eyeR_outer',
  'eyeL_upperLid', 'eyeL_lowerLid', 'eyeR_upperLid', 'eyeR_lowerLid',
  'browL_inner', 'browL_peak', 'browL_outer', 'browR_inner', 'browR_peak', 'browR_outer',
  'noseBridge', 'noseTip', 'mouthLeft', 'mouthRight', 'mouthCentre',
  'upperLipTop', 'lowerLipBottom', 'chin'
];

async function readMap(filename, size, rgb) {
  const image = new Image();
  image.decoding = 'async';
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Cannot load face map: ${filename}`));
    image.src = new URL(filename, ROOT).href;
  });
  if (image.naturalWidth !== size || image.naturalHeight !== size) {
    throw new Error(`Face map ${filename} must be ${size} × ${size}`);
  }
  // This canvas is never attached to the document. Older Safari also supports
  // the detached HTML canvas path when OffscreenCanvas is unavailable.
  const canvas = typeof OffscreenCanvas === 'function'
    ? new OffscreenCanvas(size, size) : document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Cannot decode the face maps into pixels');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, size, size).data;
  const channels = rgb ? 3 : 1, data = new Float32Array(size * size * channels);
  for (let i = 0; i < size * size; i++) {
    const a = pixels[i * 4 + 3] / 65025;
    data[i * channels] = pixels[i * 4] * a;
    if (rgb) {
      data[i * 3 + 1] = pixels[i * 4 + 1] * a;
      data[i * 3 + 2] = pixels[i * 4 + 2] * a;
    }
  }
  return { width: size, height: size, data };
}

async function readLandmarks() {
  const response = await fetch(new URL('face-landmarks.json', ROOT));
  if (!response.ok) throw new Error(`Cannot load face landmarks (${response.status})`);
  const manifest = await response.json(), landmarks = manifest.landmarks;
  if (!landmarks || !manifest.coordinateSystem) throw new Error('Invalid face landmark manifest');
  for (const name of REQUIRED_LANDMARKS) {
    const point = landmarks[name];
    if (!Array.isArray(point) || point.length !== 2 ||
        !point.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
      throw new Error(`Invalid face landmark: ${name}`);
    }
  }
  return manifest;
}

export async function loadFaceMap() {
  const [colour, mask, depth, manifest] = await Promise.all([
    readMap('face-colour.png', 512, true),
    readMap('face-mask.png', 256, false),
    readMap('face-depth.png', 256, false),
    readLandmarks()
  ]);
  const average = [0, 0, 0];
  let weight = 0;
  for (let y = 0; y < colour.height; y++) {
    for (let x = 0; x < colour.width; x++) {
      const coverage = sampleScalar(mask, x / (colour.width - 1), y / (colour.height - 1));
      const j = (y * colour.width + x) * 3;
      average[0] += colour.data[j] * coverage;
      average[1] += colour.data[j + 1] * coverage;
      average[2] += colour.data[j + 2] * coverage;
      weight += coverage;
    }
  }
  if (weight < 1) throw new Error('The face coverage map is empty');
  average[0] /= weight; average[1] /= weight; average[2] /= weight;
  return { colour, mask, depth, landmarks: manifest.landmarks, manifest, average };
}
