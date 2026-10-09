// A small English spelling approximation, using the character alignment we have.
// Keep these pure helpers shared by speech playback and the editable mouth lab.
export const MOUTH_CHANNELS = Object.freeze(['w', 'h', 'round', 'close', 'cup', 'square', 'tuck', 'oval']);
const VALUES = {
  REST: [1, 0, 0, 0, 0, 0, 0, 0],
  PP: [.95, 1, 0, 1, 0, 0, 0, 0],
  FF: [1, .12, 0, 0, 0, 0, 1, 0],
  DD: [1.08, .25, 0, 0, 0, 0, 0, 0],
  SS: [1.08, .14, 0, 0, 0, .12, 0, 0],
  CH: [.92, .6, 0, 0, 0, .3, 0, 0],
  RR: [.99, .42, 1, 0, .6, 0, 0, .4],
  AA: [1.12, 1.4, 0, 0, 0, 0, 0, .24],
  UH: [1.02, 1.3, 0, 0, 0, 0, 0, .3],
  E: [1.12, .72, 0, 0, 0, 0, 0, .32],
  EE: [1.22, .36, 0, 0, 0, 0, 0, .08],
  OH: [.90, .85, .5, 0, .3, 0, 0, .6],
  OH_END: [.74, .2, 1, 0, .9, 0, 0, .9],
  OU: [.62, .28, 1, 0, 1, 0, 0, 1]
};
export function makeMouthPresets() {
  return Object.fromEntries(Object.entries(VALUES).map(([name, values]) =>
    [name, Object.fromEntries(MOUTH_CHANNELS.map((key, i) => [key, values[i]]))]));
}
const PRESETS = makeMouthPresets();
const CONSONANTS = { b: 'PP', m: 'PP', p: 'PP', f: 'FF', v: 'FF', r: 'RR',
  t: 'DD', d: 'DD', n: 'DD', l: 'DD', k: 'DD', g: 'DD', c: 'DD',
  s: 'SS', z: 'SS', j: 'CH', w: 'OU', q: 'DD' };
const SHORT_OU = /^(?:touch|rough|tough|enough|young|couple|country|cousin|trouble|double|could|should|would)(?:s|ed|ing)?$/;
const SHORT_O = /^(?:love|some|come|done|none|one|above|shove|dove|glove)(?:s|d|ly|thing|body|one|where)?$/;
const SHORT_OO = /^(?:book|look|cook|took|good|wood|foot|wool|stood|hood)(?:s|ed|ing)?$/;
const LONG_O = /^(?:go|no|so|oh|hello|also|both|most|only|old|cold|gold|hold|told|sold)$/;
const LONG_U = /^(?:to|do|who|two|you|your|shoe|through)(?:s)?$/;
const WORD = /[a-z]+(?:['’][a-z]+)*/gi;

function alignedText(alignment, sourceText) {
  const characters = alignment.characters || [];
  const starts = alignment.character_start_times_seconds || [];
  const ends = alignment.character_end_times_seconds || [];
  const joined = characters.join('');
  const leading = sourceText.match(/^\s*(?:\[[^\]]*\]\s*)+/)?.[0] || '';
  const close = joined.indexOf(']'), open = joined.indexOf('[');
  const unfinished = joined.trim() && close < 0 && open < 0 &&
    Array.from(leading, (_, i) => leading.slice(i)).some(s => s.startsWith(joined) && s.includes(']'));
  let inTag = !!leading && (unfinished || (close >= 0 && (open < 0 || close < open)));
  let text = '', previous = 0;
  const times = [], endTimes = [];
  characters.forEach((entry, i) => {
    const chars = Array.from(String(entry));
    const start = Math.max(previous, Number.isFinite(starts[i]) ? starts[i] : previous, 0);
    const next = Number.isFinite(starts[i + 1]) ? starts[i + 1] : start;
    const end = Math.max(start, Number.isFinite(ends[i]) ? ends[i] : next);
    previous = start;
    chars.forEach((char, j) => {
      if (char === '[') inTag = true;
      else if (char === ']') inTag = false;
      else if (!inTag) {
        text += char;
        for (let k = 0; k < char.length; k++) {
          times.push(start + (end - start) * j / chars.length);
          endTimes.push(start + (end - start) * (j + 1) / chars.length);
        }
      }
    });
  });
  return { text, times, endTimes };
}

function wordShapes(word) {
  const result = [];
  for (let i = 0; i < word.length;) {
    const char = word[i], pair = word.slice(i, i + 2);
    let count = 1, names;
    if (/^(ch|sh)$/.test(pair)) { count = 2; names = ['CH']; }
    else if (pair === 'ph') { count = 2; names = ['FF']; }
    else if (/^(th|ck|ng)$/.test(pair)) { count = 2; names = ['DD']; }
    else if (pair === 'gh') {
      count = 2; names = /^(?:enough|rough|tough|cough|laugh)/.test(word) ? ['FF'] : [];
    } else if (char === 'l' && /^(?:could|should|would)$/.test(word)) names = [];
    else if (pair === 'oo') { count = 2; names = [SHORT_OO.test(word) ? 'UH' : 'OU']; }
    else if (pair === 'ou') {
      count = 2;
      names = SHORT_OU.test(word) ? ['UH'] : LONG_U.test(word) ? ['OU'] :
        /^(?:though|although|dough)$/.test(word) ? ['OH', 'OH_END'] : ['AA', 'OU'];
    } else if (pair === 'oa' || pair === 'oe') {
      count = 2; names = LONG_U.test(word) ? ['OU'] : ['OH', 'OH_END'];
    } else if (pair === 'ew' || pair === 'ue') { count = 2; names = ['OU']; }
    else if (pair === 'ee' || pair === 'ea') { count = 2; names = ['EE']; }
    else if (pair === 'ai' || pair === 'ay') { count = 2; names = ['E']; }
    else if (char === 'o') {
      names = LONG_U.test(word) ? ['OU'] : !SHORT_O.test(word) &&
        (LONG_O.test(word) || /o[^aeiou]e$/.test(word)) ? ['OH', 'OH_END'] : ['UH'];
    } else if (char === 'e' && i === word.length - 1 && word.length > 3) names = [];
    else names = [{ a: 'AA', u: 'UH', e: 'E', i: 'EE', y: 'EE' }[char] || CONSONANTS[char]].filter(Boolean);
    if (names.length) result.push({ index: i, length: count, names });
    i += count;
  }
  return result;
}

// `text` is the full reply when available. It disambiguates a trailing streamed
// word prefix; only characters whose alignment has arrived produce events.
// Multi-character alignment entries share their supplied interval evenly.
export function buildShapeTimeline({ alignment = {}, text = '' }, { presets = PRESETS, ended = true } = {}) {
  const visible = alignedText(alignment, text);
  const sourceWords = (text.replace(/\[[^\]]*\]/g, '').match(WORD) || []).map(w => w.toLowerCase());
  const timeline = [];
  let nextWord = 0, cursor = 0;
  const push = (start, name) => {
    if (timeline.at(-1)?.name !== name) timeline.push({ start, name, shape: presets[name] });
  };
  const gaps = end => {
    for (; cursor < end; cursor++) if (/[\s\p{P}]/u.test(visible.text[cursor])) push(visible.times[cursor], 'REST');
  };
  for (const match of visible.text.matchAll(WORD)) {
    gaps(match.index);
    const alignedWord = match[0].toLowerCase();
    const partial = !ended && match.index + match[0].length === visible.text.length;
    const found = sourceWords.findIndex((word, i) => i >= nextWord &&
      (word === alignedWord || (partial && word.startsWith(alignedWord))));
    const word = found < 0 ? alignedWord : sourceWords[found];
    if (found >= 0) nextWord = found + 1;
    for (const unit of wordShapes(word)) {
      if (unit.index >= alignedWord.length) break;
      const index = match.index + unit.index;
      const last = match.index + Math.min(alignedWord.length, unit.index + unit.length) - 1;
      const start = visible.times[index], end = visible.endTimes[last];
      const complete = unit.index + unit.length <= alignedWord.length;
      // A diphthong's end time is stable only after its entire spelling arrived.
      // Otherwise adding the next vowel could move an already-played phase later.
      unit.names.forEach((name, i) => {
        if (i === 0 || complete) push(start + (end - start) * i * .65, name);
      });
    }
    cursor = match.index + match[0].length;
  }
  gaps(visible.text.length);
  // A closure lasts at least 70 ms. Carry the delay forward so short adjacent
  // characters and rests cannot put subsequent events back before the closure.
  for (let i = 1; i < timeline.length; i++) {
    const previous = timeline[i - 1];
    timeline[i].start = Math.max(timeline[i].start, previous.start + (previous.shape.close ? .07 : 0));
  }
  return timeline;
}
