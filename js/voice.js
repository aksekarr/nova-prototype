const VOWELS = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [640, 1190], [490, 1350]];

export function createVoice({ caption, readout, getClock, onFrame, onRender }) {
  let speech = null;
  let soundOn = true;
  let ac = null;
  let gainNode, f1, f2, osc;
  let env = 0, envS = 0;

  function ensureAudio() {
    if (!ac) initAudio();
    if (ac && ac.state === 'suspended') ac.resume();
  }

  // Capture button gestures before their handlers start speech.
  document.addEventListener('click', (event) => {
    if (event.target.closest('button')) ensureAudio();
  }, true);

  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();

    osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 118;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 5.2;
    const lg = ac.createGain();
    lg.gain.value = 3;
    lfo.connect(lg);
    lg.connect(osc.frequency);

    f1 = ac.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 7;
    f2 = ac.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 9;
    gainNode = ac.createGain();
    gainNode.gain.value = 0;
    const body = ac.createBiquadFilter();
    body.type = 'lowpass';
    body.frequency.value = 900;
    const bodyGain = ac.createGain();
    bodyGain.gain.value = 0.35;
    const makeup = ac.createGain();
    makeup.gain.value = 3.2;

    osc.connect(f1);
    osc.connect(f2);
    osc.connect(body);
    body.connect(bodyGain);
    f1.connect(makeup);
    f2.connect(makeup);
    bodyGain.connect(makeup);
    makeup.connect(gainNode);
    const comp = ac.createDynamicsCompressor();
    gainNode.connect(comp);
    comp.connect(ac.destination);
    osc.start();
    lfo.start();
  }

  function speak(text) {
    return new Promise((resolve) => {
      const words = text.split(/\s+/);
      const tl = [];
      let cursor = 0.15;
      words.forEach((word, wi) => {
        const syl = Math.max(1, (word.toLowerCase().match(/[aeiouy]+/g) || []).length);
        for (let s = 0; s < syl; s++) {
          const d = 0.13 + Math.random() * 0.09;
          tl.push({ s: cursor, d, a: 0.55 + Math.random() * 0.45, w: wi, v: Math.floor(Math.random() * VOWELS.length) });
          cursor += d * 0.92;
        }
        cursor += 0.05;
        if (/[,;]$/.test(word)) cursor += 0.22;
        if (/[.!?]$/.test(word)) cursor += 0.38;
      });

      caption.className = 'caption';
      caption.innerHTML = '';
      const spans = words.map((word) => {
        const span = document.createElement('span');
        span.className = 'w';
        span.textContent = word;
        caption.appendChild(span);
        caption.appendChild(document.createTextNode(' '));
        return span;
      });
      speech = { tl, t0: getClock(), end: cursor + 0.15, k: 0, spans, shown: -1, lastV: -1, resolve };
      readout.textContent = 'Speaking';
      readout.classList.add('live');
    });
  }

  function stop() {
    if (!speech) return;
    const resolve = speech.resolve;
    speech = null;
    env = 0;
    readout.textContent = 'Silent';
    readout.classList.remove('live');
    resolve();
  }

  function updateSpeech(clock) {
    env = 0;
    if (!speech) return;
    const ts = clock - speech.t0;
    const tl = speech.tl;
    while (speech.k < tl.length && tl[speech.k].s + tl[speech.k].d < ts) speech.k++;
    const syl = tl[speech.k];
    if (syl && ts >= syl.s) {
      env = syl.a * Math.pow(Math.sin(Math.PI * (ts - syl.s) / syl.d), 0.6);
      if (syl.w > speech.shown) {
        for (let w = speech.shown + 1; w <= syl.w; w++) speech.spans[w].classList.add('on');
        speech.shown = syl.w;
      }
      if (ac && syl.v !== speech.lastV) {
        speech.lastV = syl.v;
        f1.frequency.setTargetAtTime(VOWELS[syl.v][0], ac.currentTime, 0.03);
        f2.frequency.setTargetAtTime(VOWELS[syl.v][1], ac.currentTime, 0.03);
        osc.frequency.setTargetAtTime(108 + syl.a * 22, ac.currentTime, 0.05);
      }
    }
    if (ts > speech.end) {
      speech.spans.forEach((span) => { span.classList.add('on'); });
      stop();
    }
  }

  // Keep the envelope and audio scheduling aligned with the shared stage clock.
  onFrame((dt, clock) => {
    updateSpeech(clock);
    envS += (env - envS) * Math.min(1, dt * 28);
  });
  onRender(() => {
    if (ac) gainNode.gain.setTargetAtTime(soundOn ? envS * 0.8 : 0, ac.currentTime, 0.02);
  });

  function currentEnvelope() {
    return envS;
  }

  function setSoundOn(value) {
    soundOn = value;
  }

  return { speak, stop, currentEnvelope, setSoundOn };
}
