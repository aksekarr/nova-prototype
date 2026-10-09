# Seni

A particle-based character with a voice landing page. Meet Seni forms her face
and opens a voice conversation when an ElevenLabs agent is configured. Without
runtime configuration, the page keeps the existing name-free cached introduction.
Speech text is never displayed. Chat remains reserved for a later build.

## Run

Run `python3 scripts/serve.py`, then open `http://127.0.0.1:4173/` in Safari.
The server binds to the local computer and defaults to port 4173. A plain static
server still works for the cached introduction and visual studies.

To connect the landing page to the agent, create a JSON file **outside this
repository** with only an `agentId` field, then pass its absolute path:

```sh
python3 scripts/serve.py --agent-config /absolute/path/outside-repository/seni-agent.json
```

Alternatively, set `SENI_AGENT_ID` in the server process environment. The
environment takes precedence over the external file. Neither approach needs an
ElevenLabs API key. Never put the agent ID in this repository, including ignored
files, source code or documentation. The preview server reads the value at
startup and serves only that public identifier through `/api/agent-config` with
`Cache-Control: no-store`; restart the server after changing configuration.
The external JSON file itself is not served.

In the ElevenLabs agent settings, use **PCM 44,100 Hz** output and enable the
`audio` event with character alignment, `agent_response`, `interruption`, and
**`agent_response_complete`** in the client events. The completion event is
required to distinguish a finished reply from a temporary audio gap. Agent
authentication, if enabled, needs a future signed-session endpoint; do not add
an API key to this static application.

The main page is the voice landing experience, with **Meet Seni**, sound and
return controls. Live sessions add microphone mute and **End conversation**;
**Talk to Seni** starts a fresh session afterward. **Surprise me** ends any active
conversation and cycles **Seni → Jellyfish → Atom → Lotus → Seni**. Without an
agent configured, the cached introduction retains its replay control.
The jellyfish gathers into the centre
before the atom's rings unfold. The atom spirals inward into a closed lotus bud,
pauses, then blooms into layered petals. **Back to Seni** returns silently to
her face, including during a transition. Microphone access is requested only
when the user starts a configured live conversation; ordinary page loading and
visual studies do not start the microphone or contact ElevenLabs.

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

- `lotus.html`: standalone 48,000-particle Celestial Lotus study of the flower used in Surprise Me. A closed bud opens into layered, breathing petals with drifting edge filaments, an upward centre stream, occasional fast petal-edge traces and pollen; **Bloom again** repeats the opening. Reduced motion shows the open flower at rest. Accepts `?n=…`.
- `jelly.html`: 48,000-particle jellyfish study. The face feeds a single upper-right stream while the bell forms; the bell then leads along a curved path, with trailing ribbons following its route and gentle lengthwise contractions. Explicit Face / Jellyfish controls only, with a direct reduced-motion alternative.
- `orbit.html`: standalone orbital form for future text chat, with 48,000 particles by default.
- `morph.html`: explicit **Face / Orbit** visual study. A fixed particle mapping preserves all 48,000 identities through an immediate gathering motion that fully settles in two seconds, including interrupted returns. Reduced motion uses a short direct interpolation. This page has no voice connection or idle timer. All form studies accept `?n=…`.

- `spike/agent.html`: live-agent test bench. It connects to the ElevenLabs agent (paste the agent ID each run; it is never stored) and logs timing, text and output volume. Downloaded logs contain your own speech, so never commit them.

- `movement.html`: local movement comparison with a **Fluid shape** switch. Neutral shows a flowing silhouette; **Simulate your turn** demonstrates attention gathering for nine seconds and then relaxing. Cached speech and expression controls reuse the actual face driver, with no live service or microphone. Switch off Fluid shape to compare the earlier conversation-motion baseline. **Travelling speech** varies the direction and outer-particle delay of ordinary speech accents; switch it off and replay cached speech to compare with the approved vertical accents.

## Code organisation and checks

`js/landing.js` wires the landing page to the existing renderer and voice player;
`js/landing-flow.js` owns its cancellable greeting and form-selection lifecycle.
`js/agent-config.js` loads runtime configuration, `js/agent-session.js` owns the
live connection, and `js/agent-replies.js` routes incoming PCM, alignment and
reply boundaries into the existing voice player. The locally vendored SDK and
`js/eleven-setup.js` handle microphone setup and cancellation.
`js/landing-forms.js` adapts the existing form generators and morphs to the
landing's two particle counts. `js/stage.js` opts into that path only for the
landing page; the standalone studies keep their own rendering paths.
`js/main.js` wires the separate study page, face and renderer together. The existing cached demo
and speech-lab interactions live in `js/study-flow.js`; `js/live.js` is loaded only
with `?live=1`. Pure pose and expression controllers live in
`js/face-expressions.js`, with their existing exports also available from
`js/face.js`.

During conversation, **Curious** uses a focused expression with knitted, lowered
brows and a centred gaze; **Thoughtful** retains its separate thinking pose.
Ordinary speech uses restrained, voice-beat-driven stretch/rebound accents, with
at least 2.6 seconds between starts. Laugh/chuckle gestures keep their separate
compression and timing. Ordinary accents now carry a directional sweep through
the outer particles, rotating among four directions without adding random draws
or extra triggers. Their timing follows playback, holds through audio gaps and
releases continuously on interruption or a laugh handover. Eyes, nose and lips
retain their original protected deformation. Reduced motion keeps the earlier
accent field and suppresses the new directional sweep.

Neutral and listening moments now have a display-only silhouette flow: the outer
form changes width, length and asymmetry while the eyes, nose and lips stay
protected. Sustained listening attention gathers the form and calms its flow.
The layer fades during whole replies (including buffering gaps), manual pose
previews and expression release. Reduced motion suppresses it completely.

Live listening reads only the pinned SDK's existing input-volume analyser. After
sustained input, Seni gently centres her attention and makes one small nod;
quiet rearms the response with a six-second cooldown. Muting, ending the session,
and active or draining replies gate this input. Levels are not stored or logged.
Reduced motion suppresses the new acknowledgement nod. The particle simulation,
form mappings and shared voice-player interface are unchanged by this layer.

Run the local regression suite with
`node --test scripts/*.test.mjs scripts/mouth-study/*.test.mjs`. No package install
or build step is required. Tests use synthetic voice/provider boundaries and do
not contact ElevenLabs or request a microphone. Run the local server checks
with `PYTHONDONTWRITEBYTECODE=1 python3 scripts/serve.test.py`; they use synthetic
configuration and in-memory handler calls, without opening a server.

The landing connection finishes replies using the provider’s
[`agent_response_complete` event](https://elevenlabs.io/docs/eleven-agents/customization/events/client-events#agent_response_complete),
then lets already queued local audio drain. It never treats the SDK’s
“listening” mode as a reply boundary, since an empty output queue can also mean
a transport gap. The legacy `?live=1` study remains isolated from this product
flow and retains its separate developer controls and capture tooling.

Some legacy code in `js/shapes.js` deliberately consumes random draws to preserve
the approved particle layouts. Keep that order intact during future cleanup.

## Docs

- `docs/CHARACTER.md`: Syra's public character sheet and live system prompt.
- `ASSETS.md`: where each asset came from.
- `AGENTS.md`: rules for coding agents working in this repo.

## Voice

ElevenLabs. Pre-generated lines are made with `scripts/make_voice.py` (dry run by default; generating costs credits and is run only by the owner). The live voice comes from an ElevenLabs agent configured in the ElevenLabs dashboard.
