export const FLANGER_DEFAULTS = {
  flangerOn: true,
  flangerRate: 0.133,
  flangerBaseDelay: 6.17,
  flangerDepth: 5.67,
  flangerFeedback: 0.39,
  flangerMix: 0.43
};

const PARAMS = {
  flangerOn: 'enabled', flangerRate: 'rateHz', flangerBaseDelay: 'baseDelayMs',
  flangerDepth: 'depthMs', flangerFeedback: 'feedback', flangerMix: 'mix'
};
const modules = new WeakMap();
let warned = false;
let settings = { ...FLANGER_DEFAULTS };
let graph = null, references = null, reference = null, referenceId = 0;

export async function createFlangerNode(context, tuning = FLANGER_DEFAULTS) {
  try {
    if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      throw new Error('AudioWorklet is unavailable');
    }
    if (!modules.has(context)) {
      modules.set(context, context.audioWorklet.addModule(new URL('./flanger-worklet.js', import.meta.url)));
    }
    await modules.get(context);
    return new AudioWorkletNode(context, 'nova-flanger', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      parameterData: Object.fromEntries(Object.entries(PARAMS).map(([key, name]) => [name, Number(tuning[key])]))
    });
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn('Voice flanger unavailable; using dry audio.', error);
    }
    return null;
  }
}

export function setFlangerTuning(tuning) {
  for (const key of Object.keys(PARAMS)) settings[key] = tuning[key];
  if (!graph?.node) return;
  for (const [key, name] of Object.entries(PARAMS)) {
    graph.node.parameters.get(name).setValueAtTime(Number(settings[key]), graph.context.currentTime);
  }
}

// The voice API stays unchanged; this graph owns only the downstream effect.
export function createVoiceEffect(context, output) {
  const effect = {
    context, output, node: null,
    get input() { return this.node || output; },
    reset() { this.node?.port.postMessage({ type: 'reset' }); }
  };
  graph = effect;
  effect.ready = createFlangerNode(context, settings).then(node => {
    effect.node = node;
    if (node) { node.connect(output); setFlangerTuning(settings); }
  });
  return effect;
}

export function loadReferenceClips() {
  if (!graph) return Promise.resolve(false);
  if (!references) {
    references = Promise.all(['luna-dry.wav', 'luna-flange.wav'].map(async name => {
      const response = await fetch(new URL(`../refs/audio/${name}`, import.meta.url));
      if (!response.ok) throw new Error('Reference unavailable');
      return graph.context.decodeAudioData(await response.arrayBuffer());
    })).catch(() => null);
  }
  return references.then(buffers => Boolean(buffers));
}

export function stopReferenceClip() {
  referenceId++;
  if (reference) {
    const playing = reference;
    reference = null;
    playing.source.onended = null;
    playing.source.stop();
    playing.source.disconnect();
    playing.resolve();
  }
}

export async function playReferenceClip(kind) {
  stopReferenceClip();
  const id = referenceId;
  if (!graph || !['dry', 'logic', 'browser'].includes(kind)) return;
  // Resume immediately inside the button gesture, before waiting for files.
  const [, , available] = await Promise.all([
    graph.context.resume(), graph.ready, loadReferenceClips()
  ]);
  if (!available || id !== referenceId) return;
  const buffers = await references;
  if (id !== referenceId) return;
  return new Promise(resolve => {
    const source = graph.context.createBufferSource();
    source.buffer = buffers[kind === 'logic' ? 1 : 0];
    source.connect(kind === 'browser' ? graph.input : graph.output);
    reference = { source, resolve };
    source.onended = () => {
      if (reference?.source !== source) return;
      reference = null;
      source.disconnect();
      resolve();
    };
    if (kind === 'browser') graph.reset();
    source.start();
  });
}
