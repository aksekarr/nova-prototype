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

Main-page reply capture: open `http://127.0.0.1:4173/?capture=1`. With a live
agent configured, **Capture replies** starts enabled. **Download text** saves
Seni's replies as a readable text file; **Download captures** saves the existing
replay-compatible JSON with her reply text, output audio and timing. Only replies
that finish or are interrupted are exported; interrupted replies are marked and
their text may include words whose audio was cut off. Capture is selected at each
reply's start. Unchecking it leaves that reply intact and skips subsequent ones.
No user transcripts, microphone audio or provider identifiers are captured. Data
stays in memory across conversations on that page until reload; download before
closing or refreshing. Files go to the browser's download location and are never
uploaded automatically. Keep capture files outside the repository or in the
ignored `refs/live/` folder. The ordinary main URL retains its existing controls.

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

Avi approved the expressive mood pass and its timing/edge-flow follow-up on
10 Oct 2026. All are enabled by default in conversation and capture replay.
**Thoughtful** tilts elastically with an asymmetric gather and **Warmly**
broadens softly. The differentiation follow-up gives **Curious** open, lightly
asymmetric brows and an upright reach; **Confidently** a clearer chin lift,
open eyes and tall, slightly broader stance; **Concerned** raised inner brows,
a gentle forward lean and a softly gathered form. Live and sculpting poses agree. Competing facial
micro motion reduces during the peak; brow flashes/new ordinary accents yield.
Authored tilt is smoothed and speed-limited; incidental speech-roll limits and
random scheduling are unchanged. Speech articulation and particle flow continue.

Moods retain their 0.5-second arrival and 2-second peak, soften into a moving
attitude, then retire: Thoughtful at 48% of peak until its 8.1-second finish;
Warmly at 55% / 8.7 s; Curious at 56% / 7 s; Confidently at 70% / 7.8 s;
Concerned at 62% / 8.2 s.
The existing cheerful/happy and excited aliases receive the same staging
(50% / 7.8 s and 40% / 6.7 s). Early completion/interruption releases the
currently visible contribution, gaps hold, and later mood cues take over.
Laugh/chuckle/sigh geometry and event timing retain their approved beats.

`js/mood-edge-flow.js` adds a display-only response to the outer particles and
filaments, using the authoritative expression weights and playback clock:

- Thoughtful: the approved asymmetric inward curl.
- Warmly: the approved soft outward ripple.
- Curious: narrow, converging upward streams.
- Confidently: a steady, open lifting fan.
- Concerned: a gentle inward gather, with a quiet downward drift.
- Chuckle/Laughing: a small playful ripple or fuller buoyant ripple, scaled by
  their existing distinct reaction strengths.
- Sighs: a downward, outward wash accompanying the exhale.
- Cheerful/happy: a relaxed radial breath; excited: a brighter upward bloom.

Responses blend continuously, remain active through a mood's softer attitude,
hold their phase through audio gaps and inherit phase across replies. Protected
eyes/nose/lips, detached core particles, loose background stars, original
filament paths and colour/lifetime clocks stay intact. Reduced motion omits the
body/gaze and edge-flow contributions.

Mood arrivals now include a small preparatory counter-movement, driven by a
lag of the same authoritative cue weights. The existing facial spring leads
the head (11), outer form (7), then filaments (5.5); these are critically damped
spring frequencies. There is no second cue timeline, random stream or timer
that can independently restart an expression. Gaps freeze the added layers;
interruptions, retirement and replacement preserve their continuous tails.
Laugh/chuckle/sigh keep their existing dedicated anticipation and geometry.

`movement.html` shows the current performances directly. Choose an expression,
**Replay**, or **Watch all** to see all ten examples in order. **Stop** or any
individual choice cancels the sequence. Optional **With cached speech** uses one
existing `lab-slow` recording with the selected synthetic cue; the real audio
clock and articulation remain authoritative. Silent examples allow twelve
seconds for arrival, hold and follow-through. The page never opens a microphone
or generates audio. Desktop controls sit beside the face. The speech lab retains
body and edge intensity controls for replay inspection.

Conversation now uses **Conversation mix** for the eyes. **Current eyes** stays
as the original foundation between moments. **Soft and settled** appears briefly
in quiet neutral/listening periods; **Open and attentive** follows sustained
listening attention. Spaced speech-phrase starts alternate open engagement and
softening, returning to Current eyes between beats. This uses existing playback
and input-volume signals, without inferring an emotion from the person's speech.
The mix changes only displayed lids and brows. Mouth, gaze, blink, head/body
motion and particle buffers are unchanged; strong tags and manual poses take
priority. Audio gaps freeze the new layer, and reduced motion retains Current
eyes without the new automatic moments.

The eye comparison in `movement.html` keeps **Conversation mix**, **Current eyes**,
**Soft and settled** and **Open and attentive** available separately. Current eyes
is the exact original version; the two fixed alternatives retain their approved
foundations and optional coordinated form/hold/release moments. **Eye moments**
off holds a fixed alternative's foundation, or keeps Current eyes in Conversation
mix. Reduced motion keeps a fixed alternative's foundation without its moments.

During conversation, **Curious** uses a focused expression with knitted, lowered
brows and a centred gaze; **Thoughtful** retains its separate thinking pose.
**Confidently** now uses composed lids, level brows and a restrained smile instead
of delighted surprise. **Warmly** has gentler eyes and a softer smile than the
cheerful content pose. **Sighs** uses a lightly exasperated, relaxed expression
with a quick gather → widen → reform gesture; the outward release is stronger
than the initial gathering, and the edge particles trail it slightly. Rounded
arrival and release timing, with a softer edge rebound, keep it elastic. It plays
once per aligned occurrence, shares the existing gesture handover and suppresses
ordinary accents while active. Reduced motion keeps the expression and omits
the new sigh gesture. Existing laugh/chuckle geometry and timing are unchanged.
Ordinary speech uses restrained, voice-beat-driven stretch/rebound accents, with
at least 2.6 seconds between starts. Laugh/chuckle gestures keep their separate
compression and timing. Ordinary accents now carry a directional sweep through
the outer particles, rotating among four directions without adding random draws
or extra triggers. Travelling accents have a slightly longer rise and return,
with less rebound, to soften the motion. Their timing follows playback, holds through audio gaps and
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

Speech-mouth articulation uses the existing eight-channel vocabulary with bounded
English vowel rules and duration-aware transitions. Short lip closures preserve
their audio alignment instead of delaying following sounds. Mouth geometry and
opening strength are unchanged. See `docs/mouth-articulation-report.txt` for scope,
comparison evidence and approval.

Voice effects now offer a sine flange and a quiet, filtered ring-modulated layer.
Avi selected the narrow 10–12 ms sine sweep as the default on 2026-10-10.
`voice.html` retains the full Sine + digital sweep alongside fixed delays at
11.84 ms and 10.5 ms, plus the selected narrow sweep. All four retain 43% flange, 39% feedback and
4% ring modulation at 75 Hz. Earlier triangle/sine/balanced comparisons remain
available under Earlier comparisons, using the same existing cached speech.
Comparison gains match RMS with a common peak ceiling of 0.94; these gains apply only to the preview, not live playback.
The original preset reproduces the saved processor at `1b32f85` exactly.
No extra processing block delay is introduced. Mouth analysis and audio clocks
remain upstream and unchanged. The tuning panel also exposes waveform, ring
frequency/mix and all seven presets. No new recordings or dependencies are needed.
