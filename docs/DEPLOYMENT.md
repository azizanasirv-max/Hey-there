# Deployment (Render) — runbook

The app is a **single Node web service**. It serves the built React client and
proxies the browser WebSocket to Deepgram with a server-side API key. There is
no separate frontend host, no build-time secret and no database.

```
Browser (HTTPS/WSS)
   │  GET  /                → dist/index.html + /assets/*.js|css
   │  GET  /api/health      → JSON readiness probe (Render health check)
   │  WSS  /api/agent-proxy → proxy → wss://agent.deepgram.com/v1/agent/converse
                              (Authorization: Token $DEEPGRAM_API_KEY, server-side only)
```

## 1. What Render runs

| Setting | Value |
| --- | --- |
| Service type | **Web Service** (Node runtime — *not* a Static Site, the WebSocket proxy is required) |
| Branch | `main` once this work is merged; use the feature branch to test first |
| Runtime / Node | Node **22.x** (`NODE_VERSION=22.14.0`; Vite 8 needs ≥ 20.19 / ≥ 22.12) |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start`  →  `node server.js` |
| Health check path | `/api/health` |
| Port | Render injects `PORT`; the server binds `0.0.0.0:$PORT` |
| Instance type | Starter (free tier works; a free instance idles after inactivity, so the first request after idling takes ~30 s) |

`npm run build` does two things:

1. `vite build` → `dist/` (hashed assets + `index.html`), and
2. `esbuild server.ts ... --outfile=server.js` → the server bundle that `npm start`
   runs with plain `node` (no TypeScript loader needed at runtime).

`--include=dev` is deliberate: `NODE_ENV=production` is set on the service, and
plain `npm ci` would then skip `vite`/`esbuild`/`typescript` during the build.

## 2. Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `DEEPGRAM_API_KEY` | **yes** | Secret. Set it in the Render dashboard (*Environment*), never in git. The browser never receives it; `/api/health` only returns a masked hint. |
| `NODE_ENV` | yes | `production` → serve `dist/` instead of Vite dev middleware. |
| `NODE_VERSION` | recommended | `22.14.0`. |
| `PORT` | auto | Injected by Render. Do not hardcode it. |
| `HOST` | no | Defaults to `0.0.0.0` (required by Render's router). |
| `DEEPGRAM_AGENT_URL` | no | Defaults to `wss://agent.deepgram.com/v1/agent/converse`. Used by tests to point at a local mock; leave unset in production. |
| `PROXY_IDLE_KEEPALIVE_MS` | no | Defaults to `8000`. Cadence of the `KeepAlive` relayed when the uplink is silent. |
| `RENDER_GIT_COMMIT` | auto | Set by Render; surfaced as the short `commit` field in `/api/health`. |

Never commit a real key: `.env` is git-ignored, `.env.example` documents names only.

## 3. Deploying with the Blueprint (`render.yaml`)

`render.yaml` in the repository root declares the service above.

1. Render Dashboard → **New +** → **Blueprint** → select this repository and branch.
2. Render reads `render.yaml` and shows the `hey-there` web service.
3. It prompts for `DEEPGRAM_API_KEY` (the variable is marked `sync: false`, i.e.
   "prompt me, never store in git"). Paste the key from
   <https://console.deepgram.com>.
4. **Apply** → the first build + deploy starts. Watch *Logs* for:

   ```
   [Server] Production mode: serving built client from /opt/render/project/src/dist
   [Server] Deepgram Voice Agent Proxy running on http://0.0.0.0:10000
   [Server] WebSocket path: /api/agent-proxy (ws:// for http, wss:// behind TLS)
   ```

Without the Blueprint (manual service):

1. **New +** → **Web Service** → connect the repo → runtime **Node**.
2. Build command `npm ci --include=dev && npm run build`.
3. Start command `npm start`.
4. Health check path `/api/health`; add `NODE_ENV=production`,
   `NODE_VERSION=22.14.0`, and the secret `DEEPGRAM_API_KEY`.

The **manual dashboard actions that remain** are exactly: creating the service
(or applying the Blueprint) and entering `DEEPGRAM_API_KEY`. Nothing else needs
the dashboard.

## 4. Verify the live URL

```bash
# one command, external checks (health, assets, API guards, WS 101)
npm run verify:live -- https://<your-service>.onrender.com
```

Ambiguous states and what they mean:

| `verify:live` output | Meaning |
| --- | --- |
| `serving built assets in production` fails with `vite-dev-middleware` | `NODE_ENV` is not `production` on the service. |
| `DEEPGRAM_API_KEY is configured server-side` fails | The dashboard variable is missing/empty (or still the placeholder) — add it; Render redeploys. |
| `plain HTTP on the WS path is 426` fails with **200/202** | Something in front of the app answers for `/api/agent-proxy` instead of forwarding the upgrade; the UI shows this as *"an intermediary answered ... 202"*. |
| `WebSocket upgrade succeeded (HTTP 101)` fails | The edge is not forwarding upgrades (WebSockets are enabled by default on Render web services). |
| `API_KEY_MISSING` instead of `SessionReady` | Expected whenever no key is configured. |

Browser-side checks (needs a microphone):

1. Open `https://<service>/prototype-1` in its own tab (not an embedded iframe).
2. DevTools → Network → WS: the `/api/agent-proxy` request must show **101 Switching Protocols** on `wss://...`.
3. Header badge must read **Backend Ready**; press *Start Voice Agent Session*.
4. Console must be free of errors; speak → the transcript appears immediately (measured p50 ≈ 4 ms) and the agent voice plays.

Server-side logs to expect per session: `[Proxy] Client browser connected`,
`Welcome`, `Settings sent`, `SettingsApplied — microphone audio unlocked.`

## 5. Platform behaviour the code handles explicitly

* **TLS termination** — Render terminates TLS and forwards `X-Forwarded-Proto`;
  the app sets `trust proxy = 1`, so host/protocol detection is correct. The
  browser dials `wss://.../api/agent-proxy`; the container only sees `ws://`.
* **Health probing** — `/api/health` is always `Cache-Control: no-store`, so a
  cached 200 can never mask a dead instance.
* **Free-instance warm-up** — the client distinguishes `200` (ready) from
  `202/204` (accepted, still starting) and retries with backoff instead of
  showing "offline"; a 202 on the WebSocket path is reported as an
  intermediary/proxy problem rather than a generic socket error.
* **Deploys** — `SIGTERM` closes browser sockets (`1001`) and drains the HTTP
  server within 8 s, so no half-open upstream (paid) Voice Agent sockets linger.
* **Caching** — `index.html` is `no-store`, hashed `/assets/*` are `immutable`
  for a year, so a new deploy is picked up on the next navigation.

## 6. Local production rehearsal (no Render account needed)

```bash
npm run build
NODE_ENV=production DEEPGRAM_API_KEY=... npm start   # http://localhost:3000/prototype-1
```

The same topology (HTTPS + WSS behind a TLS-terminating proxy) is exercised by
`npm run test:prod` and `npm run test:e2e:prod`, which are hermetic: they mock
Deepgram's wire protocol and use a throwaway self-signed certificate.
