import { EXPR, POSE_KEYS, POSE_CONTROLS } from './face.js';
import { VOICE_EFFECT_PRESETS } from './flanger.js';

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
  ['flangerRate', 'Flange rate (Hz)', 0.01, 5, 0.001],
  ['flangerBaseDelay', 'Base delay (ms)', 0.1, 20, 0.01],
  ['flangerDepth', 'Depth (ms)', 0, 20, 0.01],
  ['flangerFeedback', 'Feedback', -0.95, 0.95, 0.01],
  ['flangerMix', 'Flange mix', 0, 1, 0.01],
  ['ringRate', 'Metallic tone (Hz)', 20, 250, 1],
  ['ringMix', 'Metallic mix', 0, 0.15, 0.005],
];

const HEAD_CONTROLS = [
  ['laughAmount', 'Laugh amount', 0, 2, 0.01],
  ['gestureAmount', 'Gesture amount', 0, 2, 0.01],
  ['accentAmount', 'Accent amount', 0, 2, 0.01],
  ['accent.spacing', 'Accent spacing', 0.9, 4, 0.01],
  ['accent.threshold', 'Accent threshold', 0, 1, 0.01],
  ['accent.direction', 'Accent direction', -1, 1, 0.01],
  ['accent.attack', 'Accent rise (s)', 0.03, 0.8, 0.01],
  ['accent.release', 'Accent fall (s)', 0.1, 1, 0.01],
  ['accent.overshoot', 'Accent bounce', 0, 0.4, 0.01],
  ['moodAmount', 'Mood amount', 0, 2, 0.01],
  ['browFlashAmount', 'Brow flash amount', 0, 2, 0.01],
  ['microAmount', 'Micro expression amount', 0, 2, 0.01],
  ['headAmount', 'Head amount', 0, 2, 0.01],
  ['nodAmount', 'Nod amount', 0, 2, 0.01],
  ['rollAmount', 'Roll amount', 0, 2, 0.01],
  ['headDepth', 'Head depth', 1, 4, 0.01],
  ['swarm', 'Swarm', 0, 2, 0.01],
  ['swarmCoherence', 'Swarm coherence', 0, 1, 0.01],
  ['surroundWeight', 'Surround weight', 0, 1, 0.01],
  ['blinkRate', 'Blinks per minute', 0, 30, 1],
];

const EYE_CONTROLS = [
  ['irisRound', 'Iris roundness', 0, 1, 0.01],
  ['irisSoftness', 'Iris softness', 0, 1, 0.01],
  ['irisWarmth', 'Iris warmth', 0, 1, 0.01],
  ['socketLift', 'Socket lift', 0, 1, 0.01],

];

const MOUTH_CONTROLS = [
  ['w', 'Width', 0.58, 1.3, 0.01],
  ['h', 'Height', 0, 1.5, 0.01],
  ['round', 'Rounding', 0, 1, 0.01],
  ['close', 'Closure', 0, 1, 0.01],
  ['cup', 'Cup', 0, 1, 0.01],
  ['square', 'Square', 0, 1, 0.01],
  ['tuck', 'Lower lip tuck', 0, 1, 0.01],
  ['oval', 'Oval opening', 0, 1, 0.01],
];
const MOUTH_SEQUENCES = {
  touch: [['REST', 0.09], ['DD', 0.08], ['UH', 0.16], ['CH', 0.12], ['REST', 0.16]],
  Rome: [['REST', 0.09], ['RR', 0.12], ['OH', 0.10], ['OH_END', 0.10], ['PP', 0.08], ['REST', 0.16]],
  room: [['REST', 0.09], ['RR', 0.12], ['OU', 0.18], ['PP', 0.08], ['REST', 0.16]],
  duck: [['REST', 0.09], ['DD', 0.08], ['UH', 0.16], ['DD', 0.10], ['REST', 0.16]],
};

// Preview state never enters TUNING or voice. Only the sculpted vocabulary is
// shared; normal speech continues straight through the existing voice smoother.
export function createMouthLabController(tuning, onStateChange = () => {}) {
  const state = { mode: 'off', selected: 'REST', opening: 0.6, sequence: 'touch', speed: 1,
    playbackActive: false, currentViseme: 'REST' };
  const shape = { w: 1, h: 1, round: 0, close: 0, cup: 0, square: 0, tuck: 0, oval: 0 };
  const output = { shape, envelope: 0 };
  let latestShape = shape, latestEnvelope = 0, sequenceTime = 0, handoff = null;
  const notify = () => onStateChange(state);
  const value = (source, key) => source[key] ?? (key === 'w' || key === 'h' ? 1 : 0);
  function activate(mode) {
    if (state.playbackActive) return false;
    if (state.mode !== 'hold' && state.mode !== 'sequence') {
      for (const [key] of MOUTH_CONTROLS) shape[key] = value(latestShape, key);
      output.envelope = latestEnvelope;
    }
    handoff = null;
    state.mode = mode;
    sequenceTime = 0;
    state.currentViseme = mode === 'hold' ? state.selected : MOUTH_SEQUENCES[state.sequence][0][0];
    notify();
    return true;
  }
  function release(mode) {
    if (state.mode === 'hold' || state.mode === 'sequence') {
      handoff = { shape: { ...shape }, envelope: output.envelope, age: 0 };
    }
    state.mode = mode;
    notify();
  }
  return {
    state,
    select(name) {
      if (state.playbackActive || !Object.hasOwn(tuning.visemes, name)) return false;
      state.selected = name;
      return activate('hold');
    },
    hold() { return activate('hold'); },
    sequence(name = state.sequence) {
      if (state.playbackActive || !Object.hasOwn(MOUTH_SEQUENCES, name)) return false;
      state.sequence = name;
      return activate('sequence');
    },
    off() { if (!state.playbackActive) release('off'); },
    setOpening(opening) { state.opening = Math.max(0, Math.min(1, opening)); notify(); },
    setSpeed(speed) { state.speed = speed === 0.25 ? 0.25 : 1; notify(); },
    setPlaybackActive(active) {
      state.playbackActive = Boolean(active);
      if (active) release('suspended');
      else notify();
    },
    sample(dt, envelope, speechShape) {
      latestShape = speechShape;
      latestEnvelope = envelope;
      const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
      if (state.mode === 'hold' || state.mode === 'sequence') {
        let name = state.selected;
        if (state.mode === 'sequence') {
          const sequence = MOUTH_SEQUENCES[state.sequence];
          const duration = sequence.reduce((sum, [, seconds]) => sum + seconds, 0);
          sequenceTime = (sequenceTime + step * state.speed) % duration;
          let end = 0;
          name = sequence.find(([, seconds]) => (end += seconds) > sequenceTime)?.[0] ?? 'REST';
        }
        if (state.currentViseme !== name) { state.currentViseme = name; notify(); }
        const target = tuning.visemes[name];
        for (const [key] of MOUTH_CONTROLS) {
          const to = value(target, key), response = key === 'close' ? 0.012 : 0.045;
          shape[key] += (to - shape[key]) * (1 - Math.exp(-step / response));
          if (Math.abs(to - shape[key]) < 0.00001) shape[key] = to;
        }
        output.envelope = state.opening;
        return output;
      }
      if (!handoff) return null;
      handoff.age += step;
      if (handoff.age >= 0.135) { handoff = null; return null; }
      const progress = handoff.age / 0.135;
      const mix = progress * progress * (3 - 2 * progress);
      for (const [key] of MOUTH_CONTROLS) {
        const to = value(speechShape, key);
        shape[key] = handoff.shape[key] + (to - handoff.shape[key]) * mix;
      }
      // Speech closure takes precedence immediately. A held closure releases
      // on the faster closure clock, never delaying an incoming m/b/p.
      shape.close = Math.max(value(speechShape, 'close'),
        handoff.shape.close * Math.exp(-handoff.age / 0.012));
      output.envelope = handoff.envelope + (envelope - handoff.envelope) * mix;
      return output;
    },
  };
}

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

  if (speechLab?.connectMouthLab) {
    content.append(createMouthLab(tuning, refreshJSON, speechLab.connectMouthLab));
  }

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

  content.append(createEyes(tuning, key => {
    refreshJSON();
    status.textContent = '';
    onChange(tuning, key);
  }, refreshJSON));

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

function createMouthLab(tuning, onChange, connect) {
  const group = document.createElement('div');
  group.className = 'speech-lab';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Mouth lab');
  const title = document.createElement('label');
  title.htmlFor = 'mouth-lab-viseme';
  title.textContent = 'Mouth lab';
  const select = document.createElement('select');
  select.id = 'mouth-lab-viseme';
  for (const name of Object.keys(tuning.visemes)) {
    const option = document.createElement('option');
    option.value = option.textContent = name;
    select.append(option);
  }
  const status = document.createElement('span');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  status.style.gridColumn = '1 / -1';
  const actions = document.createElement('div');
  actions.className = 'tuning-footer';
  actions.style.gridColumn = '1 / -1';
  actions.style.flexWrap = 'wrap';
  const hold = document.createElement('button');
  hold.type = 'button'; hold.textContent = 'Hold'; hold.id = 'mouth-lab-hold';
  const off = document.createElement('button');
  off.type = 'button'; off.textContent = 'Off'; off.id = 'mouth-lab-off';
  const sequence = document.createElement('button');
  sequence.type = 'button'; sequence.textContent = 'Sequence'; sequence.id = 'mouth-lab-sequence';
  const sequenceName = document.createElement('select');
  sequenceName.id = 'mouth-lab-sequence-name';
  sequenceName.setAttribute('aria-label', 'Mouth sequence');
  for (const name of Object.keys(MOUTH_SEQUENCES)) {
    const option = document.createElement('option');
    option.value = option.textContent = name;
    sequenceName.append(option);
  }
  const speed = document.createElement('select');
  speed.id = 'mouth-lab-speed';
  speed.setAttribute('aria-label', 'Mouth sequence speed');
  for (const value of [1, 0.25]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = `${value}×`;
    speed.append(option);
  }
  actions.append(hold, off, sequenceName, sequence, speed);
  group.append(title, select, actions);
  const controls = new Map();
  const disabledDuringPlayback = [select, hold, off, sequenceName, sequence, speed];
  const controller = createMouthLabController(tuning, state => {
    for (const control of disabledDuringPlayback) control.disabled = state.playbackActive;
    hold.setAttribute('aria-pressed', String(state.mode === 'hold'));
    off.setAttribute('aria-pressed', String(state.mode === 'off'));
    sequence.setAttribute('aria-pressed', String(state.mode === 'sequence'));
    status.textContent = state.playbackActive ? 'Suspended during playback.'
      : state.mode === 'suspended' ? 'Suspended. Choose Hold or Sequence to reactivate.'
        : state.mode === 'sequence' ? `${state.sequence} · ${state.currentViseme} · ${state.speed}×`
          : state.mode === 'hold' ? `Holding ${state.selected}` : 'Off';
  });
  function slider(key, title, min, max, step, initial, update) {
    const label = document.createElement('label');
    label.className = 'tuning-control';
    label.style.gridColumn = '1 / -1';
    const name = document.createElement('span'); name.textContent = title;
    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range'; input.id = `mouth-lab-${key}`;
    input.min = min; input.max = max; input.step = step; input.value = initial;
    value.htmlFor = input.id; value.value = input.value;
    input.addEventListener('input', () => { value.value = input.value; update(Number(input.value)); });
    label.append(name, value, input);
    group.append(label);
    disabledDuringPlayback.push(input);
    controls.set(key, { input, value });
  }
  slider('opening', 'Opening', 0, 1, 0.01, controller.state.opening, value => controller.setOpening(value));
  for (const [key, label, min, max, step] of MOUTH_CONTROLS) {
    slider(key, label, min, max, step, tuning.visemes[controller.state.selected][key], value => {
      tuning.visemes[controller.state.selected][key] = value;
      onChange();
    });
  }
  select.addEventListener('change', () => {
    if (!controller.select(select.value)) return;
    for (const [key] of MOUTH_CONTROLS) {
      const control = controls.get(key);
      control.input.value = tuning.visemes[select.value][key];
      control.value.value = control.input.value;
    }
  });
  hold.addEventListener('click', () => controller.hold());
  off.addEventListener('click', () => controller.off());
  sequence.addEventListener('click', () => controller.sequence(sequenceName.value));
  sequenceName.addEventListener('change', () => {
    if (controller.state.mode === 'sequence') controller.sequence(sequenceName.value);
  });
  speed.addEventListener('change', () => controller.setSpeed(Number(speed.value)));
  group.append(status);
  connect(controller);
  return group;
}

function createEyes(tuning, onChange, onSelectionSync) {
  const group = document.createElement('div');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Eyes');
  const heading = document.createElement('div');
  heading.textContent = 'Eyes';
  heading.setAttribute('role', 'heading');
  heading.setAttribute('aria-level', '3');
  group.append(heading);

  const names = Object.keys(EXPR), poseKeys = new Set(POSE_KEYS);
  tuning.eyePoses = Object.fromEntries(names.map(name =>
    [name, Object.fromEntries(POSE_CONTROLS.map(([key, , min, max]) =>
      [key, Math.max(min, Math.min(max, Number.isFinite(tuning.eyePoses?.[name]?.[key])
        ? tuning.eyePoses[name][key] : EXPR[name][key]))]))]));
  tuning.eyePose = names.includes(tuning.eyePose) ? tuning.eyePose : names[0];
  tuning.poseIntensity = Number.isFinite(tuning.poseIntensity)
    ? Math.max(0, Math.min(1, tuning.poseIntensity)) : 0;
  const controls = new Map(), poseButtons = new Map();

  function refreshPose() {
    for (const key of POSE_KEYS) {
      const control = controls.get(key);
      tuning[key] = tuning.eyePoses[tuning.eyePose][key];
      if (control) {
        control.input.value = tuning[key];
        control.value.value = control.input.value;
      }
    }
    const intensity = controls.get('poseIntensity');
    if (intensity) {
      intensity.input.value = tuning.poseIntensity;
      intensity.value.value = intensity.input.value;
    }
    for (const [pose, button] of poseButtons) {
      button.setAttribute('aria-pressed', String(pose === tuning.eyePose));
    }
  }

  function selectPose(name) {
    if (!names.includes(name)) return;
    // Explicit clicks can restart a preview after a reply, including another
    // click on the same pose. Main owns selection and the expression readout.
    const intensity = tuning.autoExpressions || tuning.poseIntensity === 0 ? 1 : tuning.poseIntensity;
    document.dispatchEvent(new CustomEvent('nova-pose-select', { detail: { name, intensity } }));
  }

  const poses = document.createElement('div');
  poses.className = 'row tuning-footer';
  poses.style.flexWrap = 'wrap';
  poses.setAttribute('role', 'group');
  poses.setAttribute('aria-label', 'Eye poses');
  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = name.charAt(0).toUpperCase() + name.slice(1);
    button.setAttribute('aria-label', `Eye pose ${name}`);
    button.addEventListener('click', () => selectPose(name));
    poseButtons.set(name, button);
    poses.append(button);
  }
  group.append(poses);

  const help = document.createElement('p');
  help.textContent = 'Intensity 0 is neutral. Sliders sculpt the selected pose at full intensity. Tilt slopes both brows in the same screen direction; brow angle makes a V or worried slope.';
  group.append(help);
  const allControls = [['poseIntensity', 'Pose intensity', 0, 1, 0.01],
    ...POSE_CONTROLS, ...EYE_CONTROLS];
  for (const [key, labelText, min, max, step] of allControls) {
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
    input.value = poseKeys.has(key) ? tuning.eyePoses[tuning.eyePose][key] : tuning[key];
    value.htmlFor = input.id;
    value.value = input.value;
    input.addEventListener('input', () => {
      tuning[key] = Number(input.value);
      if (poseKeys.has(key)) tuning.eyePoses[tuning.eyePose][key] = tuning[key];
      value.value = input.value;
      onChange(key);
    });
    controls.set(key, { input, value });
    label.append(name, value, input);
    group.append(label);
  }
  // This is a one-way UI sync. Feeding it back through applyTuning would
  // accidentally revive a manual preview when speech clears it.
  document.addEventListener('nova-pose', event => {
    const { name, intensity } = event.detail;
    if (names.includes(name)) tuning.eyePose = name;
    if (Number.isFinite(intensity)) tuning.poseIntensity = intensity;
    refreshPose();
    onSelectionSync();
  });
  refreshPose();
  return group;
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

  const toggleLabel = document.createElement('label');
  toggleLabel.className = 'tuning-footer';
  const toggle = document.createElement('input');
  toggle.type = 'checkbox';
  toggle.id = 'tuning-autoExpressions';
  toggle.checked = tuning.autoExpressions;
  const toggleText = document.createElement('span');
  toggleText.textContent = 'Auto expressions';
  toggle.addEventListener('input', () => {
    tuning.autoExpressions = toggle.checked;
    onChange('autoExpressions');
  });
  toggleLabel.append(toggle, toggleText);
  group.append(toggleLabel);

  for (const [key, labelText, min, max, step] of HEAD_CONTROLS) {
    const [root, property] = key.split('.');
    const target = property ? tuning[root] : tuning;
    const targetKey = property || root;
    const label = document.createElement('label');
    label.className = 'tuning-control';
    const name = document.createElement('span');
    name.textContent = labelText;
    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.id = `tuning-${key.replace('.', '-')}`;
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = target[targetKey];
    value.htmlFor = input.id;
    value.value = input.value;
    input.addEventListener('input', () => {
      target[targetKey] = Number(input.value);
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

  const inputs = new Map();
  const presetLabel = document.createElement('label');
  presetLabel.textContent = 'Voice sound ';
  const preset = document.createElement('select');
  preset.setAttribute('aria-label', 'Voice sound');
  for (const [value, text] of [
    ['original', 'Original triangle'], ['sine', 'Sine only'],
    ['digital', 'Sine + digital'], ['balanced', 'Balanced digital'],
    ['fixedHigh', 'Fixed 11.84 ms'], ['fixedLow', 'Fixed 10.5 ms'],
    ['narrow', 'Narrow sweep 10–12 ms'], ['custom', 'Custom']
  ]) {
    const option = new Option(text, value);
    option.disabled = value === 'custom';
    preset.append(option);
  }
  preset.value = 'narrow';
  presetLabel.append(preset);
  group.append(presetLabel);
  const changed = key => { preset.value = 'custom'; onChange(key); };

  const sweepLabel = document.createElement('label');
  sweepLabel.textContent = 'Flange sweep ';
  const sweep = document.createElement('select');
  sweep.setAttribute('aria-label', 'Flange sweep');
  sweep.append(new Option('Triangle', '0'), new Option('Sine', '1'));
  sweep.value = String(tuning.flangerWaveform);
  sweep.addEventListener('change', () => {
    tuning.flangerWaveform = Number(sweep.value);
    changed('flangerWaveform');
  });
  sweepLabel.append(sweep);
  group.append(sweepLabel);

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
    changed('flangerOn');
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
      changed(key);
    });
    label.append(name, value, input);
    group.append(label);
    inputs.set(key, { input, value });
  }

  preset.addEventListener('change', () => {
    const selected = VOICE_EFFECT_PRESETS[preset.value];
    if (!selected) return;
    Object.assign(tuning, selected);
    toggle.checked = tuning.flangerOn;
    sweep.value = String(tuning.flangerWaveform);
    for (const [key, { input, value }] of inputs) {
      input.value = tuning[key];
      value.value = input.value;
    }
    onChange('flangerWaveform');
  });

  const status = document.createElement('span');
  status.className = 'tuning-status';
  status.setAttribute('role', 'status');
  let playbackRequest = 0;
  const buttons = [
    ['dry', 'Dry reference'],
    ['logic', 'Logic reference'],
    ['browser', 'Browser voice effects'],
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
  const listeningLabel = document.createElement('label');
  listeningLabel.className = 'tuning-footer';
  const listening = document.createElement('input');
  listening.type = 'checkbox';
  listening.id = 'speech-lab-listening';
  const listeningText = document.createElement('span');
  listeningText.textContent = 'Preview listening';
  listening.addEventListener('input', () => speechLab.setPreviewListening(listening.checked));
  listeningLabel.append(listening, listeningText);
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
  lab.append(label, select, actions, slowLabel, listeningLabel, captureLabel, captureFile, captureSelect, captureActions, status);

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
