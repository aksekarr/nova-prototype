const CONTROLS = [
  ['definition', 'Definition', 0, 1, 0.01],
  ['brightnessFloor', 'Brightness floor', 0, 0.35, 0.005],
  ['faceDensity', 'Face density', 0.25, 1, 0.01],
  ['messiness', 'Messiness', 0, 1, 0.01],
  ['faceDrift', 'Drift amount', 0, 2, 0.01],
  ['edgeFlowSpeed', 'Edge flow speed', 0, 2, 0.01],
  ['breath', 'Breath', 0, 2, 0.01],
  ['filamentAmount', 'Filament amount', 0, 2, 0.01],
  ['starSizeSpread', 'Star size spread', 0, 2, 0.01],
  ['gasWrap', 'Gas wrap', 0, 2, 0.01],
  ['depthAmount', 'Depth amount', 0, 2.5, 0.01],
  ['mouthWarpStrength', 'Mouth warp strength', 0, 2, 0.01],
  ['sparkle', 'Sparkle', 0, 0.15, 0.001],
  ['lipProminence', 'Lip prominence', 0.25, 2, 0.01],
  ['eyeGlow', 'Eye glow', 0, 2, 0.01],
  ['rimStrength', 'Rim strength', 0, 2, 0.01],
  ['interiorDensity', 'Interior density', 0, 1, 0.01],
  ['dissolveAmount', 'Dissolve amount', 0, 2, 0.01],
  ['trailStrength', 'Trail strength', 0, 0.9, 0.01],
  ['bloomStrength', 'Bloom strength', 0, 2, 0.01],
  ['bloomRadius', 'Bloom radius', 0, 1, 0.01],
  ['bloomThreshold', 'Bloom threshold', 0, 1.5, 0.01],
  ['pointSize', 'Point size', 0.025, 0.16, 0.001],
  ['sizeVariation', 'Size variation', 0, 1, 0.01],
  ['depthFade', 'Depth fade', 0, 1, 0.01],
  ['brightness', 'Brightness', 0.2, 2, 0.01],
  ['gasIntensity', 'Gas intensity', 0, 1, 0.01],
  ['gasScale', 'Gas scale', 0.5, 2, 0.01],
  ['dustStrength', 'Dust strength', 0, 1, 0.01],
  ['starfieldBrightness', 'Starfield brightness', 0, 2, 0.01],
  ['glintStrength', 'Glint strength', 0, 2, 0.01],
  ['faceFrame', 'Face frame', 0.25, 0.8, 0.001],
  ['shapeFrame', 'Shape frame', 0.35, 0.85, 0.01],
  ['driftAmount', 'Drift amount', 0, 2, 0.01],
];
const MAP_CONTROLS = new Set(['definition', 'brightnessFloor', 'faceDensity', 'messiness', 'faceDrift', 'edgeFlowSpeed', 'breath', 'filamentAmount', 'starSizeSpread', 'gasWrap', 'depthAmount', 'mouthWarpStrength', 'sparkle']);
const LEGACY_CONTROLS = new Set(['rimStrength', 'interiorDensity']);

export function createTuningPanel(tuning, onChange, speechLab, faceVersion = 'v2') {
  const panel = document.createElement('details');
  panel.className = 'tuning';
  panel.open = !window.matchMedia('(max-width: 560px)').matches;
  const summary = document.createElement('summary');
  summary.textContent = 'Particle tuning';
  panel.append(summary);

  const content = document.createElement('div');
  content.className = 'tuning-content';
  if (speechLab) content.append(createSpeechLab(speechLab));
  const json = document.createElement('textarea');
  json.className = 'tuning-json';
  json.readOnly = true;
  json.spellcheck = false;
  json.setAttribute('aria-label', 'Current tuning values as JSON');
  const refreshJSON = () => { json.value = JSON.stringify(tuning, null, 2); };

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  const status = document.createElement('span');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  let statusTimeout;

  for (const [key, labelText, min, max, step] of CONTROLS) {
    if (faceVersion === 'v3' ? LEGACY_CONTROLS.has(key) : MAP_CONTROLS.has(key)) continue;
    const label = document.createElement('label');
    label.className = 'tuning-control';
    const name = document.createElement('span');
    name.textContent = faceVersion === 'v3' && key === 'driftAmount' ? 'Nebula drift' : labelText;
    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `tuning-${key}`;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = tuning[key];
    value.htmlFor = input.id;
    value.value = input.value;
    input.addEventListener('input', () => {
      tuning[key] = Number(input.value);
      value.value = input.value;
      refreshJSON();
      status.textContent = '';
      onChange(tuning);
    });
    label.append(name, value, input);
    content.append(label);
  }

  copy.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(json.value);
      copied = true;
    } catch {
      const selectionStart = json.selectionStart;
      const selectionEnd = json.selectionEnd;
      json.focus({ preventScroll: true });
      json.select();
      try { copied = document.execCommand('copy'); } catch { /* Show manual-copy help. */ }
      json.setSelectionRange(selectionStart, selectionEnd);
      copy.focus({ preventScroll: true });
    }
    status.textContent = copied ? 'Copied' : 'Select the text to copy';
    window.clearTimeout(statusTimeout);
    statusTimeout = window.setTimeout(() => { status.textContent = ''; }, 2500);
  });

  const footer = document.createElement('div');
  footer.className = 'tuning-footer';
  footer.append(copy, status);
  refreshJSON();
  content.append(json, footer);
  panel.append(content);
  document.body.append(panel);
  return panel;
}

function createSpeechLab(speechLab) {
  const lab = document.createElement('div');
  lab.className = 'speech-lab';
  const label = document.createElement('label');
  label.htmlFor = 'speech-lab-line';
  label.textContent = 'Speech lab';
  const select = document.createElement('select');
  select.id = 'speech-lab-line';
  select.disabled = true;
  const loading = document.createElement('option');
  loading.textContent = 'Loading lines…';
  select.append(loading);
  const play = document.createElement('button');
  play.type = 'button';
  play.textContent = 'Play';
  play.disabled = true;
  const status = document.createElement('span');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  lab.append(label, select, play, status);

  fetch(new URL('../voice/lines.json', import.meta.url))
    .then(response => {
      if (!response.ok) throw new Error('Could not load the speech line list');
      return response.json();
    })
    .then(lines => {
      if (!Array.isArray(lines) || !lines.length || lines.some(line =>
        typeof line.id !== 'string' || typeof line.text !== 'string')) {
        throw new Error('The speech line list is invalid');
      }
      select.replaceChildren(...lines.map(line => {
        const option = document.createElement('option');
        option.value = line.id;
        option.textContent = `${line.id} — ${line.text.replace(/\[[^\]]*\]/g, '').trim()}`;
        return option;
      }));
      select.disabled = false;
      play.disabled = false;
    })
    .catch(error => {
      loading.textContent = 'Lines unavailable';
      status.textContent = 'Could not load speech lines.';
      console.warn('Speech lab unavailable.', error);
    });

  let pending = false;
  play.addEventListener('click', async () => {
    if (pending || !select.value) return;
    pending = true;
    play.disabled = true;
    select.disabled = true;
    status.textContent = 'Loading / playing…';
    try {
      await speechLab.play(select.value);
      status.textContent = 'Ready';
    } catch (error) {
      status.textContent = 'This line could not be played.';
      console.warn('Speech lab playback failed.', error);
    } finally {
      pending = false;
      play.disabled = false;
      select.disabled = false;
    }
  });
  return lab;
}
