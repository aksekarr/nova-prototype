# Nova (project codename): Syra

A live voice character with a face made of light. Syra is an AI found in a dead network. You talk to her, she answers live, and her face (tens of thousands of particles sampled from an image) speaks with her.

## Run

Serve the static files with `python3 -m http.server 4173`, then open `http://localhost:4173/` in Safari.

URL options:

- `?tune=1`: tuning panel and Speech lab (plays the pre-generated lines). Tuning resets on reload; tuned values are baked into `js/stage.js`.
- `?n=…`: particle count, 4,000 to 64,000.

Dev captures: with `?live=1`, enable **Capture replies** before a reply starts, then **Download captures** to save the session. Captures contain only output delivered to the live player and stay in memory until downloaded. Keep files in `refs/live/` (already gitignored); never commit them. With `?tune=1`, use **Load capture…** and **Replay** in Speech lab; add `&live=1` to capture **Simulate live** replies too.

## Other pages

- `nebula.html`: compare Original / Enhanced illumination on the same nebula, plus a Face control. The existing particle distribution, motion and base palette are preserved. Enhanced adds travelling colour, gentle nucleus pulses and sparse branching arcs with local cloud illumination. Desktop defaults to the same 32,000 particles as the main scene (9,000 on small screens); `?n=` overrides the count. Reduced motion keeps a static colour lift and suppresses pulses/arcs. The main scene uses the enhancement too; `?nebula=original` retains the original rendering.

- `jelly.html`: 48,000-particle jellyfish study. The face feeds a single upper-right stream while the bell forms; the bell then leads along a curved path, with trailing ribbons following its route and gentle lengthwise contractions. Explicit Face / Jellyfish controls only, with a direct reduced-motion alternative.
- `orbit.html`: standalone orbital form for future text chat, with 48,000 particles by default.
- `morph.html`: explicit **Face / Orbit** visual study. A fixed particle mapping preserves all 48,000 identities through an immediate gathering motion that fully settles in two seconds, including interrupted returns. Reduced motion uses a short direct interpolation. This page has no voice connection or idle timer; the main voice page is unchanged. All form studies accept `?n=…`.

- `spike/agent.html`: live-agent test bench. It connects to the ElevenLabs agent (paste the agent ID each run; it is never stored) and logs timing, text and output volume. Downloaded logs contain your own speech, so never commit them.

## Docs

- `docs/CHARACTER.md`: Syra's public character sheet and live system prompt.
- `ASSETS.md`: where each asset came from.
- `AGENTS.md`: rules for coding agents working in this repo.

## Voice

ElevenLabs. Pre-generated lines are made with `scripts/make_voice.py` (dry run by default; generating costs credits and is run only by the owner). The live voice comes from an ElevenLabs agent configured in the ElevenLabs dashboard.
