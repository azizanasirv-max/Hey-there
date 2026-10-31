# Deepgram Voice Agent Prototype (Hey-there)

A standalone, full-duplex voice agent in the browser: microphone → Node/Express
WebSocket proxy → [Deepgram Voice Agent API](https://developers.deepgram.com/docs/voice-agent)
→ streaming transcript + spoken reply.

```
Browser  ── mic (24 kHz linear16 PCM, 20 ms frames) ──┐
         ◀─ agent voice (24 kHz linear16 PCM) ────────┤
                                                      ▼
                                        ws://<host>/api/agent-proxy
                                        ws://…/api/health
                                                      │
                                                      ▼
                          wss://agent.deepgram.com/v1/agent/converse
                          (Settings → SettingsApplied → audio in both directions)
```

## Quick start

```bash
bun install            # or: npm install
cp .env.example .env   # then set DEEPGRAM_API_KEY
bun run dev            # http://localhost:3000/prototype-1
```

Without `DEEPGRAM_API_KEY` the UI still loads, `/api/health` reports
`deepgramApiKeyConfigured: false` and the Start button stays disabled.

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` / `bun run start` | Express + Vite dev server with the WS proxy |
| `bun run build` | Production client build into `dist/` |
| `bun run lint` | `tsc --noEmit` |
| `bun run test` | Node test runner: unit + proxy integration tests (`node --import tsx --test`) |
| `bun run test:e2e` | Headless-Chromium end-to-end verification: audio + immediate ConversationText (fake mic, real proxy) |
| `bun run test:live` | Optional live Deepgram run (10 turns, real key required; prints SKIPPED without one) |
| `bun run bench` | Measured before/after benchmark (`scripts/bench-pipeline.ts`) |

## Audio pipeline

* **Capture** — `getUserMedia` (single stream, re-used), `AudioWorkletNode`
  (`ScriptProcessorNode` fallback) → streaming resampler → 20 ms frames → WS.
* **Uplink silence** — while muted the streamer sends *digital silence* frames so
  the session is never starved into `CLIENT_MESSAGE_TIMEOUT`; the proxy also
  relays `KeepAlive` upstream after 8 s without audio.
* **Downlink** — the proxy forwards the agent's binary PCM frames untouched;
  the browser schedules them on a 24 kHz `AudioContext` (60 ms lead, gapless),
  and `UserStartedSpeaking` flushes the queue (barge-in).
* **Recovery** — suspended/interrupted `AudioContext`s are resumed on tab
  visibility; a stalled capture graph is restarted; a lost device triggers a
  bounded microphone re-acquire; a dropped socket reconnects with exponential
  backoff (0.5→8 s, 5 attempts) and resumes audio without a page reload.

* **Transcript** — `ConversationText` is rendered the moment it arrives (measured p50 ≈ 4 ms
  event → painted text); it never waits for audio, `AgentAudioDone`, or playback. Duplicates
  are suppressed and every message is tagged with its conversation turn.
* **HTTP status contract** — `GET /api/health` distinguishes `200` (ready) from `202/204`
  (accepted/starting: auto-retry, never "offline") and the WebSocket path answers `426
  Upgrade Required` over plain HTTP instead of the SPA's HTML/D. A non-101 handshake is
  diagnosed with a follow-up HTTP probe.

Details of every fixed defect: [`docs/DEFECT_REPORT.md`](docs/DEFECT_REPORT.md).
Deepgram settings/protocol verification (field by field): [`docs/SETTINGS_VERIFICATION.md`](docs/SETTINGS_VERIFICATION.md).
Measured latency before/after: [`docs/LATENCY_REPORT.md`](docs/LATENCY_REPORT.md).

## Configuration

Environment variables live in `.env` (see `.env.example`): `DEEPGRAM_API_KEY`
(required), `PORT`, and the test-only `DEEPGRAM_AGENT_URL` /
`PROXY_IDLE_KEEPALIVE_MS` overrides.

Model selection (listen / think / speak) is done in the UI under **Config
Models** and is applied to the Deepgram `Settings` message by the proxy — the
browser never holds the API key.

### Lower-latency turn detection (optional)

`eot_threshold` / `eager_eot_threshold` / `eot_timeout_ms` are only accepted by
Flux (v2) listen models. Select **`flux-general-en`** in *Config Models* and tick
**Low-latency turn detection** to let the agent start thinking before the user's
turn is fully confirmed (speculative replies). The default stays `nova-3` — no
provider or model defaults were changed by the reliability/latency work.

## Testing

```bash
bun run test     # 80 tests: unit (pcm / settings / playback / backoff / conversation / http) + proxy + protocol integration
bun run test:e2e # 32 browser checks with a fake microphone (needs Chromium)
bun run bench    # runs the original server (git commit ad474ee) side-by-side with the fix
```

The proxy integration tests boot the **real** `server.ts` as a child process and
point it at a local mock that speaks Deepgram's documented wire protocol. They
verify the handshake, the settings race, binary audio relay in both directions,
telemetry aggregation, keep-alive, error/warning handling and socket cleanup.

They do **not** prove Deepgram itself works — that requires a real
`DEEPGRAM_API_KEY` and a browser with a microphone. See
[`docs/LATENCY_REPORT.md`](docs/LATENCY_REPORT.md#limitations) for what could not
be executed in this environment.
