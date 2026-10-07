const CONTROLS = [
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
];

export function createTuningPanel(tuning, onChange) {
  const panel = document.createElement('details');
  panel.className = 'tuning';
  panel.open = !window.matchMedia('(max-width: 560px)').matches;
  const summary = document.createElement('summary');
  summary.textContent = 'Particle tuning';
  panel.append(summary);

  const content = document.createElement('div');
  content.className = 'tuning-content';
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
    const label = document.createElement('label');
    label.className = 'tuning-control';
    const name = document.createElement('span');
    name.textContent = labelText;
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
