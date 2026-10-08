# Nova (project codename): Syra

A live voice character with a face made of light. Syra is an AI found in a dead network. You talk to her, she answers live, and her face (tens of thousands of particles sampled from an image) speaks with her.

## Run

Serve the static files with `python3 -m http.server 4173`, then open `http://localhost:4173/` in Safari.

URL options:

- `?tune=1`: tuning panel and Speech lab (plays the pre-generated lines). Tuning resets on reload; tuned values are baked into `js/stage.js`.
- `?n=…`: particle count, 4,000 to 64,000.

## Other pages

- `spike/agent.html`: live-agent test bench. It connects to the ElevenLabs agent (paste the agent ID each run; it is never stored) and logs timing, text and output volume. Downloaded logs contain your own speech, so never commit them.

## Docs

- `docs/CHARACTER.md`: Syra's public character sheet and live system prompt.
- `ASSETS.md`: where each asset came from.
- `AGENTS.md`: rules for coding agents working in this repo.

## Voice

ElevenLabs. Pre-generated lines are made with `scripts/make_voice.py` (dry run by default; generating costs credits and is run only by the owner). The live voice comes from an ElevenLabs agent configured in the ElevenLabs dashboard.
