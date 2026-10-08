// Development-only stream transport capture. No microphone or conversation
// callbacks reach this module: its only input is the player's stream API.
const METHODS = ['setText', 'addAudio', 'addAlignment', 'end', 'interrupt'];
const SAMPLE_RATE = 44100;
const copy = value => value !== null && typeof value === 'object'
  ? JSON.parse(JSON.stringify(value)) : value;

export function createCaptureRecorder(stream, { onChange = () => {} } = {}) {
  const original = Object.fromEntries(['begin', ...METHODS].map(name => [name, stream[name]]));
  const replies = [];
  const capturedAt = new Date().toISOString();
  let enabled = false, current = null;

  function settle(record) {
    if (!record || record.finished || !record.handle.inspect().finished) return;
    record.finished = true;
    if (!record.reply) return;
    record.reply.interrupted = record.handle.inspect().interrupted;
    replies.push(record.reply);
    onChange();
  }

  function invoke(record, type, call, args) {
    const arrivedAt = performance.now();
    settle(record);
    if (record?.reply && !record.finished) {
      const data = args.length ? copy(args[0]) : null;
      record.reply.events.push({ t: Math.max(0, arrivedAt - record.startedAt), type, data });
      if (type === 'setText') record.reply.text = data;
    }
    const result = call(...args);
    if (type === 'end') Promise.resolve(result).then(() => settle(record), () => settle(record));
    settle(record);
    return result;
  }

  stream.begin = function (...args) {
    settle(current);
    // begin() already stops the preceding reply. Make that interruption an
    // explicit stream call so its cut-off also survives standalone replay.
    if (current && !current.finished) {
      invoke(current, 'interrupt', current.handle.interrupt.bind(current.handle), []);
    }
    const startedAt = performance.now();
    const handle = original.begin.apply(stream, args);
    const record = {
      handle, startedAt, finished: false,
      reply: enabled ? { text: '', interrupted: false,
        events: [{ t: 0, type: 'begin', data: null }] } : null
    };
    current = record;
    return Object.assign({}, handle, Object.fromEntries(METHODS.map(type => [type,
      (...values) => invoke(record, type, handle[type].bind(handle), values)
    ])));
  };
  for (const type of METHODS) {
    stream[type] = (...args) => invoke(current, type, original[type].bind(stream), args);
  }

  return {
    setEnabled(value) { enabled = Boolean(value); },
    get count() { settle(current); return replies.length; },
    snapshot() {
      settle(current);
      return { version: 1, capturedAt, sampleRate: SAMPLE_RATE, replies: copy(replies) };
    }
  };
}

function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validAlignment(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Array.isArray(value.chars) && value.chars.every(char => typeof char === 'string') &&
    ['char_start_times_ms', 'char_durations_ms'].every(key =>
      Array.isArray(value[key]) && value[key].length === value.chars.length &&
      value[key].every(time => Number.isFinite(time) && time >= 0));
}

function validAudio(value) {
  if (typeof value !== 'string') return false;
  try {
    const length = atob(value).length;
    return length > 0 && length % 2 === 0;
  } catch { return false; }
}

export function parseCapture(value) {
  const session = typeof value === 'string' ? JSON.parse(value) : value;
  const invalid = () => { throw new Error('Invalid capture file. Expected a version 1 Nova capture.'); };
  if (!hasKeys(session, ['version', 'capturedAt', 'sampleRate', 'replies']) ||
      session.version !== 1 || session.sampleRate !== SAMPLE_RATE ||
      typeof session.capturedAt !== 'string' || !Number.isFinite(Date.parse(session.capturedAt)) ||
      !Array.isArray(session.replies)) invalid();
  for (const reply of session.replies) {
    if (!hasKeys(reply, ['text', 'interrupted', 'events']) || typeof reply.text !== 'string' ||
        typeof reply.interrupted !== 'boolean' || !Array.isArray(reply.events) || !reply.events.length) invalid();
    let previous = 0, text = '', interrupted = false, ended = false;
    for (let i = 0; i < reply.events.length; i++) {
      const event = reply.events[i];
      if (!hasKeys(event, ['t', 'type', 'data']) || !Number.isFinite(event.t) ||
          event.t < previous || event.t > 2147483647 || interrupted) invalid();
      previous = event.t;
      if (!i) {
        if (event.type !== 'begin' || event.t !== 0 || event.data !== null) invalid();
      } else if (event.type === 'setText') {
        if (typeof event.data !== 'string') invalid();
        text = event.data;
      } else if (event.type === 'addAudio') {
        if (!validAudio(event.data)) invalid();
      } else if (event.type === 'addAlignment') {
        if (!validAlignment(event.data)) invalid();
      } else if (event.type === 'end' || event.type === 'interrupt') {
        if (event.data !== null) invalid();
        if (event.type === 'interrupt') interrupted = true;
        else ended = true;
      } else invalid();
    }
    if ((!ended && !interrupted) || interrupted !== reply.interrupted || text !== reply.text) invalid();
  }
  return copy(session);
}

export function startCaptureReplay(voice, capture) {
  const startedAt = performance.now();
  const reply = voice.stream.begin();
  let next = 1, timer = null, cancelled = false, playbackFinished = false;
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const finish = () => {
    if (cancelled || (playbackFinished && next === capture.events.length)) resolveDone(reply.inspect());
  };

  function deliver() {
    timer = null;
    if (cancelled) return;
    try {
      while (next < capture.events.length && capture.events[next].t <= performance.now() - startedAt) {
        const event = capture.events[next++];
        if (event.type === 'end') {
          Promise.resolve(reply.end()).then(() => { playbackFinished = true; finish(); }, rejectDone);
        } else if (event.type === 'interrupt') {
          reply.interrupt();
          playbackFinished = true;
        } else reply[event.type](event.data);
      }
      if (next < capture.events.length) {
        timer = setTimeout(deliver, Math.max(0, capture.events[next].t - (performance.now() - startedAt)));
      }
      finish();
    } catch (error) {
      cancelled = true;
      reply.interrupt();
      rejectDone(error);
    }
  }
  deliver();
  return {
    done,
    inspect: () => reply.inspect(),
    interrupt() {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timer);
      reply.interrupt();
      finish();
    }
  };
}
