import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// This static-file project has no package.json; load the pure ES module as-is.
const source = await readFile(new URL('../../js/speech-mouth.js', import.meta.url), 'utf8');
const { makeMouthPresets, MOUTH_CHANNELS, buildShapeTimeline, mouthTransitionStart } =
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const alignment = (text, step = .1) => ({
  characters: [...text],
  character_start_times_seconds: [...text].map((_, i) => i * step),
  character_end_times_seconds: [...text].map((_, i) => (i + 1) * step)
});
const timeline = text => buildShapeTimeline({ text, alignment: alignment(text) });
const names = events => events.map(event => event.name);

test('selected presets are complete, fresh, and retain the simple unrounded CH', () => {
  const first = makeMouthPresets(), second = makeMouthPresets();
  for (const shape of Object.values(first)) assert.deepEqual(Object.keys(shape), MOUTH_CHANNELS);
  assert.equal(first.UH.h, 1.3);
  assert.deepEqual(MOUTH_CHANNELS.map(key => first.OU[key]), [.62, .28, 1, 0, 1, 0, 0, 1]);
  assert.deepEqual(MOUTH_CHANNELS.map(key => first.RR[key]), [.99, .42, 1, 0, .6, 0, 0, .4]);
  assert.equal(first.REST.h, 0);
  assert.equal(first.CH.round, 0);
  assert.equal(first.CH.cup, 0);
  assert.equal(first.CH.h, .6);
  first.UH.h = 99;
  assert.equal(second.UH.h, 1.3);
});

test('duck, touch and much use unrounded UH and a single CH where appropriate', () => {
  for (const word of ['duck', 'touch', 'much']) {
    const events = timeline(word);
    assert.ok(names(events).includes('UH'), word);
    assert.ok(events.every(event => !event.shape.round && !event.shape.cup), word);
    assert.equal(names(events).filter(name => name === 'CH').length, word.endsWith('ch') ? 1 : 0);
  }
});

test('CH, lip closure, tuck, OO and long O targets remain distinct', () => {
  assert.deepEqual(names(timeline('chip')), ['CH', 'EE', 'PP']);
  assert.deepEqual(names(timeline('chew')), ['CH', 'OU']);
  for (const word of ['moon', 'room', 'food', 'too']) assert.ok(names(timeline(word)).includes('OU'), word);
  assert.deepEqual(names(timeline('Rome')), ['RR', 'OH', 'OH_END', 'PP']);
  assert.deepEqual(names(timeline('roam')), ['RR', 'OH', 'OH_END', 'PP']);
  for (const word of ['bib', 'mom', 'pop']) assert.equal(timeline(word)[0].shape.close, 1);
  for (const word of ['food', 'van']) assert.equal(timeline(word)[0].shape.tuck, 1);
});

test('bounded common exceptions and unknown words avoid indiscriminate rounding', () => {
  for (const word of ['could', 'should', 'would', 'other', 'love', 'some', 'enough', 'rough', 'blug', 'dobb']) {
    const events = timeline(word);
    assert.ok(names(events).includes('UH'), word);
    const vowelEvents = word === 'would' ? events.slice(1) : events;
    assert.ok(!names(vowelEvents).some(name => ['OU', 'OH', 'OH_END'].includes(name)), word);
  }
  assert.equal(names(timeline('enough')).at(-1), 'FF');
  assert.equal(names(timeline('rough')).at(-1), 'FF');
});

test('supplied timings survive tags and multi-character alignment entries', () => {
  const events = buildShapeTimeline({ text: '[calm] chip', alignment: {
    characters: ['[calm] ', 'ch', 'i', 'p'],
    character_start_times_seconds: [0, .4, .6, .7],
    character_end_times_seconds: [.4, .6, .7, .8]
  } });
  const speech = events.filter(event => event.name !== 'REST');
  assert.deepEqual(names(speech), ['CH', 'EE', 'PP']);
  assert.deepEqual(speech.map(event => event.start), [.4, .6, .7]);
  assert.deepEqual(names(buildShapeTimeline({ alignment: alignment('[ignored]touch[ignored]') })), ['DD', 'UH', 'CH']);
});

test('streamed prefixes use the full word and do not double-trigger a split digraph', () => {
  for (const word of ['touch', 'chew', 'Rome', 'room', 'could', 'time', 'face', 'people', 'right', 'eight', 'know', "I'm", "we're"]) {
    const complete = timeline(word);
    for (let length = 1; length <= word.length; length++) {
      const events = buildShapeTimeline({ text: word, alignment: alignment(word.slice(0, length)) }, { ended: false });
      assert.deepEqual(names(events), names(complete).slice(0, events.length), `${word.slice(0, length)} from ${word}`);
      assert.ok(events.every(event => Number.isFinite(event.start)));
    }
  }
  for (const characters of [['c', 'h', 'ew'], ['ch', 'e', 'w'], ['che', 'w']]) {
    const events = buildShapeTimeline({ text: 'chew', alignment: {
      characters,
      character_start_times_seconds: characters.map((_, i) => i * .2),
      character_end_times_seconds: characters.map((_, i) => (i + 1) * .2)
    } }, { ended: false });
    assert.deepEqual(names(events), ['CH', 'OU']);
  }
});

test('split and truncated leading tags stay silent until aligned speech arrives', () => {
  for (const fragment of ['[', '[cal', 'cal', 'alm', 'lm]']) {
    assert.deepEqual(buildShapeTimeline({ text: '[calm] touch', alignment: alignment(fragment) }, { ended: false }), []);
  }
  const events = buildShapeTimeline({ text: '[calm] touch', alignment: alignment('lm] tou') }, { ended: false });
  assert.deepEqual(names(events), ['REST', 'DD', 'UH']);
  assert.ok(events.every(event => event.shape.round === 0));
});

test('a streamed multi-character vowel never reschedules an already-emitted phase', () => {
  for (const word of ['roam', 'out', 'right', 'eight', 'they']) {
    let previous = [];
    for (let length = 1; length <= word.length; length++) {
      const events = buildShapeTimeline({ text: word, alignment: alignment(word.slice(0, length)) }, { ended: false });
      assert.deepEqual(events.slice(0, previous.length), previous, `${word} prefix ${length}`);
      previous = events;
    }
    assert.deepEqual(previous, timeline(word));
  }
  const prefix = buildShapeTimeline({ text: 'roam', alignment: alignment('ro') }, { ended: false });
  assert.deepEqual(names(prefix), ['RR', 'OH']);
  const vowel = buildShapeTimeline({ text: 'roam', alignment: alignment('roa') }, { ended: false });
  assert.deepEqual(names(vowel), ['RR', 'OH', 'OH_END']);
  assert.ok(Math.abs(vowel.at(-1).start - .23) < 1e-10);
  assert.equal(vowel[1].start, prefix[1].start);
});

test('fast closures and malformed timestamps never reorder subsequent events', () => {
  const events = buildShapeTimeline({ alignment: alignment('bat pip', .01) });
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].start >= events[i - 1].start);

  }
  const malformed = buildShapeTimeline({ alignment: {
    characters: ['b', 'a', 't', ' ', 'o'],
    character_start_times_seconds: [NaN, -.1, .03, Infinity, .02],
    character_end_times_seconds: [Infinity, NaN, .01, .04, -.1]
  } });
  malformed.forEach((event, i) => {
    assert.ok(Number.isFinite(event.start) && event.start >= 0);
    if (i) assert.ok(event.start >= malformed[i - 1].start);
  });
});

test('caller presets are the shape source, including every extra mouth channel', () => {
  const presets = makeMouthPresets();
  presets.UH.h = 1.1;
  const events = buildShapeTimeline({ alignment: alignment('duck') }, { presets });
  assert.strictEqual(events.find(event => event.name === 'UH').shape, presets.UH);
});


test('common long I and long A vowels change shape without changing short vowels', () => {
  for (const word of ['I', "I'm", 'time', 'like', 'five', 'nice', 'my', 'why', 'try', 'right', 'night', 'pie', 'times', 'liked']) {
    const n = names(timeline(word));
    assert.ok(n.some((name, i) => name === 'AA' && n[i + 1] === 'EE'), word);
  }
  for (const word of ['face', 'make', 'same', 'day', 'rain', 'they', 'great', 'eight', 'weight', 'faces', 'named']) {
    const n = names(timeline(word));
    assert.ok(n.some((name, i) => name === 'E' && n[i + 1] === 'EE'), word);
    assert.ok(!n.includes('AA'), word);
  }
  for (const word of ['give', 'live', 'service', 'office', 'promise', 'machine', 'chip', 'happy']) {
    const n = names(timeline(word));
    assert.ok(!n.some((name, i) => name === 'AA' && n[i + 1] === 'EE'), word);
  }
  for (const word of ['have', 'said', 'says', 'again']) {
    const n = names(timeline(word));
    assert.ok(!n.some((name, i) => name === 'E' && n[i + 1] === 'EE'), word);
  }
  assert.deepEqual(names(timeline('face')), ['FF', 'E', 'EE', 'SS']);
  for (const word of ['she', 'he', 'we', 'me', 'be']) assert.ok(names(timeline(word)).includes('EE'), word);
  assert.deepEqual(names(timeline('people')), ['PP', 'EE', 'PP', 'DD']);
  assert.deepEqual(names(timeline('know')), ['DD', 'OH', 'OH_END']);
  assert.ok(names(timeline('slowly')).includes('OH'));
  assert.ok(!names(timeline('now')).includes('OH'));
  assert.ok(names(timeline('height')).includes('AA'));
});

test('quick closures retain aligned vowel time instead of carrying a fixed hold through the word', () => {
  const events = buildShapeTimeline({ text: 'baby', alignment: alignment('baby', .035) });
  assert.deepEqual(events.map(e => e.start), [0, .035, .07, 3 * .035]);
  assert.deepEqual(names(events), ['PP', 'AA', 'PP', 'EE']);
  const starts = events.map((_, i) => mouthTransitionStart(events, i));
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] > starts[i - 1]);
    assert.ok(starts[i] <= events[i].start);
  }
  assert.equal(starts[1], .035, 'short closures keep their entire aligned interval');
  assert.equal(mouthTransitionStart(events, events.length), Infinity);
  const overlap = buildShapeTimeline({ alignment: {
    characters: ['bat', 'pip'], character_start_times_seconds: [0, .02], character_end_times_seconds: [.12, .08]
  }});
  assert.ok(overlap.every((e, i) => !i || e.start >= overlap[i - 1].start));
});
