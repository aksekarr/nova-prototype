# Seni

A particle-based character with a voice landing page. Meet Seni forms her face,
plays the existing name-free introduction, then settles into her idle presence.
This version uses cached audio only; chat and live conversation come later.

## Run

Serve the static files with `python3 -m http.server 4173`, then open `http://localhost:4173/` in Safari.

The main page is the voice landing experience, with **Meet Seni**, sound,
replay and return controls. After the introduction, **Surprise me** cycles
**Seni → Jellyfish → Atom → Seni**. The jellyfish gathers into the centre before
the atom's rings unfold. **Back to Seni** returns silently to
her face, including during a transition. It never asks for microphone access,
and speech text is not displayed. Chat is reserved for a later build.

The face/nebula retain their 32,000 desktop and 9,000 small-screen defaults.
The alternate forms retain 48,000 particles, using a separate geometry in the
same renderer. Extra particles emerge during the transition and fade on return.
`?n=` explicitly overrides both pools. Form preparation happens during initial
setup; idle geometry is allocated once on first use, then reused.

The previous form-study page is preserved at `study.html`. Existing `?tune=1`
and `?live=1` links redirect there, retaining their parameters. Preview pages
and their particle defaults remain unchanged.

URL options:

- `?tune=1`: tuning panel and Speech lab (plays the pre-generated lines). Tuning resets on reload; tuned values are baked into `js/stage.js`.
- `?n=…`: particle count, 4,000 to 64,000.

Dev captures: with `?live=1`, enable **Capture replies** before a reply starts, then **Download captures** to save the session. Captures contain only output delivered to the live player and stay in memory until downloaded. Keep files in `refs/live/` (already gitignored); never commit them. With `?tune=1`, use **Load capture…** and **Replay** in Speech lab; add `&live=1` to capture **Simulate live** replies too.

## Other pages

- `nebula.html`: compare Original / Enhanced illumination on the same nebula, plus a Face control. The existing particle distribution, motion and base palette are preserved. Enhanced adds travelling colour, gentle nucleus pulses and sparse branching arcs with local cloud illumination. Desktop defaults to the same 32,000 particles as the main scene (9,000 on small screens); `?n=` overrides the count. Reduced motion keeps a static colour lift and suppresses pulses/arcs. The main scene uses the enhancement too; `?nebula=original` retains the original rendering.

- `lotus.html`: separate 48,000-particle Celestial Lotus study. A closed bud opens into layered, breathing petals with travelling light and drifting pollen; **Bloom again** repeats the opening. Reduced motion shows the open flower at rest. Accepts `?n=…`.
- `jelly.html`: 48,000-particle jellyfish study. The face feeds a single upper-right stream while the bell forms; the bell then leads along a curved path, with trailing ribbons following its route and gentle lengthwise contractions. Explicit Face / Jellyfish controls only, with a direct reduced-motion alternative.
- `orbit.html`: standalone orbital form for future text chat, with 48,000 particles by default.
- `morph.html`: explicit **Face / Orbit** visual study. A fixed particle mapping preserves all 48,000 identities through an immediate gathering motion that fully settles in two seconds, including interrupted returns. Reduced motion uses a short direct interpolation. This page has no voice connection or idle timer. All form studies accept `?n=…`.

- `spike/agent.html`: live-agent test bench. It connects to the ElevenLabs agent (paste the agent ID each run; it is never stored) and logs timing, text and output volume. Downloaded logs contain your own speech, so never commit them.

## Code organisation and checks

`js/landing.js` wires the landing page to the existing renderer and voice player;
`js/landing-flow.js` owns its cancellable greeting and form-selection lifecycle.
`js/landing-forms.js` adapts the existing form generators and morphs to the
landing's two particle counts. `js/stage.js` opts into that path only for the
landing page; the standalone studies keep their own rendering paths.
`js/main.js` wires the separate study page, face and renderer together. The existing cached demo
and speech-lab interactions live in `js/study-flow.js`; `js/live.js` is loaded only
with `?live=1`. Pure pose and expression controllers live in
`js/face-expressions.js`, with their existing exports also available from
`js/face.js`.

Run the local regression suite with
`node --test scripts/*.test.mjs scripts/mouth-study/*.test.mjs`. No package install
or build step is required. Tests use synthetic voice/provider boundaries and do
not contact ElevenLabs or request a microphone.

The live adapter still needs a verified reply boundary before product integration:
the pinned SDK reports “listening” for both a completed reply and an empty output
queue during a transport gap. The local cached voice flow does not use that path.

Some legacy code in `js/shapes.js` deliberately consumes random draws to preserve
the approved particle layouts. Keep that order intact during future cleanup.

## Docs

- `docs/CHARACTER.md`: Syra's public character sheet and live system prompt.
- `ASSETS.md`: where each asset came from.
- `AGENTS.md`: rules for coding agents working in this repo.

## Voice

ElevenLabs. Pre-generated lines are made with `scripts/make_voice.py` (dry run by default; generating costs credits and is run only by the owner). The live voice comes from an ElevenLabs agent configured in the ElevenLabs dashboard.
