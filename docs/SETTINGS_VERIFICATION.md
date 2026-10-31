# Deepgram Voice Agent — configuration & protocol verification

Verified on 2026-10-31 against the current official documentation (fetched, not
recalled):

- `developers.deepgram.com/reference/voice-agent/voice-agent` (AsyncAPI schema — field-by-field)
- `docs/configure-voice-agent` (settings overview)
- `docs/voice-agent-tts-models` (Flux v2 vs Aura v1, `provider.version` semantics)
- `docs/voice-agent-conversation-text` (event schema)
- `docs/agent-keep-alive`, `docs/voice-agent-errors-warnings`, `docs/voice-agent-outputs`
- `docs/voice-agent-speculative-replies`, `docs/flux/voice-agent-eager-eot`

Everything below was checked against the **actual transmitted payload**
(`src/shared/voiceAgentConfig.ts` → `buildValidatedSettings`, unit-tested in
`tests/settings.test.ts`), not against "it builds".

---

## 1. The Settings payload we actually send

Default session (`nova-3` + `gpt-4o-mini` + `flux-kit-en`), captured from
`buildValidatedSettings({...})`:

```json
{
  "type": "Settings",
  "flags": { "history": true },
  "audio": {
    "input":  { "encoding": "linear16", "sample_rate": 24000 },
    "output": { "encoding": "linear16", "sample_rate": 24000, "container": "none" }
  },
  "agent": {
    "listen": { "provider": { "type": "deepgram", "model": "nova-3" } },
    "think":  { "provider": { "type": "open_ai",  "model": "gpt-4o-mini" } },
    "speak":  { "provider": { "type": "deepgram", "model": "flux-kit-en", "version": "v2" } }
  }
}
```

With the low-latency Flux option enabled:

```json
"listen": {
  "provider": {
    "type": "deepgram",
    "model": "flux-general-en",
    "version": "v2",
    "eot_threshold": 0.7,
    "eager_eot_threshold": 0.4,
    "eot_timeout_ms": 2000
  }
}
```

### Field-by-field verdict

| Field | We send | Documentation requirement | Verdict |
| --- | --- | --- | --- |
| `type` | `"Settings"` | must be `Settings` (never `SettingsConfiguration`) | OK |
| top-level `flags.history` | `true` (configurable) | boolean, default `true`; controls **`History` events only** | OK |
| `audio.input.encoding` | `linear16` | enum includes `linear16` | OK |
| `audio.input.sample_rate` | `24000` | integer, default `16000`; docs examples use 24000 | OK |
| `audio.output.encoding` | `linear16` | enum includes `linear16` | OK |
| `audio.output.sample_rate` | `24000` | integer | OK |
| `audio.output.container` | `none` | default `none`; a container would break streaming PCM playback | OK |
| `agent.listen.provider.type` | `deepgram` | enum `deepgram` | OK |
| `agent.listen.provider.model` | `nova-3` / `nova-2` / `nova-2-general` / `flux-general-en` / `flux-general-multi` | free-form model string; `version` selects the STT API | OK |
| `agent.listen.provider.version` | omitted for nova (⇒ v1), `"v2"` for flux | `v1` only for nova-class models, `v2` required for Flux | OK (unit-tested both ways) |
| `agent.listen.provider.eot_threshold` | only for flux (`0.7`, range 0.5–1.0) | v2-only field | OK |
| `agent.listen.provider.eager_eot_threshold` | only for flux (`0.4`, range 0.3–0.9) | v2-only field; enables eager EOT | OK |
| `agent.listen.provider.eot_timeout_ms` | only for flux (`2000`, default 5000) | v2-only field | OK |
| `agent.listen.provider.language` | optional, nova only | v1 field (default `en-US`) | OK (only when set) |
| `agent.listen.provider.language_hints` | optional, `flux-general-multi` only | "only supported when model is flux-general-multi" | OK + auto-dropped elsewhere (warning) |
| `agent.think.provider.type` | `open_ai` | enum includes `open_ai` | OK |
| `agent.think.provider.model` | one of `gpt-4o-mini`, `gpt-4o`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-5-mini` | enum: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini` | **was violated**, now fixed + validated (D14) |
| `agent.think.prompt` | optional, omitted by default | string | OK |
| `agent.think.context_length` | never sent | only valid with a custom think `endpoint` | OK (correctly omitted) |
| `agent.think` / `agent.speak` as array | optional fallback chain, off by default | schema allows `ThinkSettingsV1[]` / `SpeakSettingsV1[]` | OK + unit-tested |
| `agent.speak.provider.type` | `deepgram` | enum `deepgram` | OK |
| `agent.speak.provider.model` | `flux-kit-en`, `aura-*` | `flux-{voice}-{lang}` for v2, `aura-*` for v1 | OK |
| `agent.speak.provider.version` | `v2` for `flux-*`, `v1` for `aura-*` | "`v2` (required) / `v1` (default)" — the field selects the TTS family | **was violated** (`v2` sent for Aura), fixed in D13 |
| `agent.speak.provider.speed` | optional, clamped (flux 0.5–1.5, aura 0.7–1.5) | documented ranges | OK |
| `agent.speak.provider.language` | not sent | Deepgram speak provider has **no** `language` field (Flux encodes it in the voice name) | OK |
| `agent.greeting` | optional, omitted by default | optional string | OK |
| `agent.context` | not sent | optional | OK |
| `mip_opt_out`, `tags`, `experimental` | not sent | optional, defaults apply | OK |
| client-only `ConfigureSettings` | never forwarded | not part of the schema (would be `UNPARSABLE_CLIENT_MESSAGE`) | OK (asserted in tests) |

### Flux v1 / v2 summary (the part that was wrong before)

| Voice selected | Family | `version` sent | Endpoint chosen by Deepgram |
| --- | --- | --- | --- |
| `flux-kit-en` (default) | Flux TTS | `v2` | Flux v2 TTS |
| `aura-asteria-en`, `aura-luna-en`, `aura-stella-en` | Aura TTS | `v1` | Aura v1 TTS |
| `nova-3` (default listen) | STT v1 | *(omitted ⇒ v1)* | v1 listen |
| `flux-general-en` | STT v2 | `v2` | Flux listen + eager EOT |

---

## 2. Protocol / session lifecycle

Required sequence — **WebSocket Connected → Welcome → Settings → SettingsApplied → Audio**:

1. Browser opens `ws://<host>/api/agent-proxy` (the only upgrade route; anything else is destroyed).
2. Proxy opens `wss://agent.deepgram.com/v1/agent/converse` with `Authorization: Token …`.
3. `Welcome` arrives; the proxy **buffers** it until the browser's `ConfigureSettings`
   has been received (or 1.2 s elapses) — this is the settings-race fix (D6).
4. Exactly one `Settings` is sent (`SETTINGS_ALREADY_APPLIED` is impossible: guarded by
   `settingsMessageSent`; duplicate `ConfigureSettings` messages are ignored).
5. `SettingsApplied` → proxy emits `SessionReady` → the browser starts sending audio.
6. Only then are binary frames, `KeepAlive` and `InjectUserMessage` forwarded upstream.

Enforced and tested (`tests/protocol.test.ts`, `tests/proxy.test.ts`):

| Rule | Enforcement |
| --- | --- |
| Exactly one `Settings` per socket | `settingsMessageSent` guard + test (3 config messages ⇒ 1 Settings) |
| No audio before `SettingsApplied` | server drops + counts; test asserts 0 frames upstream |
| No `KeepAlive` before `Settings` | server guard (updated — previously forwarded, D18) |
| No `InjectUserMessage` before `SettingsApplied` | server guard + `SESSION_NOT_READY` warning |
| Settings actually applied | browser only streams after `SessionReady`/`SettingsApplied` |
| Malformed client JSON | dropped, never forwarded, `Warning{MALFORMED_CLIENT_MESSAGE}` |
| Unexpected server events | relayed untouched (`History`, `LatencyReport`, unknown types) |
| Reconnect | full re-initialisation on a new socket, exactly one new Settings, playback flushed, transcript de-duped, no stale audio |
| Client `KeepAlive` cadence | only while `ready`, 8 s after the last uplink byte |
| Server `KeepAlive` relay | 8 s of uplink silence (`CLIENT_MESSAGE_TIMEOUT` protection) |
| Fatal `Error` | forwarded with code/description, both sockets closed, client reconnects with backoff |
| `Warning` | forwarded, session continues (asserted) |

## 3. `ConversationText` — schema and delivery

Documented payload: `{ type, role: "user"|"assistant", content, conversational_behavior }`.

- **`flags.history` is not required for `ConversationText`.** Verified in the schema:
  `flags.history` is documented as "Enable or disable **history** message reporting"
  (`History` events), and `ConversationText` is listed as an independent server event.
  We still send `flags.history: true` explicitly for clarity.
- There is **no `is_final` field** in the Voice Agent `ConversationText` event (that is
  STT-speak). Our UI therefore does not rely on it.
- The proxy forwards the event verbatim (no filtering), and the client reduces it to a
  message **synchronously on arrival** — measured at **p50 = 4 ms** from event arrival to
  painted text (see `docs/LATENCY_REPORT.md`).
- Duplicates (e.g. a replayed transcript after a reconnect) are suppressed by content +
  role, and the message is associated with the correct conversation turn.
- Null/empty/invalid-role events are rejected without corrupting turn state.

### Is word-by-word user transcription available?

**No, not through this integration.** Per `docs/voice-agent-speculative-replies`, the
user's `ConversationText` and the agent audio are *gated on turn confirmation*, so the
Voice Agent API does not emit interim per-word transcripts. Real interim transcription
would require opening a **second** streaming STT socket (`/v1/listen` nova-3/flux)
side-by-side, which doubles STT cost, needs de-duplication against `ConversationText`,
and can disagree with the agent's own transcript. **Not implemented** — documented as a
trade-off instead of being faked.

## 4. Eager end-of-turn (Flux v2)

- Schema: `eager_eot_threshold` exists **only** on the Flux (v2) listen provider,
  range 0.3–0.9, "when set, enables EagerEndOfTurn and TurnResumed events".
- In the Voice Agent integration the *agent* performs the speculative work server-side:
  it starts the LLM at the eager trigger and holds audio until the turn is confirmed.
  The Voice Agent **server-event list** (`docs/voice-agent-outputs`) contains no
  `EagerEndOfTurn` / `TurnResumed` / `EndOfTurn` events, so the client must not depend on
  them. We therefore:
  1. enable `eager_eot_threshold: 0.4` / `eot_threshold: 0.7` / `eot_timeout_ms: 2000`
     automatically when a Flux model is selected (visible in the UI, not silent);
  2. **defensively handle** `EagerEndOfTurn`, `TurnResumed`, `EndOfTurn` and the
     Flux-STT-style `TurnInfo{event:…}` payload — turning them into a visible
     "drafting a reply" state, cancelling it on `TurnResumed`, finalising on `EndOfTurn`;
  3. never emit a reply from a speculative event, so a resumed turn cannot produce a
     duplicate answer (asserted in `tests/conversation.test.ts` and the browser e2e).
- Measured value: `speculativeWindowMs` / `speculativeGainMs` are reported in the UI.
  Without a live key we cannot state a real ms saving (see limitations).

## 5. HTTP 202 investigation

**Which endpoint?** The frontend makes exactly three kinds of HTTPS request:
`GET /api/health` (on load, on Refresh, on retry), the static app assets, and the
WebSocket upgrade to `/api/agent-proxy`. Everything else is WebSocket frames.

**Is the app returning 202?** No — verified by running the production server and probing
every route locally:

```
GET  /api/health       -> 200 (JSON)
GET  /prototype-1      -> 200 (SPA)
GET  /api/agent-proxy  -> 426 (was: 200 HTML — see D17)
GET  /nope             -> 200 (SPA)
OPTIONS /api/health    -> 200
```

So a 202 in a deployment is produced by an **intermediary** (edge / reverse proxy /
platform front end) that accepts the request asynchronously: either for `/api/health`
(queued while the container warms up) or for the WebSocket handshake (a buffered HTTP
status instead of `101 Switching Protocols`). That it is not an error is exactly why it
must not be surfaced as one.

**What the app did wrong** (both now fixed):

1. `checkHealth()` used `res.ok` (true for 202) and then blindly `res.json()`.
   - 202 + empty body → JSON throw → `setHealth(null)` → header says *Backend Offline*,
     Start permanently disabled, **no retry** (waits forever).
   - 202 + JSON without `deepgramApiKeyConfigured` → *Key Missing*.
   → a successful asynchronous acceptance was displayed as a failure (D16).
2. A non-101 answer to `new WebSocket(...)` only produced code 1006 and the message
   "Proxy WebSocket connection error" — no way to tell a 202/404/5xx edge from a
down backend.

**Fix**

- `probeBackendHealth()` implements an explicit status contract: `200`+valid JSON ⇒
  `ready`; `202`/`204` ⇒ `starting` (job id + `Retry-After` surfaced, bounded auto-retry
  with backoff); `2xx` with a non-JSON body ⇒ explicit routing error; `4xx/5xx` ⇒
  `unavailable` with the server message; network failure ⇒ `error`.
- UI: *Backend starting (HTTP 202)* badge + banner + auto-retry (60 s budget) + Retry-now.
- `probeAgentUpgrade()` runs after a 1006 close and names the real answer
  (e.g. "intermediary answered with HTTP 202 instead of 101; check that upgrades are
  forwarded for /api/agent-proxy").
- Server: `426 Upgrade Required` for HTTP requests to the WS path, JSON `404` for unknown
  `/api/*`, `Cache-Control: no-store` on `/api/health` (a cached 200/202 is
  indistinguishable from a live backend).

**Reproducible proof** — `tests/protocol.test.ts` →
"reproducible HTTP 202: an edge that accepts /api/health asynchronously then serves it":
a local edge returns `202 {job_id} + Retry-After: 0` once, then proxies to the real server;
the client reports `starting` (never offline) and then `ready` with the real payload.
`tests/http.test.ts` covers 202/204/5xx/HTML-body/network/`Retry-After`/upgrade-probe cases.
