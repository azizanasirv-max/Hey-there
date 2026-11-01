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
| `bun run dev` / `npm run dev` | Express + Vite dev server with the WS proxy (no build needed) |
| `bun run build` | Production build: `vite build` → `dist/`, then `esbuild` → `server.js` |
| `bun run start` | Production server (`node server.js`, serves `dist/`; needs `NODE_ENV=production`) |
| `bun run start:dev` | Same server from TypeScript sources via `tsx` (no build) |
| `bun run lint` | `tsc --noEmit` |
| `bun run test` | Node test runner: unit + proxy/protocol integration + production tests |
| `bun run test:unit` | Pure unit tests only (`pcm`, settings, playback, backoff, conversation, http) |
| `bun run test:prod` | Builds, then boots the real `server.js` bundle: health, assets, 404/426, WS 101, wss behind TLS |
| `bun run test:e2e` | Headless-Chromium end-to-end verification: audio + immediate ConversationText (fake mic, real proxy) |
| `bun run test:e2e:prod` | Same in the built app served over **HTTPS + WSS** behind a local TLS terminator |
| `bun run test:all` | lint → unit/integration → production → both browser suites |
| `bun run verify:live -- https://…` | External verification of a deployed URL (health, assets, guards, WS 101) |
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
(required), `NODE_ENV`, `PORT`, `HOST`, and the test-only `DEEPGRAM_AGENT_URL` /
`PROXY_IDLE_KEEPALIVE_MS` overrides.

Model selection (listen / think / speak) is done in the UI under **Config
Models** and is applied to the Deepgram `Settings` message by the proxy — the
browser never holds the API key.

## Deployment (Render)

The repo ships a `render.yaml` blueprint: one **Node web service** that serves
the built client and proxies the WebSocket.

```bash
npm run build                      # dist/ + server.js
NODE_ENV=production npm start      # http://localhost:3000/prototype-1
npm run verify:live -- https://<service>.onrender.com
```

Set `DEEPGRAM_API_KEY` (secret), `NODE_ENV=production` and `NODE_VERSION=22.14.0`
in the Render dashboard; `PORT` is injected by the platform and the server binds
`0.0.0.0`. Full runbook, required variables, expected log lines and live-URL
verification: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
UI audit and accessibility fixes: [`docs/UI_REVIEW.md`](docs/UI_REVIEW.md).

### Lower-latency turn detection (optional)

`eot_threshold` / `eager_eot_threshold` / `eot_timeout_ms` are only accepted by
Flux (v2) listen models. Select **`flux-general-en`** in *Config Models* and tick
**Low-latency turn detection** to let the agent start thinking before the user's
turn is fully confirmed (speculative replies). The default stays `nova-3` — no
provider or model defaults were changed by the reliability/latency work.

## Testing

```bash
npm run lint       # tsc --noEmit
npm run test       # 87 tests: unit + proxy/protocol integration + production bundle
npm run test:prod  # builds, then boots server.js (health, assets, 404/426, WS 101, wss)
npm run test:e2e   # 32 browser checks with a fake microphone (needs Chromium)
npm run test:e2e:prod # 21 browser checks against the built app over HTTPS + WSS
npm run test:all   # everything above, in order
npm run bench      # runs the original server (git commit ad474ee) side-by-side with the fix
```

The proxy integration tests boot the **real** `server.ts` as a child process and
point it at a local mock that speaks Deepgram's documented wire protocol. They
verify the handshake, the settings race, binary audio relay in both directions,
telemetry aggregation, keep-alive, error/warning handling and socket cleanup.
`tests/production.test.ts` repeats the critical subset against the **built
bundle** (`node server.js`) and additionally drives `wss://` through a local
TLS-terminating proxy, which is the topology Render uses.

None of this proves Deepgram itself works — that requires a real
`DEEPGRAM_API_KEY` and a browser with a microphone (`npm run test:live`). See
[`docs/LATENCY_REPORT.md`](docs/LATENCY_REPORT.md#limitations) for what could not
be executed in this environment.
