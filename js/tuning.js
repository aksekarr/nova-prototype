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
  ['driftAmount', 'Nebula drift', 0, 2, 0.01],
];

const FLANGER_CONTROLS = [
  ['flangerRate', 'Rate (Hz)', 0.01, 5, 0.001],
  ['flangerBaseDelay', 'Base delay (ms)', 0.1, 20, 0.01],
  ['flangerDepth', 'Depth (ms)', 0, 20, 0.01],
  ['flangerFeedback', 'Feedback', -0.95, 0.95, 0.01],
  ['flangerMix', 'Mix', 0, 1, 0.01],
];

const HEAD_CONTROLS = [
  ['headAmount', 'Head amount', 0, 2, 0.01],
  ['nodAmount', 'Nod amount', 0, 2, 0.01],
  ['blinkRate', 'Blinks per minute', 0, 30, 1],
];

export function createTuningPanel(tuning, onChange, speechLab) {
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

  content.append(createVoiceEffect(tuning, key => {
    refreshJSON();
    status.textContent = '';
    onChange(tuning, key);
  }, speechLab?.references));

  content.append(createHeadEyes(tuning, key => {
    refreshJSON();
    status.textContent = '';
    onChange(tuning, key);
  }));

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

function createHeadEyes(tuning, onChange) {
  const group = document.createElement('div');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Head & eyes');
  const heading = document.createElement('div');
  heading.textContent = 'Head & eyes';
  heading.setAttribute('role', 'heading');
  heading.setAttribute('aria-level', '3');
  group.append(heading);

  for (const [key, labelText, min, max, step] of HEAD_CONTROLS) {
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
      onChange(key);
    });
    label.append(name, value, input);
    group.append(label);
  }
  return group;
}

function createVoiceEffect(tuning, onChange, references) {
  const group = document.createElement('div');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Voice effect');
  const heading = document.createElement('div');
  heading.textContent = 'Voice effect';
  heading.setAttribute('role', 'heading');
  heading.setAttribute('aria-level', '3');
  group.append(heading);

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'tuning-footer';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = 'tuning-flangerOn';
  toggle.checked = tuning.flangerOn;
  const toggleText = document.createElement('span');
  toggleText.textContent = 'Flanger on';
  toggle.addEventListener('input', () => {
    tuning.flangerOn = toggle.checked;
    onChange('flangerOn');
  });
  toggleLabel.append(toggle, toggleText);
  group.append(toggleLabel);

  for (const [key, labelText, min, max, step] of FLANGER_CONTROLS) {
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
      onChange(key);
    });
    label.append(name, value, input);
    group.append(label);
  }

  const status = document.createElement('span');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  let playbackRequest = 0;
  const buttons = [
    ['dry', 'Dry reference'],
    ['logic', 'Logic reference'],
    ['browser', 'Browser flanger'],
  ].map(([kind, text]) => {
    const row = document.createElement('div');
    row.className = 'tuning-footer';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.disabled = true;
    button.addEventListener('click', async () => {
      const request = ++playbackRequest;
      status.textContent = 'Loading / playing…';
      try {
        await references.play(kind);
        if (request === playbackRequest) status.textContent = 'Ready';
      } catch {
        if (request === playbackRequest) status.textContent = 'Reference unavailable.';
      }
    });
    row.append(button);
    group.append(row);
    return button;
  });
  group.append(status);
  if (references) {
    Promise.resolve().then(() => references.load()).then(available => {
      for (const button of buttons) button.disabled = !available;
    }).catch(() => { /* Local reference clips are optional. */ });
  }
  return group;
}

function captureDuration(reply) {
  const lastArrival = reply.events.at(-1)?.t ?? 0;
  if (reply.interrupted) return lastArrival;
  let audioEnd = null;
  for (const event of reply.events) {
    if (event.type !== 'addAudio') continue;
    const samples = atob(event.data).length / 2;
    audioEnd = Math.max(audioEnd ?? event.t + 100, event.t) + samples / 44100 * 1000;
  }
  // Transport end can arrive while buffered audio is still playing.
  return Math.max(lastArrival, audioEnd ?? 0);
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
  const simulate = document.createElement('button');
  simulate.type = 'button';
  simulate.textContent = 'Simulate live';
  simulate.disabled = true;
  const interrupt = document.createElement('button');
  interrupt.type = 'button';
  interrupt.textContent = 'Interrupt';
  interrupt.disabled = true;
  const slowLabel = document.createElement('label');
  slowLabel.className = 'tuning-footer';
  const slow = document.createElement('input');
  slow.type = 'checkbox';
  slow.id = 'speech-lab-slow';
  const slowText = document.createElement('span');
  slowText.textContent = 'Slow network';
  slowLabel.append(slow, slowText);
  const actions = document.createElement('div');
  actions.className = 'tuning-footer';
  actions.style.gridColumn = '1 / -1';
  actions.style.flexWrap = 'wrap';
  actions.append(play, simulate, interrupt);
  select.style.gridColumn = '1 / -1';
  const status = document.createElement('span');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  const captureLabel = document.createElement('label');
  captureLabel.htmlFor = 'speech-lab-capture-file';
  captureLabel.textContent = 'Load capture…';
  const captureFile = document.createElement('input');
  captureFile.type = 'file';
  captureFile.id = 'speech-lab-capture-file';
  captureFile.className = 'speech-lab-capture-file';
  captureFile.accept = '.json,application/json';
  const captureSelect = document.createElement('select');
  captureSelect.id = 'speech-lab-capture-reply';
  captureSelect.setAttribute('aria-label', 'Captured reply');
  captureSelect.style.gridColumn = '1 / -1';
  const emptyCapture = document.createElement('option');
  emptyCapture.textContent = 'No capture loaded';
  captureSelect.append(emptyCapture);
  captureSelect.disabled = true;
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.id = 'speech-lab-replay';
  replay.textContent = 'Replay';
  replay.disabled = true;
  const captureActions = document.createElement('div');
  captureActions.className = 'tuning-footer';
  captureActions.style.gridColumn = '1 / -1';
  captureActions.append(replay);
  lab.append(label, select, actions, slowLabel, captureLabel, captureFile, captureSelect, captureActions, status);

  let linesReady = false, captureLoading = false;
  let capturedReplies = [], captureLoadRequest = 0;
  let pending = false, playbackRequest = 0;
  function setPending(value) {
    pending = value;
    play.disabled = value || !linesReady;
    simulate.disabled = value || !linesReady;
    select.disabled = value || !linesReady;
    slow.disabled = value;
    interrupt.disabled = !value;
    captureFile.disabled = value;
    captureSelect.disabled = value || captureLoading || !capturedReplies.length;
    replay.disabled = captureSelect.disabled;
  }

  captureFile.addEventListener('change', async () => {
    const file = captureFile.files?.[0];
    if (!file) return;
    const request = ++captureLoadRequest;
    captureFile.value = '';
    capturedReplies = [];
    captureLoading = true;
    captureSelect.replaceChildren(emptyCapture);
    emptyCapture.textContent = 'Loading capture…';
    setPending(pending);
    status.textContent = 'Loading capture…';
    try {
      const capture = await speechLab.loadCapture(file);
      if (request !== captureLoadRequest) return;
      capturedReplies = capture.replies;
      captureSelect.replaceChildren(...capturedReplies.map((reply, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        const duration = captureDuration(reply);
        const words = reply.text.trim().split(/\s+/).filter(Boolean);
        const preview = words.slice(0, 7).join(' ') + (words.length > 7 ? '…' : '');
        option.textContent = `${index + 1}. ${(duration / 1000).toFixed(2)}s — ${preview || '(no text)'}` +
          (reply.interrupted ? ' — interrupted' : '');
        return option;
      }));
      if (!capturedReplies.length) {
        emptyCapture.textContent = 'No replies in capture';
        captureSelect.append(emptyCapture);
      }
      status.textContent = `Loaded ${capturedReplies.length} ${capturedReplies.length === 1 ? 'reply' : 'replies'}.`;
    } catch {
      if (request !== captureLoadRequest) return;
      capturedReplies = [];
      emptyCapture.textContent = 'No capture loaded';
      captureSelect.replaceChildren(emptyCapture);
      status.textContent = 'Could not load this capture file.';
    } finally {
      if (request === captureLoadRequest) {
        captureLoading = false;
        setPending(pending);
      }
    }
  });

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
      linesReady = true;
      setPending(pending);
    })
    .catch(error => {
      loading.textContent = 'Lines unavailable';
      status.textContent = 'Could not load speech lines.';
      console.warn('Speech lab unavailable.', error);
    });

  function formatReport(report) {
    if (!report) return 'Ready';
    if (report.interrupted) return 'Interrupted';
    const fixed = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : 'mismatch';
    return `Shape ${report.shapeValuesMatch ? fixed(report.shapeMaxMs) : 'mismatch'} ms; words ${fixed(report.wordMaxMs)} ms; ` +
      `envelope MAE ${fixed(report.envelopeMeanAbsoluteDifference, 4)}; ` +
      `seam ${fixed(report.largestSeamSamples)} samples; underruns ${report.underruns}; ` +
      `gap mismatch ${fixed(report.largestGapMismatchMs)} ms.`;
  }
  async function run(simulated) {
    if (pending || !select.value) return;
    const request = ++playbackRequest;
    setPending(true);
    status.textContent = simulated ? 'Loading / simulating…' : 'Loading / playing…';
    try {
      const report = await (simulated
        ? speechLab.simulate(select.value, { slowNetwork: slow.checked })
        : speechLab.play(select.value));
      if (request === playbackRequest) status.textContent = formatReport(report);
    } catch (error) {
      if (request === playbackRequest) status.textContent = 'This line could not be played.';
      console.warn('Speech lab playback failed.', error);
    } finally {
      if (request === playbackRequest) setPending(false);
    }
  }
  play.addEventListener('click', () => run(false));
  simulate.addEventListener('click', () => run(true));
  replay.addEventListener('click', async () => {
    const reply = capturedReplies[Number(captureSelect.value)];
    if (pending || captureLoading || !reply) return;
    const request = ++playbackRequest;
    setPending(true);
    status.textContent = 'Replaying…';
    try {
      const report = await speechLab.replay(reply);
      if (request === playbackRequest) status.textContent = report?.interrupted ? 'Interrupted' : 'Ready';
    } catch {
      if (request === playbackRequest) status.textContent = 'This capture could not be replayed.';
    } finally {
      if (request === playbackRequest) setPending(false);
    }
  });
  interrupt.addEventListener('click', () => {
    playbackRequest++;
    speechLab.interrupt();
    setPending(false);
    status.textContent = 'Interrupted';
  });
  return lab;
}
