# Repository rules

- Do not add dependencies or CDNs without user approval.
- Never search for, generate, or download assets unless the prompt provides their exact URLs.
- Never put API keys, secrets, the ElevenLabs agent ID, or conversation logs anywhere in this repository.
- Story and lore are kept outside this repository on purpose. Never add backstory to code, lines or docs unless the prompt supplies the exact text.
- `docs/CHARACTER.md` is public and holds the live character prompt. Change it only when the task explicitly asks.
- `spike/` is a throwaway test bench. Do not build product features on it or import it from the main page.
- Treat `reference/` as read-only. Do not edit, move, or delete its contents.
- Keep `js/shapes.js` pure: no DOM access, three.js imports, or external state changes.
- Keep the `js/voice.js` interface stable: `preload(ids)` returns a Promise; `speak(id)` returns a Promise that resolves when the line ends or is stopped; `stop()`, `currentEnvelope()`, `currentShape()` returning the smoothed `{w, h, round, close}`, `setSoundOn(bool)`, and `update(dt)` called once per frame.
- Use plain ES modules and static files. Do not add a build step, `package.json`, or npm tooling.
- Change visual values, timings, expression values, particle counts or copy only when the task explicitly asks for it.
- Never run `scripts/make_voice.py` with `--go` or `--force`, and never read `~/.nova-key`; generation costs money and is run only by the user.
