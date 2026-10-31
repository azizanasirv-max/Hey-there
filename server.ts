import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import {
  AgentModelConfig,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AGENT_WS_URL,
  buildValidatedSettings,
  normalizeAgentConfig,
} from './src/shared/voiceAgentConfig';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Max time we wait for the browser's ConfigureSettings before using defaults. */
const SETTINGS_WAIT_MS = 1200;
/** Upstream connect timeout — prevents an endless "CONNECTING" state. */
const UPSTREAM_CONNECT_TIMEOUT_MS = 12000;
/**
 * Voice Agent closes sockets that go silent (`CLIENT_MESSAGE_TIMEOUT`), so we
 * relay a `KeepAlive` upstream when no microphone audio was forwarded for this
 * long. The documented cadence is one KeepAlive every 8 s while idle.
 */
const CLIENT_AUDIO_IDLE_KEEPALIVE_MS = Number(process.env.PROXY_IDLE_KEEPALIVE_MS || 8000);
/** Aggregate agent-audio telemetry instead of one JSON message per frame. */
const AUDIO_STATS_INTERVAL_MS = 1000;
/** Liveness ping for the browser socket (detects dead TCP, frees upstream sockets). */
const CLIENT_PING_INTERVAL_MS = 20000;
/** Back-pressure guard: drop microphone frames rather than buffer unboundedly. */
const MAX_UPSTREAM_BUFFERED_BYTES = 1_000_000;
const MAX_CLIENT_BUFFERED_BYTES = 2_000_000;

type Labelled = { at: number; label: string };

function nowMs() {
  return Date.now();
}

function logLatency(label: string, since?: Labelled | null) {
  if (!since) return;
  console.log(`[Latency] ${label}: ${nowMs() - since.at} ms`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  const PORT = process.env.PORT || 3000;
  const agentUrl = process.env.DEEPGRAM_AGENT_URL?.trim() || DEFAULT_AGENT_WS_URL;

  app.use(express.json());

  // Health endpoint for backend & API key status verification
  app.get('/api/health', (req, res) => {
    // Never let an intermediary cache a readiness probe: a cached 200/202
    // is indistinguishable from a live backend.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('X-Agent-Proxy', 'deepgram-voice-agent');
    const rawKey = process.env.DEEPGRAM_API_KEY;
    const hasApiKey = Boolean(rawKey && rawKey.trim().length > 0 && !rawKey.includes('your_actual'));
    const maskedKey = hasApiKey ? `${rawKey!.trim().substring(0, 4)}...${rawKey!.trim().slice(-4)}` : null;

    res.json({
      status: 'ok',
      deepgramApiKeyConfigured: hasApiKey,
      maskedKey,
      agentUrl,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || 'localhost';
    const url = new URL(request.url || '', `http://${host}`);
    if (url.pathname === '/api/agent-proxy') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    console.log('[Proxy] Client browser connected to /api/agent-proxy');

    const connectedAt: Labelled = { at: nowMs(), label: 'client-connected' };
    const apiKey = process.env.DEEPGRAM_API_KEY?.trim();

    if (!apiKey || apiKey.includes('your_actual')) {
      console.warn('[Proxy] Connection rejected: DEEPGRAM_API_KEY missing or placeholder.');
      clientWs.send(
        JSON.stringify({
          type: 'Error',
          code: 'API_KEY_MISSING',
          description:
            'DEEPGRAM_API_KEY environment variable is missing on the server. Add it to .env and restart the server.',
          message: 'DEEPGRAM_API_KEY environment variable is missing on the server.',
        })
      );
      clientWs.close(1008, 'API Key missing');
      return;
    }

    let modelConfig: AgentModelConfig = { ...DEFAULT_AGENT_CONFIG };
    let deepgramWs: WebSocket | null = null;
    let isSettingsApplied = false;
    let settingsMessageSent = false;
    let clientClosed = false;
    let isAlive = true;

    // Latency/telemetry counters
    let welcomeAt: Labelled | null = null;
    let settingsSentAt: Labelled | null = null;
    let firstAgentAudioAt: Labelled | null = null;
    let audioFramesFromClient = 0;
    let audioBytesFromClient = 0;
    let audioFramesDropped = 0;
    let agentAudioFrames = 0;
    let agentAudioBytes = 0;
    let agentAudioFramesDropped = 0;
    let lastClientAudioAt = 0;
    let statsDirty = false;

    // Client configuration race fix: buffer Welcome until the browser's
    // ConfigureSettings arrives (or SETTINGS_WAIT_MS elapses).
    let welcomeReceived = false;
    let clientConfigReceived = false;
    let settingsWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let upstreamConnectTimer: ReturnType<typeof setTimeout> | null = null;

    const sendClient = (payload: Record<string, unknown>): boolean => {
      if (clientWs.readyState !== WebSocket.OPEN) return false;
      if (clientWs.bufferedAmount > MAX_CLIENT_BUFFERED_BYTES) return false;
      try {
        clientWs.send(JSON.stringify(payload));
        return true;
      } catch (err) {
        console.error('[Proxy] Failed to send message to client:', err);
        return false;
      }
    };

    const clearTimers = () => {
      for (const t of [settingsWaitTimer, statsTimer, keepAliveTimer, pingTimer, upstreamConnectTimer]) {
        if (t) clearTimeout(t as ReturnType<typeof setTimeout>);
      }
      settingsWaitTimer = statsTimer = keepAliveTimer = pingTimer = upstreamConnectTimer = null;
    };

    const emitAudioStats = () => {
      if (!statsDirty) return;
      statsDirty = false;
      sendClient({
        type: 'AgentAudioStats',
        frames: agentAudioFrames,
        bytes: agentAudioBytes,
        droppedFrames: agentAudioFramesDropped,
        inputFrames: audioFramesFromClient,
        inputBytes: audioBytesFromClient,
        inputDroppedFrames: audioFramesDropped,
        firstAudioDelayMs: firstAgentAudioAt && settingsSentAt ? firstAgentAudioAt.at - settingsSentAt.at : null,
        timestamp: new Date().toISOString(),
      });
    };

    /**
     * Send the single `Settings` message, after the browser has supplied its
     * model configuration. Never sends twice (`SETTINGS_ALREADY_APPLIED`).
     */
    const maybeSendSettings = (reason: string) => {
      if (settingsMessageSent || !welcomeReceived || !clientConfigReceived) return;
      if (!deepgramWs || deepgramWs.readyState !== WebSocket.OPEN) return;
      if (settingsWaitTimer) {
        clearTimeout(settingsWaitTimer);
        settingsWaitTimer = null;
      }

      // Validate + repair before sending, so a stale/invalid model id can never
      // turn into a fatal `INVALID_SETTINGS` error mid-session.
      const validated = buildValidatedSettings(modelConfig);
      const payload = validated.settings;
      modelConfig = validated.config;
      for (const warning of validated.warnings) {
        console.warn(`[Proxy] Settings corrected: ${warning}`);
        sendClient({ type: 'Warning', code: 'SETTINGS_CORRECTED', description: warning });
      }
      settingsMessageSent = true;
      settingsSentAt = { at: nowMs(), label: 'settings-sent' };
      deepgramWs.send(JSON.stringify(payload));
      console.log(`[Proxy -> Deepgram] Settings sent (${reason}): ${JSON.stringify(modelConfig)}`);
      sendClient({ type: 'ProxyStatus', status: 'SettingsSent', settings: payload, warnings: validated.warnings });
    };

    const applyClientConfig = (rawConfig: unknown) => {
      // Values are normalized here and validated right before `Settings` is sent.
      modelConfig = normalizeAgentConfig(rawConfig, DEFAULT_AGENT_CONFIG);
      clientConfigReceived = true;
      console.log('[Proxy] Model configuration received from browser:', modelConfig);
      maybeSendSettings('client configuration');
    };

    // ------------------------------------------------------- upstream socket
    try {
      console.log(`[Proxy -> Deepgram] Connecting to ${agentUrl}`);
      deepgramWs = new WebSocket(agentUrl, {
        headers: { Authorization: `Token ${apiKey}` },
      });
    } catch (err: any) {
      console.error('[Proxy -> Deepgram] Failed to construct WebSocket:', err);
      sendClient({
        type: 'Error',
        code: 'CONNECTION_FAILED',
        description: `Failed to open Deepgram WebSocket: ${err.message}`,
        message: err.message,
      });
      clientWs.close(1011, 'Connection error');
      return;
    }

    upstreamConnectTimer = setTimeout(() => {
      if (isSettingsApplied) return;
      console.error('[Proxy -> Deepgram] Upstream connect timeout');
      sendClient({
        type: 'Error',
        code: 'UPSTREAM_TIMEOUT',
        description: `Deepgram did not accept the connection within ${UPSTREAM_CONNECT_TIMEOUT_MS} ms.`,
      });
      try {
        deepgramWs?.close(1011, 'upstream timeout');
      } catch {
        /* ignore */
      }
    }, UPSTREAM_CONNECT_TIMEOUT_MS);

    deepgramWs.on('open', () => {
      console.log('[Proxy <- Deepgram] WebSocket connection established.');
      if (upstreamConnectTimer) {
        clearTimeout(upstreamConnectTimer);
        upstreamConnectTimer = null;
      }
      sendClient({
        type: 'ProxyStatus',
        status: 'DeepgramConnected',
        message: 'Connected to Deepgram Voice Agent API. Awaiting Welcome message...',
      });
    });

    // Agent (TTS) audio: forward to the browser instead of discarding it.
    deepgramWs.on('message', (data: WebSocket.Data, isBinary: boolean) => {
      if (isBinary) {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        agentAudioFrames++;
        agentAudioBytes += frame.length;
        if (!firstAgentAudioAt) {
          firstAgentAudioAt = { at: nowMs(), label: 'first-agent-audio' };
          logLatency('SettingsApplied -> first agent audio byte', settingsSentAt);
        }
        statsDirty = true;

        if (clientWs.readyState !== WebSocket.OPEN) {
          agentAudioFramesDropped++;
          return;
        }
        if (clientWs.bufferedAmount > MAX_CLIENT_BUFFERED_BYTES) {
          // Client cannot keep up: drop rather than grow memory without bound.
          agentAudioFramesDropped++;
          return;
        }
        try {
          clientWs.send(frame, { binary: true });
        } catch (err) {
          agentAudioFramesDropped++;
          console.error('[Proxy] Failed to forward agent audio frame:', err);
        }
        return;
      }

      try {
        const textStr = data.toString('utf-8');
        const json = JSON.parse(textStr);

        if (json.type === 'Welcome') {
          welcomeAt = { at: nowMs(), label: 'welcome' };
          console.log(`[Proxy <- Deepgram] Welcome (request_id=${json.request_id || 'n/a'})`);
          logLatency('client-connected -> Welcome', connectedAt);
          welcomeReceived = true;
          // Do not send Settings from defaults: wait briefly for the browser's
          // model configuration so the UI and the session cannot disagree.
          if (clientConfigReceived) {
            maybeSendSettings('configuration already received');
          } else {
            settingsWaitTimer = setTimeout(() => {
              if (clientConfigReceived || settingsMessageSent) return;
              console.warn(
                `[Proxy] No ConfigureSettings from browser after ${SETTINGS_WAIT_MS} ms - using defaults.`
              );
              clientConfigReceived = true;
              maybeSendSettings('settings wait timeout');
            }, SETTINGS_WAIT_MS);
          }
        } else if (json.type === 'SettingsApplied') {
          isSettingsApplied = true;
          // Arm the idle-keepalive watchdog even if the browser never sends a frame.
          if (lastClientAudioAt === 0) lastClientAudioAt = nowMs();
          if (upstreamConnectTimer) {
            clearTimeout(upstreamConnectTimer);
            upstreamConnectTimer = null;
          }
          console.log('[Proxy <- Deepgram] SettingsApplied — microphone audio unlocked.');
          logLatency('settings sent -> SettingsApplied', settingsSentAt);
          sendClient({
            type: 'SessionReady',
            message: 'Deepgram SettingsApplied verified. Real-time microphone audio stream unlocked.',
          });
        } else if (json.type === 'LatencyReport') {
          console.log(
            `[Latency] Deepgram turn report: stt=${json.stt_latency ?? '-'}s ` +
              `ttt=${json.ttt_token_latency ?? '-'}s tts=${json.tts_latency ?? '-'}s total=${json.total_latency ?? '-'}s`
          );
        } else if (json.type === 'Error') {
          console.error(`[Proxy <- Deepgram] FATAL ERROR: code=${json.code}, description=${json.description}`);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(textStr);
          }
          // Docs: every `Error` is fatal; close so the browser can reconnect cleanly.
          try {
            deepgramWs?.close(1011, 'Deepgram Error');
          } catch {
            /* ignore */
          }
          return;
        } else if (json.type === 'Warning') {
          console.warn(`[Proxy <- Deepgram] Warning: code=${json.code}, description=${json.description}`);
        }

        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(textStr);
        }
      } catch (err) {
        console.error('[Proxy] Error parsing Deepgram message:', err);
      }
    });

    deepgramWs.on('error', (err: Error) => {
      console.error('[Proxy <- Deepgram] WebSocket error:', err.message);
      sendClient({
        type: 'Error',
        code: 'WEBSOCKET_ERROR',
        description: `Deepgram API Error: ${err.message}`,
        message: err.message,
      });
    });

    deepgramWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'Deepgram closed socket';
      console.log(`[Proxy <- Deepgram] Connection closed: code=${code}, reason=${reasonStr}`);
      isSettingsApplied = false;
      sendClient({ type: 'ProxyStatus', status: 'Disconnected', code, reason: reasonStr });
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, reasonStr.slice(0, 120));
    });

    // -------------------------------------------------- browser -> upstream
    clientWs.on('message', (message: WebSocket.Data, isBinary: boolean) => {
      if (isBinary) {
        if (!deepgramWs || deepgramWs.readyState !== WebSocket.OPEN || !isSettingsApplied) {
          audioFramesDropped++;
          return;
        }
        const frame = Buffer.isBuffer(message) ? message : Buffer.from(message as ArrayBuffer);
        if (deepgramWs.bufferedAmount > MAX_UPSTREAM_BUFFERED_BYTES) {
          audioFramesDropped++;
          return;
        }
        audioFramesFromClient++;
        audioBytesFromClient += frame.length;
        lastClientAudioAt = nowMs();
        statsDirty = true;
        try {
          deepgramWs.send(frame, { binary: true });
        } catch (err) {
          audioFramesDropped++;
          console.error('[Proxy] Failed to forward microphone frame:', err);
        }
        return;
      }

      try {
        const json = JSON.parse(message.toString('utf-8'));
        switch (json.type) {
          case 'ConfigureSettings':
            applyClientConfig(json.config);
            break;
          case 'InjectText':
          case 'InjectUserMessage': {
            if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN && isSettingsApplied) {
              const content = json.content || json.text || '';
              if (content) {
                deepgramWs.send(JSON.stringify({ type: 'InjectUserMessage', content }));
                console.log('[Proxy -> Deepgram] InjectUserMessage:', content.slice(0, 80));
              }
            } else {
              sendClient({
                type: 'Warning',
                code: 'SESSION_NOT_READY',
                description: 'Text injection ignored: the session is not ready yet.',
              });
            }
            break;
          }
          case 'KeepAlive':
            // Protocol rule: nothing except `Settings` may be sent before
            // `SettingsApplied` (`NON_SETTINGS_MESSAGE_BEFORE_SETTINGS`).
            if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN && isSettingsApplied) {
              deepgramWs.send(JSON.stringify({ type: 'KeepAlive' }));
              lastClientAudioAt = nowMs();
            }
            break;
          case 'Ping':
            sendClient({ type: 'Pong', timestamp: nowMs() });
            break;
          default:
            console.warn('[Proxy] Ignoring unknown client text message type:', json.type);
        }
      } catch (err) {
        console.error('[Proxy] Failed to parse browser text message:', err);
        sendClient({
          type: 'Warning',
          code: 'MALFORMED_CLIENT_MESSAGE',
          description:
            'A client message was not valid JSON and was dropped. The proxy never forwards unparsable frames upstream.',
        });
      }
    });

    // --------------------------------------------- timers (stats + keepalive)
    statsTimer = setInterval(() => {
      // Aggregate audio counters once per second (never per frame).
      emitAudioStats();
      // If the browser is not sending audio (muted, tab throttled, network
      // stalled) keep the Deepgram session alive explicitly: the Voice Agent
      // closes sockets that go silent (`CLIENT_MESSAGE_TIMEOUT`).
      if (
        deepgramWs &&
        deepgramWs.readyState === WebSocket.OPEN &&
        isSettingsApplied &&
        lastClientAudioAt > 0 &&
        nowMs() - lastClientAudioAt >= CLIENT_AUDIO_IDLE_KEEPALIVE_MS
      ) {
        try {
          deepgramWs.send(JSON.stringify({ type: 'KeepAlive' }));
        } catch {
          /* socket closing */
        }
        lastClientAudioAt = nowMs();
      }
    }, AUDIO_STATS_INTERVAL_MS);

    // Detect a dead browser socket so the upstream (paid) socket is released.
    clientWs.on('pong', () => {
      isAlive = true;
    });
    pingTimer = setInterval(() => {
      if (!isAlive) {
        console.warn('[Proxy] Client socket unresponsive - terminating.');
        clientWs.terminate();
        return;
      }
      isAlive = false;
      try {
        clientWs.ping();
      } catch {
        /* ignore */
      }
    }, CLIENT_PING_INTERVAL_MS);

    const cleanup = (why: string) => {
      if (clientClosed) return;
      clientClosed = true;
      console.log(`[Proxy] Cleaning up session (${why}).`);
      clearTimers();
      emitAudioStats();
      const dg = deepgramWs;
      deepgramWs = null;
      if (dg && (dg.readyState === WebSocket.OPEN || dg.readyState === WebSocket.CONNECTING)) {
        try {
          dg.close(1000, 'client closed');
        } catch {
          /* ignore */
        }
      }
      if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, 'cleanup');
    };

    clientWs.on('close', () => cleanup('browser disconnected'));
    clientWs.on('error', (err) => {
      console.error('[Proxy] Client socket error:', err.message);
      cleanup('client error');
    });
  });

  // ---------------------------------------------------------------- HTTP routes
  //
  // Explicit API guards *before* the SPA fallback. Without these, a plain HTTP
  // request to the WebSocket endpoint (or a typo'd API path) is answered with
  // `200 text/html` (the SPA), which hides routing/proxy misconfiguration and
  // looks like a successful API call to any client that only checks `res.ok`.
  app.all('/api/agent-proxy', (req, res) => {
    // RFC 7231 §6.5.15: the resource only exists over an upgraded connection.
    // 426 is the correct answer to an HTTP request that cannot be upgraded — not
    // 200, and not 202 (202 would imply we accepted it asynchronously).
    res.set('Cache-Control', 'no-store');
    res.set('Upgrade', 'websocket');
    res.status(426).json({
      error: 'UPGRADE_REQUIRED',
      message:
        'This endpoint only accepts a WebSocket upgrade (HTTP 101 Switching Protocols). ' +
        'Use ws:// or wss:// — a plain HTTP GET cannot open a Voice Agent session.',
    });
  });

  app.all('/api/*', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `No such API route: ${req.method} ${req.path}`,
    });
  });

  // Mount Vite or static file server
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  return new Promise<void>((resolve) => {
    server.listen(Number(PORT), '0.0.0.0', () => {
      console.log(`[Server] Deepgram Voice Agent Proxy running on http://0.0.0.0:${PORT}`);
      console.log(`[Server] Upstream agent endpoint: ${agentUrl}`);
      resolve();
    });
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
