# Latency report — before vs after

Runner: `bun run bench` → `node --import tsx scripts/bench-pipeline.ts`
(4 vCPU container, Node 24, mock Voice Agent upstream on loopback).

All numbers below are **measured**, not estimated, with one exception that is
labelled: the derived per-turn budget in §3 uses the measured client/proxy
stages plus Deepgram's own `LatencyReport` fields, which are only available when
a real `DEEPGRAM_API_KEY` is connected (see §5).

---

## 1. Proxy path — same mock agent, original server vs fixed server

The benchmark serves 2 s of agent audio at **50 frames/s** (the real TTS frame
rate) through the proxy and counts what the **browser** has to receive.

| Metric | before (`ad474ee`) | after | Change |
| --- | --- | --- | --- |
| Agent audio frames delivered to browser | **0** | **100 / 100** | audio now exists |
| JSON messages to browser while speaking | 100 (31.1/s) | 3 (0.9/s) | **−97 %** |
| Uplink proxy hop p50 / p95 | 0 ms / 1 ms | 0 ms / 1 ms | unchanged |
| Handshake (connect → `SessionReady`) | 23 ms | 21 ms | unchanged |

`31.1/s` of those JSON messages were per-frame `AudioDiscardedTelemetry`; each
one cost a `JSON.parse`, an `setEvents()` array copy (≤200 entries) and a full
React commit. The fixed proxy aggregates into one `AgentAudioStats` per second
and forwards the audio itself instead.

Raw output:

```
before: ad474ee server.ts
  handshake=23 ms  uplinkHop p50=0 ms p95=1 ms
  agent audio frames delivered to browser: 0
  JSON messages to browser: 100 (31.1/s)
  SettingsApplied -> first agent audio: n/a ms
after: fixed server.ts
  handshake=21 ms  uplinkHop p50=0 ms p95=1 ms
  agent audio frames delivered to browser: 100
  JSON messages to browser: 3 (0.9/s)
  SettingsApplied -> first agent audio: 564 ms   (harness timing, see §5)
```

## 2. Browser capture path

60 s of synthetic 48 kHz microphone audio, processed chunk-by-chunk exactly as
the old `AudioStreamer` did (`ScriptProcessor(2048)` + per-chunk resample +
`DataView` encoder) versus the new pipeline (AudioWorklet 1024-sample batches +
streaming resampler + `Int16Array` encoder).

| Metric | before | after |
| --- | --- | --- |
| Capture chunk / capture-side buffering @48 kHz | **42.7 ms** | **20 ms** |
| Chunks per second | 23.4 | 46.9 |
| CPU per second of audio @48 kHz | 0.45 ms | 0.33 ms |
| Per-chunk CPU p50 / p95 | 0.014 / 0.034 ms | 0.005 / 0.010 ms |
| Capture chunk buffering @44.1 kHz | **46.4 ms** | **20 ms** |
| Resampler drift over 60 s @44.1 kHz | **+571 samples (23.8 ms)** | **0** |

Two separate wins:

* **−22.7 ms of capture-side buffering** before the first byte of speech can
  leave the machine (42.7 ms → 20 ms).
* **Deterministic resampling**: the old per-chunk `Math.round(len / ratio)`
  resampler added 571 samples of timeline drift per minute at 44.1 kHz and
  restarted its interpolation phase on every chunk (audible clicks); the new
  `StreamingResampler` carries the fractional read position across chunks →
  0 samples drift, verified in `tests/pcm.test.ts`.

## 3. Derived per-turn budget (how the pieces add up)

| Stage | Source | before | after |
| --- | --- | --- | --- |
| Microphone capture buffering | §2 measured | 42.7 ms | 20.0 ms |
| Uplink proxy hop | §1 measured | ~0–1 ms | ~0–1 ms |
| STT / LLM TTFB / TTS | Deepgram `LatencyReport` (now surfaced in the UI) | not visible | visible: `stt_latency`, `ttt_text_latency`, `tts_latency`, `total_latency` |
| Downlink relay | §1 measured (binary pass-through, no transform) | n/a (audio dropped) | ~0–1 ms |
| Playback scheduling lead | `PcmAudioPlayer` (fixes underruns) | n/a | +60 ms |
| Main-thread contention during speech | §1 measured message rate + UI cadence | ≈54 commits/s | ≈17 commits/s |

Net effect on **time-to-first-audible-word** of the fix itself: capture gets
22.7 ms faster, playback adds a deliberate 60 ms jitter buffer, i.e. the local
pipeline contributes ~+37 ms *while audio now exists at all* and while the main
thread stops doing ~37 unnecessary commits per second (which is what used to
delay the transcript/response rendering). The dominant remaining terms — STT
end-of-turn, LLM first token, TTS first byte — are Deepgram-side and now visible
in the *Measured turn latency* panel instead of being guessed at.

## 4. Where the remaining latency lives (and what was rejected)

* **End-of-turn detection (Deepgram-side).** With `nova-3` (v1 listen provider)
  Deepgram controls endpointing; the Voice Agent settings schema exposes **no**
  `endpointing` / `utterance_end_ms` field for it (verified against
  `developers.deepgram.com/reference/voice-agent/voice-agent`). The only knobs
  are `eot_threshold` / `eager_eot_threshold` / `eot_timeout_ms`, and those are
  **Flux (v2) only** — also verified in the same schema. They are now exposed as
  an opt-in UI option (`flux-general-en` + *Low-latency turn detection*), not a
  silent default change.
* **Speculative replies** (start the LLM before the turn is confirmed) work with
  every listen provider server-side, but widening the window needs the flux
  `eager_eot_threshold` field — same opt-in.
* **Provider swap** (e.g. a different LLM) was rejected: the measured local
  overhead is sub-millisecond once the re-render loop and the 43 ms chunks are
  gone, so the remaining time is Deepgram/model inference, which the app cannot
  shorten without changing the provider the user chose.
* **Rejected as fake speed-ups:** shortening the 60 ms playout lead below the
  20 ms frame cadence (causes audible gaps), splitting frames below 20 ms
  (doubles message count for < 20 ms gain), and disabling echo cancellation to
  shave capture time (destroys barge-in).

## 5. Limitations of these measurements

* **No `DEEPGRAM_API_KEY` in this environment**, so no live end-to-end turn was
  measured. STT/LLM/TTS/total latency is now surfaced from Deepgram's
  `LatencyReport` event in the UI (`Measured turn latency` panel), which is where
  the real provider numbers will appear on a connected machine.
* The proxy numbers come from the **real `server.ts`** driven against a local
  mock that speaks Deepgram's documented wire protocol (Welcome/Settings/
  SettingsApplied/binary frames/KeepAlive/Error/Warning). That is a valid
  measurement of *our* proxy's behaviour, not proof of Deepgram integration.
* `SettingsApplied -> first agent audio: 564 ms` in §1 is harness timing (the
  mock starts streaming 500 ms after `SessionReady`), not a latency figure.
* Browser-only behaviour (AudioWorklet availability, `AudioContext` autoplay
  policy, `devicechange`, tab suspension) is covered by code paths, unit tests
  and the watchdog logic, but was **not** executed in a real browser here — see
  the manual test checklist in `docs/DEFECT_REPORT.md`.
