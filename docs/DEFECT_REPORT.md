# Hey-there / Deepgram Voice Agent prototype — Defect Report

Audited commit: `ad474ee` (`feat: initialize Deepgram Voice Agent prototype`).
Every defect below was reproduced by tracing the shipped code paths end-to-end
(mic capture → `AudioStreamer` → browser WS → `server.ts` proxy → Deepgram Agent
WS → event relay → React state) and, where possible, by executing the code
(see `docs/LATENCY_REPORT.md` and `tests/`).

Legend: **P0** = audio broken / session dies, **P1** = latency, **P2** = robustness.

---

## D1 — P0 — Agent (TTS) audio is deleted server-side, so the agent is silent

**Observed:** The assistant never produces sound. The UI even advertises it:
`MicrophonePanel` renders "Browser Text-Only Mode Active … No audio playback
elements are instantiated", and `ArchitectureView` documents a "Binary TTS
Discard Rule".

**Cause:** `server.ts` (lines 164–183) intercepts every **binary** frame coming
back from `wss://agent.deepgram.com/v1/agent/converse`, increments
`discardedAudioFrames/Bytes` and `return`s before forwarding. There is no
playback path in the frontend at all (`App.tsx` `ws.onmessage` starts with
`if (typeof event.data !== 'string') return;`).

**Files:** `server.ts`, `src/App.tsx`, `src/components/MicrophonePanel.tsx`,
`src/components/ArchitectureView.tsx`, `src/types/deepgram.ts`.

**Fix:** Forward the PCM frames to the browser as binary WS frames and play them
through a scheduled Web Audio player (`src/utils/audioPlayer.ts`), with
barge-in flush on `UserStartedSpeaking`/`AgentAudioDone`, and truthful UI
labels.

---

## D2 — P0 — Muting (or any silence) kills the session: `CLIENT_MESSAGE_TIMEOUT`

**Observed:** Audio stops responding after the user mutes the mic or stays quiet
for a while; the session ends and the page must be reloaded.

**Cause:** When muted, `AudioStreamer.scriptNode.onaudioprocess` calls
`onVolume(0); return;` (audioStreamer.ts:74–78) and `setMute()` also disables the
MediaStreamTrack, so **nothing at all** is written to the socket. Per the
Voice Agent docs (`Agent Keep Alive`, `Errors & Warnings`), the server closes
sessions that go silent with `CLIENT_MESSAGE_TIMEOUT`. No `KeepAlive` is ever
sent, and there is no server-side keepalive either.

**Files:** `src/utils/audioStreamer.ts`, `server.ts`, `src/App.tsx`.

**Fix:** While muted the streamer emits *silence* PCM frames (continuous
timeline, no VAD discontinuity); additionally the server sends
`{"type":"KeepAlive"}` upstream when it has not forwarded audio for 8 s
(documented cadence), and the client sends `KeepAlive` if its socket is idle.

---

## D3 — P0 — `isStreaming` is a lie: state is set before audio actually runs

**Observed:** Mic panel says "Microphone Live Streaming" with a VU meter at 0 %
while no audio reaches the server; clicking Start again does nothing.

**Cause:** `App.tsx:257–269` sets `setStatus('READY'); setIsStreaming(true);`
*before* `await audioStreamerRef.current.startStreaming(...)`, and the catch only
sets an error message — `isStreaming` is never reset. `AudioStreamer.startStreaming`
also returns **silently** when `this.isStreaming` is already true, so a partial
failure leaves the app permanently "streaming" with a dead pipeline. There is no
watchdog that compares "frames should be flowing" with "frames are flowing".

**Files:** `src/App.tsx`, `src/utils/audioStreamer.ts`, `src/components/MicrophonePanel.tsx`.

**Fix:** Single source of truth (`AudioStreamer` reports real state via
`onStateChange`), plus a 3 s frame watchdog that restarts or reports failure.

---

## D4 — P0 — Duplicate microphone streams and orphaned `AudioContext`s

**Observed:** Repeated `Start` / "Grant Microphone Access" clicks leak tracks;
some browsers end up with two recording indicators.

**Cause:** `AudioStreamer.requestMicrophone()` calls `getUserMedia` every time and
**overwrites** `this.mediaStream` without stopping the previous tracks
(audioStreamer.ts:29). `handleRequestMicPermission` and `handleStartSession`
both call it (App.tsx:163 and 179). `startStreaming()` creates a new
`AudioContext` without closing a previous one, and `stopStreaming()` is called
from three different places (`onclose`, `Error`, `handleStopSession`) — it is
not idempotent-safe against concurrent restart, which is why audio occasionally
stays dead after a stop/start cycle.

**Files:** `src/utils/audioStreamer.ts`, `src/App.tsx`.

**Fix:** Idempotent `ensureMicrophone()` that reuses a live track and is
serialised through a single in-flight promise; `startStreaming` refuses (and
reports) instead of silently returning; `stopStreaming` tears down exactly once.

---

## D5 — P0 — No recovery from socket loss, tab suspension, or device loss

**Observed:** Losing Wi-Fi, backgrounding the tab, or unplugging a headset
permanently disables audio until a page reload.

**Cause:**
* `ws.onclose` in `App.tsx:330–340` only sets `DISCONNECTED`; there is no
  reconnect, no backoff, no re-`Settings`.
* `AudioStreamer` never calls `audioContext.resume()` again and never listens to
  `visibilitychange`; mobile/Safari `AudioContext`s move to `interrupted`/
  `suspended` on tab switch and then deliver no audio.
* No `track.onended` / `navigator.mediaDevices.ondevicechange` handler, so a
  disconnected microphone is undetected (the meter simply reads 0 %).

**Files:** `src/App.tsx`, `src/utils/audioStreamer.ts`, `server.ts`.

**Fix:** `src/utils/voiceAgentSession.ts` implements bounded exponential-backoff
reconnect (0.5→8 s, 5 attempts, jittered) that re-sends `ConfigureSettings` and
re-emits `SessionReady`; the audio path is a *sink function*, not a captured
`WebSocket`, so reconnecting resumes capture with no reload. Streamer handles
visibility/interrupted contexts, `track.onended`, `devicechange`, and re-acquires
the mic.

---

## D6 — P0 — Settings race: the proxy can send the default config before the client's

**Observed:** Model changes made in "Config Models" are silently ignored on the
first connection; the UI shows one model while the agent runs another.

**Cause:** `server.ts` creates the Deepgram socket immediately on browser
connect and sends `Settings` the moment `Welcome` arrives. The browser's
`ConfigureSettings` message (sent in `ws.onopen`) is handled independently
(server.ts:297–301). If `Welcome` wins the race (typical on warm connections),
`Settings` is built from the hard-coded defaults.

**Files:** `server.ts`, `src/App.tsx`.

**Fix:** The proxy buffers `Welcome` until it has the client's
`ConfigureSettings` (or a 1.2 s timeout), then sends exactly one `Settings`.
Settings construction moved to `src/shared/voiceAgentConfig.ts` so it is unit
tested against the documented schema.

---

## D7 — P1 — Every TTS frame generates a JSON message to the browser (~50 msg/s of pure noise)

**Observed:** The event log fills with `AudioDiscardedTelemetry` entries;
main-thread jank and sluggish transcript rendering while the agent speaks.

**Cause:** `server.ts:172–181` sends a JSON message **per binary frame**
discarded. Each one triggers `logEvent()` (`setEvents` — array copy of up to 200
items), `setTelemetry()`, and a full React re-render of `DiagnosticsPanel`.
Combined with `setVolumeLevel()` on every mic chunk, the app performs roughly
**70–100 React state commits per second** while audio is flowing.

**Files:** `server.ts`, `src/App.tsx`, `src/components/DiagnosticsPanel.tsx`.

**Fix:** Aggregated `AgentAudioStats` once per second; volume meter throttled to
~15 Hz via rAF; chunk counters batched into the same 1 s tick; the event log
keeps only protocol-meaningful events.

---

## D8 — P1 — 43 ms capture chunks + main-thread `ScriptProcessorNode`

**Observed:** Speech onset reaches the server late; audio glitches under load.

**Cause:** `createScriptProcessor(2048, 1, 1)` at 48 kHz = **42.7 ms per buffer**,
and the whole resample + int16 conversion runs on the main thread inside the
deprecated `ScriptProcessorNode` callback — the same thread that was doing ~100
React commits/s (D7). Dropped callbacks mean dropped audio.

**Files:** `src/utils/audioStreamer.ts`.

**Fix:** `AudioWorkletNode` (off main thread), worklet-side batching to 1024
samples, main-thread framing to **20 ms** (960 B) frames, `ScriptProcessor`
retained only as a fallback.

---

## D9 — P1 — Resampler drifts and clicks (naive per-chunk linear interpolation)

**Observed:** Subtle periodic clicks; transcript quality drops on 44.1 kHz
devices; long sessions accumulate timeline drift.

**Cause:** `resampleFloat32()` recomputes `Math.round(inputData.length / ratio)`
independently for each buffer and restarts interpolation at index 0 each time.
Fractional ratios (44.1 k→24 k = 1.8375) therefore both drop/duplicate samples
and clip the waveform at every chunk boundary.

**Files:** `src/utils/audioStreamer.ts` (`resampleFloat32`,
`convertFloatTo16BitPCM`).

**Fix:** `StreamingResampler` (`src/utils/pcm.ts`) keeps an absolute fractional
read position and the previous chunk's last sample, so output length is exact
across chunks (verified in `tests/pcm.test.ts`).

---

## D10 — P1 — No latency instrumentation, server doesn't surface `LatencyReport`

**Observed:** No way to tell where the time goes; the app waits an unknown time
before the first token.

**Cause:** `LatencyReport` (STT/LLM/TTS/total per turn) is emitted by Deepgram
but ignored by the UI; the client measures nothing beyond a session timer.

**Files:** `server.ts`, `src/App.tsx`, `src/components/TelemetryPanel.tsx`.

**Fix:** Forward and render `LatencyReport`; additionally time
`send → ConversationText`, `send → first PCM`, `first PCM → first audible
sample`, and proxy handshake stages server-side.

---

## D11 — P2 — Fatal errors are terminal for the app, warnings are hidden

**Cause:** `App.tsx` treats any `Error` as a dead end (correct per docs: every
`Error` is fatal) but never reconnects; `Warning` events (e.g.
`MAXIMUM_SESSION_LENGTH_APPROACHING`) are rendered as generic agent events.

**Fix:** Classify `Error` (fatal → structured message + auto-reconnect decision)
vs `Warning` (non-fatal → surfaced as warning, session continues).

---

## D12 — P2 — Missing setup documentation for the only required secret

**Cause:** `.env.example` documents `GEMINI_API_KEY`/`APP_URL` (left over from
the template) but **not** `DEEPGRAM_API_KEY`, which the app cannot run without;
there is no README.

**Fix:** Document `DEEPGRAM_API_KEY` (plus the optional `PORT`,
`DEEPGRAM_AGENT_URL` and `PROXY_IDLE_KEEPALIVE_MS` overrides) in `.env.example`
and add a `README.md` with setup, scripts and the audio pipeline overview.

---

## D13 — P0 — Aura TTS voices are sent to the Flux (v2) endpoint

**Observed:** Selecting `aura-asteria-en` / `aura-luna-en` / `aura-stella-en` in
*Config Models* produces no voice (or an `INVALID_SETTINGS` / `FAILED_TO_SPEAK`
style failure) even though Flux voices work.

**Cause:** `server.ts` always sent `agent.speak.provider.version = speakVersion ||'v2'`.
Per the TTS Models reference the `version` field *selects the TTS family*:
`v2` = Flux, `v1` = Aura (and `v1` is the default for supplied providers). An
Aura model string with `version: "v2"` resolves against the wrong endpoint.

**Files:** `server.ts` → `src/shared/voiceAgentConfig.ts` (`speakProviderVersion`).

**Fix:** The version is derived from the model family: `flux*` → `v2`,
`aura*` → `v1`, anything else keeps the configured value. Covered by
`tests/settings.test.ts`.

---

## D14 — P0 — Invalid LLM model ids offered in the UI (`claude-3-5-sonnet`, `llama-3.3-70b-instruct`)

**Observed:** Choosing either of those *Thinking Model* options makes the session die
instantly with a Deepgram error (audio goes dead).

**Cause:** The dropdown listed models that are **not** in the `open_ai` provider enum. The
AsyncAPI schema allows exactly `gpt-5, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4.1-mini,
 gpt-4.1-nano, gpt-4o, gpt-4o-mini`. Anything else produces a fatal `INVALID_SETTINGS`.

**Files:** `src/components/ConnectionPanel.tsx`, `src/shared/voiceAgentConfig.ts`,
`server.ts`.

**Fix:** The dropdown only offers valid `open_ai` models, and the proxy validates the
config **before** sending `Settings` (unknown model ⇒ corrected to `gpt-4o-mini` plus a
`Warning{SETTINGS_CORRECTED}` in the UI), so a stale/edited config can no longer kill a
session.

---

## D15 — P0 — `ConversationText` had no de-duplication and no turn association

**Observed:** After a reconnect (or any replayed transcript) the same assistant line appeared
twice; messages were not attributable to a conversation turn.

**Cause:** `App.tsx` appended every `ConversationText` to `messages` unconditionally with a
random id and no turn context. It also computed latency from a single mutable ref that was
overwritten on every `UserStartedSpeaking`.

**Files:** `src/App.tsx`, new `src/utils/conversation.ts`, `src/components/ConversationPanel.tsx`.

**Fix:** A pure `ConversationTracker` reduces events → messages: immediate display,
content+role de-duplication (with a bounded memory that survives reconnects), turn ids,
`conversational_behavior` tags, and the per-turn latency timeline.

---

## D16 — P1 — HTTP 202 was displayed as a backend failure (and waited forever)

**Observed:** With an edge/proxy that answers `GET /api/health` with `202 Accepted`
(asynchronous acceptance while the service warms up) the UI showed *Backend Offline* /
*Key Missing* and the Start button stayed disabled permanently.

**Cause:** `checkHealth()` treated any 2xx as ready (`res.ok`) and then called
`res.json()` unconditionally. A 202 with an empty body throws → `setHealth(null)`; a 202
with a job-id body has no `deepgramApiKeyConfigured` → *Key Missing*. There was no retry,
so the client waited forever and never recovered.

**Files:** `src/App.tsx`, new `src/utils/http.ts`, `Header`, `ConnectionPanel`.

**Fix:** `probeBackendHealth()` with an explicit contract (200 = ready, 202/204 = starting
with `job_id`/`Retry-After`, non-JSON 2xx = routing error, 4xx/5xx = unavailable, network
= error) plus bounded auto-retry (60 s) and a truthful *Backend starting (HTTP 202)* state.
See `docs/SETTINGS_VERIFICATION.md` §5 and the reproducible edge-proxy test.

---

## D17 — P1 — Plain HTTP requests to the WebSocket path returned the SPA (HTTP 200 HTML)

**Cause:** `express.static` + `app.get('*') → index.html` ran before any API guard, so
`GET /api/agent-proxy`, `GET /api/typo` and every unknown path answered `200 text/html`.
Any client that checks `res.ok` (or an operator curling the health/WS endpoint through an
edge) sees a "successful" response that is not the API — the same class of confusion as
the 202 report.

**Files:** `server.ts`.

**Fix:** explicit guards before the SPA: `app.all('/api/agent-proxy') → 426 Upgrade
Required` (+ `Upgrade: websocket`), `app.all('/api/*') → 404 JSON`, and
`Cache-Control: no-store` on `/api/health`. Covered by `tests/protocol.test.ts`.

---

## D18 — P0 — `KeepAlive` could be forwarded upstream *before* `Settings`

**Cause:** `server.ts` forwarded a client `KeepAlive` whenever the upstream socket was
open, regardless of `isSettingsApplied`. Sending any message before `Settings` is a fatal
protocol violation (`NON_SETTINGS_MESSAGE_BEFORE_SETTINGS`) and kills the session.

**Files:** `server.ts`.

**Fix:** `KeepAlive` (like audio and `InjectUserMessage`) is only forwarded after
`SettingsApplied`; the idle keep-alive timer is armed on `SettingsApplied`. Asserted by
"nothing but Settings is sent upstream before SettingsApplied".

---

## D19 — P1 — No handling for the Flux turn lifecycle (eager EOT / resume)

**Cause:** `EagerEndOfTurn`, `TurnResumed`, `EndOfTurn` and `TurnInfo` fell through to the
generic event log, so a speculative turn had no visible state and could not be cancelled
in the UI.

**Files:** `src/App.tsx`, `src/utils/conversation.ts`, `ConversationPanel`.

**Fix:** tracked as a first-class turn state (`speculative`), surfaced as a dismissal-safe
badge, cancelled on `TurnResumed`/barge-in, finalised on `EndOfTurn`, and never turned
into a reply (no duplicate answers). Also documented that the Voice Agent server does not
emit these events today (they are Flux-STT level) — see verification §4.

---

## Preserved behaviour (must not regress)

1. Strict handshake: `Welcome` → `Settings` → `SettingsApplied` → audio unlocked.
2. `DEEPGRAM_API_KEY` stays server-side; `/api/health` contract unchanged.
3. Model configuration UI (`listenModel`, `thinkModel`, `speakModel`) still drives
   the actual `Settings` payload.
4. Text injection (`InjectUserMessage`), transcript feed, event diagnostics,
   telemetry, routing (`/prototype-1`, `/architecture`), standalone-tab banner.
5. 24 kHz linear16 PCM in/out; no new providers, no paid infrastructure.

---

## Verification

### Automated (executed here — `bun run test`, 80 tests, all passing)

| Area | Test file | Covers |
| --- | --- | --- |
| PCM / resampling / framing | `tests/pcm.test.ts` (9) | no-drift resampling at 48 k and 44.1 k, chunk-boundary continuity, clamping, 20 ms framing |
| Settings schema | `tests/settings.test.ts` (21) | documented payload shape, no client-only fields, `flags.history`, language (`language` vs `language_hints`), prompt, fallback arrays, speak speed ranges, flux-v2-only eot fields, TTS family version, invalid LLM model correction, config sanitising/clamping |
| ConversationText / turns | `tests/conversation.test.ts` (14) | assistant + user text accepted with no audio, text before/after/interleaved with audio, duplicate suppression (+ replays after reconnect), turn association, eager EOT → resume → end-of-turn, barge-in cancellation, latency timeline, malformed events |
| HTTP contract | `tests/http.test.ts` (11) | 200 vs 202 vs 204 vs 5xx vs HTML body vs network error, `Retry-After` parsing, job id extraction, upgrade probe naming a 202/404 |
| Protocol lifecycle | `tests/protocol.test.ts` (8) | exactly one Settings, no audio/KeepAlive/Inject before SettingsApplied, late SettingsApplied unlocks audio, malformed client JSON, unexpected server events relayed, clean reconnect, 426/404/no-store routes, reproducible HTTP 202 edge |
| Playback scheduling | `tests/playbackScheduler.test.ts` (4) | gapless back-to-back scheduling, lead time, late-frame clamping |
| Reconnect backoff | `tests/session.test.ts` (3) | exponential backoff, 8 s cap, jitter bounds |
| Proxy protocol + audio | `tests/proxy.test.ts` (10) | handshake, settings race, byte-exact audio relay both ways, telemetry aggregation, keep-alive while muted, Error/Warning handling, upstream socket release on browser disconnect, measured hop latency |

`bun run lint` (`tsc --noEmit`) and `bun run build` (`vite build`) both pass.

### Real browser end-to-end (executed here — `bun run test:e2e`, 32/32 checks)

Headless Chromium with Chrome's fake microphone device, the real proxy, and a
mock Voice Agent upstream. Every assertion below is on bytes crossing the wire or
on a live DOM value, not on a hard-coded expectation:

| Check | Result |
| --- | --- |
| App renders and the handshake reaches READY | PASS |
| Proxy sends `Settings` upstream | PASS (`nova-3`) |
| Real microphone audio is streamed upstream | PASS (21+ frames) |
| Uplink frames are 20 ms @ 24 kHz (960 B) | PASS |
| Agent PCM frames are played (not discarded) | PASS |
| Agent audio frame counter is non-zero | PASS (`30 frames / 28.1 KB`) |
| Muting sends silence frames (no idle timeout) | PASS (75 frames in 1.5 s) |
| Mute badge is truthful | PASS |
| Reconnect attempt is surfaced | PASS |
| Session re-establishes automatically | PASS |
| Microphone audio flows again after reconnect (no reload) | PASS |
| `Settings` re-sent on the new upstream socket | PASS (2 messages) |
| Session restarts after Stop/Start | PASS |
| Audio works after a session restart | PASS |
| Rapid `Start` clicks open exactly one session | PASS (1 upstream connection) |
| User `ConversationText` painted immediately | PASS |
| Assistant `ConversationText` painted immediately (before `AgentAudioDone`) | PASS |
| Text stays visible while audio streams | PASS |
| `ConversationText` arriving after audio is still displayed | PASS |
| Duplicate `ConversationText` rendered once | PASS |
| Event → painted text latency | PASS (p50 = 4 ms) |
| `EagerEndOfTurn` shows speculative state, `TurnResumed` clears it | PASS |
| `TurnResumed` fabricates no reply; `EndOfTurn` finalises exactly one | PASS |
| No uncaught page errors / unexpected console errors | PASS |

What this proves: capture → resample → frame → WS → proxy → upstream works in a
real browser, and upstream → proxy → browser → scheduled playback works, and both
survive mute, socket loss and session restart without a page reload.

What it cannot prove: Deepgram's own STT/LLM/TTS responses (the upstream is a
mock) and real-device behaviour (fake device cannot be unplugged, real acoustic
barge-in cannot be judged headlessly).

### Manual browser checklist (real mic + `DEEPGRAM_API_KEY`)



1. **Initial activation** — Start → permission prompt → mic badge *Granted*, panel shows
   `48,000 Hz in → 24,000 Hz` and a moving RMS meter; agent voice is audible on its first reply.
2. **Continuous operation** — talk for 60 s; VU meter responsive, transcripts keep arriving,
   `Uplink drops` stays 0, no `CLIENT_MESSAGE_TIMEOUT`.
3. **Consecutive interactions** — 10+ turns; `Agent Audio` frame counter keeps rising,
   `Playback queue` returns to ~0 ms between turns.
4. **Mute for 60 s** — status shows *Muted (sending silence)*, session stays `READY`,
   `Mic PCM Frames` keeps incrementing (silence frames).
5. **WebSocket reconnect** — kill the server / toggle Wi-Fi for 3 s: banner shows
   *Reconnecting (attempt n)*, then *Session restored*, `Reconnects` = 1, audio works without a reload.
6. **Tab visibility** — background the tab 30 s, return: capture context is `running`
   and the meter moves (contexts are resumed; a stalled graph auto-restarts).
7. **Device loss** — unplug the headset mid-session: a specific error appears, the app
   re-acquires the device (≤3 bounded attempts) or tells you to plug it back in.
8. **Session restart** — Stop then Start: no second mic indicator, no leftover socket
   (`browser disconnect releases the upstream socket` behaviour), audio resumes.
9. **Rapid interactions** — double-click Start repeatedly: only one session is created
   (guard), only one `getUserMedia` stream exists.
10. **Long session / leak check** — 20 min of talking: `agentAudioFrames`/`sentAudioChunks`
    grow linearly, `framesDropped`/`underruns` stay near 0, browser memory stable
    (playback `AudioBufferSourceNode`s are released in `onended`), Chrome shows a single mic indicator.

### Known functional limits

* If the browser refuses a 24 kHz `AudioContext` (some Safari versions), playback
  resamples to the device rate via the streaming resampler (extra CPU, no gaps).
* `AudioWorklet` requires a secure context; otherwise the `ScriptProcessor`
  fallback is used (still 20 ms framing, but on the main thread).
* A Deepgram `Error` always ends the session (per docs); the client reconnects up to
  5 times, and gives up after 2 consecutive server-reported `Error`s with the exact
  code shown in the UI.
