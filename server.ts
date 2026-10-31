import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  const PORT = process.env.PORT || 3000;

  app.use(express.json());

  // Health endpoint for backend & API key status verification
  app.get('/api/health', (req, res) => {
    const rawKey = process.env.DEEPGRAM_API_KEY;
    const hasApiKey = Boolean(rawKey && rawKey.trim().length > 0 && !rawKey.includes('your_actual'));
    const maskedKey = hasApiKey 
      ? `${rawKey!.trim().substring(0, 4)}...${rawKey!.trim().slice(-4)}`
      : null;

    res.json({
      status: 'ok',
      deepgramApiKeyConfigured: hasApiKey,
      maskedKey,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // Setup WebSocket Proxy on /api/agent-proxy
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

  // Handle client WebSocket connections from browser
  wss.on('connection', (clientWs, req) => {
    console.log('[Proxy] Client browser connected to /api/agent-proxy');
    
    let deepgramWs: WebSocket | null = null;
    let isSettingsApplied = false;
    let discardedAudioFrames = 0;
    let discardedAudioBytes = 0;
    let audioFramesSent = 0;

    const apiKey = process.env.DEEPGRAM_API_KEY?.trim();

    if (!apiKey || apiKey.includes('your_actual')) {
      console.warn('[Proxy] Connection rejected: DEEPGRAM_API_KEY missing or placeholder.');
      clientWs.send(JSON.stringify({
        type: 'Error',
        code: 'API_KEY_MISSING',
        description: 'DEEPGRAM_API_KEY environment variable is missing on the server. Please configure DEEPGRAM_API_KEY.',
        message: 'DEEPGRAM_API_KEY environment variable is missing on the server.'
      }));
      clientWs.close(1008, 'API Key missing');
      return;
    }

    // Default configuration strictly complying with official Deepgram Voice Agent Settings schema
    // https://developers.deepgram.com/docs/voice-agent-settings
    let modelConfig = {
      listenProvider: 'deepgram',
      listenModel: 'nova-3',
      thinkProvider: 'open_ai',
      thinkModel: 'gpt-4o-mini',
      speakProvider: 'deepgram',
      speakModel: 'flux-kit-en',
      speakVersion: 'v2',
      sampleRate: 24000,
      encoding: 'linear16'
    };

    const buildOfficialSettingsMessage = () => {
      return {
        type: 'Settings', // Strictly "Settings", never "SettingsConfiguration"
        audio: {
          input: {
            encoding: modelConfig.encoding,
            sample_rate: modelConfig.sampleRate
          },
          output: {
            encoding: 'linear16',
            sample_rate: 24000,
            container: 'none'
          }
        },
        agent: {
          listen: {
            provider: {
              type: modelConfig.listenProvider,
              model: modelConfig.listenModel
            }
          },
          think: {
            provider: {
              type: modelConfig.thinkProvider,
              model: modelConfig.thinkModel
            }
          },
          speak: {
            provider: {
              type: modelConfig.speakProvider,
              model: modelConfig.speakModel,
              version: modelConfig.speakVersion || 'v2'
            }
          }
        }
      };
    };

    // Connect to Deepgram Agent API
    try {
      console.log('[Proxy -> Deepgram] Connecting to wss://agent.deepgram.com/v1/agent/converse');
      deepgramWs = new WebSocket('wss://agent.deepgram.com/v1/agent/converse', {
        headers: {
          'Authorization': `Token ${apiKey}`
        }
      });
    } catch (err: any) {
      console.error('[Proxy -> Deepgram] Failed to construct WebSocket:', err);
      clientWs.send(JSON.stringify({
        type: 'Error',
        code: 'CONNECTION_FAILED',
        description: `Failed to open Deepgram WebSocket: ${err.message}`,
        message: err.message
      }));
      clientWs.close(1011, 'Connection error');
      return;
    }

    // 1. Deepgram socket open
    deepgramWs.on('open', () => {
      console.log('[Proxy <- Deepgram] WebSocket connection established successfully.');
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'ProxyStatus',
          status: 'DeepgramConnected',
          message: 'Connected to Deepgram Voice Agent API (wss://agent.deepgram.com/v1/agent/converse). Awaiting Welcome message...'
        }));
      }
    });

    // 2. Incoming messages from Deepgram
    deepgramWs.on('message', (data: WebSocket.Data, isBinary: boolean) => {
      if (isBinary) {
        // BINARY AUDIO DISCARD REQUIREMENT:
        // Discard generated audio frames immediately. Do not play, store or forward to frontend.
        discardedAudioFrames++;
        const byteLen = Buffer.isBuffer(data) ? data.length : (data as ArrayBuffer).byteLength || 0;
        discardedAudioBytes += byteLen;

        // Send periodic/aggregated telemetry update to browser
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(JSON.stringify({
            type: 'AudioDiscardedTelemetry',
            frames: discardedAudioFrames,
            bytes: discardedAudioBytes,
            lastFrameBytes: byteLen,
            timestamp: new Date().toISOString()
          }));
        }
        return; // DISCARD AUDIO
      }

      // Handle JSON text events from Deepgram
      try {
        const textStr = data.toString('utf-8');
        const json = JSON.parse(textStr);
        console.log(`[Proxy <- Deepgram] Incoming event type: ${json.type}`);

        if (json.type === 'Welcome') {
          console.log(`[Proxy <- Deepgram] Welcome received (session_id: ${json.session_id})`);

          // Send exact official Settings message
          const settingsPayload = buildOfficialSettingsMessage();
          console.log('[Proxy -> Deepgram] Outgoing Frame: TEXT, Type: Settings, Payload:', JSON.stringify(settingsPayload, null, 2));

          if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
            deepgramWs.send(JSON.stringify(settingsPayload));
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({
                type: 'ProxyStatus',
                status: 'SettingsSent',
                settings: settingsPayload
              }));
            }
          }
        } else if (json.type === 'SettingsApplied') {
          isSettingsApplied = true;
          console.log('[Proxy <- Deepgram] SettingsApplied received. Ready to stream microphone audio frames.');
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({
              type: 'SessionReady',
              message: 'Deepgram SettingsApplied verified. Real-time microphone audio stream unlocked.'
            }));
          }
        } else if (json.type === 'Error') {
          console.error(`[Proxy <- Deepgram] FATAL ERROR: code=${json.code}, description=${json.description}`);
          if (json.code === 'UNPARSABLE_CLIENT_MESSAGE') {
            console.error('[Proxy <- Deepgram] UNPARSABLE_CLIENT_MESSAGE details:', JSON.stringify(json));
          }

          // Forward error to client
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify(json));
          }

          // Protect usage and costs: close connection immediately on fatal protocol error
          console.warn('[Proxy] Terminating Deepgram connection due to fatal error.');
          if (deepgramWs) {
            deepgramWs.close(1011, 'Deepgram Error');
            deepgramWs = null;
          }
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(1011, 'Deepgram Error');
          }
          return;
        }

        // Forward Deepgram JSON event to browser
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(textStr);
        }
      } catch (err: any) {
        console.error('[Proxy] Error parsing Deepgram JSON event:', err);
      }
    });

    // 3. Deepgram socket errors & close
    deepgramWs.on('error', (err: Error) => {
      console.error('[Proxy <- Deepgram] WebSocket error:', err.message);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'Error',
          code: 'WEBSOCKET_ERROR',
          description: `Deepgram API Error: ${err.message}`,
          message: err.message
        }));
      }
    });

    deepgramWs.on('close', (code, reason) => {
      const reasonStr = reason?.toString() || 'Deepgram closed socket';
      console.log(`[Proxy <- Deepgram] Connection closed: code=${code}, reason=${reasonStr}`);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({
          type: 'ProxyStatus',
          status: 'Disconnected',
          code,
          reason: reasonStr
        }));
        clientWs.close();
      }
    });

    // 4. Handle incoming messages from browser client
    clientWs.on('message', (message: WebSocket.Data, isBinary: boolean) => {
      if (isBinary) {
        // Forward browser microphone binary PCM audio to Deepgram ONLY AFTER SettingsApplied
        if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN && isSettingsApplied) {
          audioFramesSent++;
          if (audioFramesSent === 1 || audioFramesSent % 50 === 0) {
            console.log(`[Proxy -> Deepgram] Outgoing Frame: BINARY audio frame #${audioFramesSent} (${(message as Buffer).length} bytes)`);
          }
          deepgramWs.send(message, { binary: true });
        } else if (!isSettingsApplied) {
          // Audio sent before SettingsApplied -> Drop to prevent UNPARSABLE_CLIENT_MESSAGE or protocol violation
          // console.log('[Proxy] Dropping audio chunk: SettingsApplied not yet received.');
        }
      } else {
        // Handle control messages from browser
        try {
          const textStr = message.toString('utf-8');
          const json = JSON.parse(textStr);

          // INTERNAL BROWSER-TO-PROXY CONTROL MESSAGE: Never forward ConfigureSettings to Deepgram!
          if (json.type === 'ConfigureSettings') {
            if (json.config) {
              modelConfig = { ...modelConfig, ...json.config };
              console.log('[Proxy] Updated modelConfig from browser client:', modelConfig);
            }
          } else if (json.type === 'InjectText' || json.type === 'InjectUserMessage') {
            // Forward valid Deepgram InjectUserMessage
            if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN && isSettingsApplied) {
              const injectPayload = {
                type: 'InjectUserMessage',
                content: json.content || json.text || ''
              };
              console.log('[Proxy -> Deepgram] Outgoing Frame: TEXT, Type: InjectUserMessage, Payload:', injectPayload);
              deepgramWs.send(JSON.stringify(injectPayload));
            }
          } else {
            console.warn('[Proxy] Ignoring unknown client text message type:', json.type);
          }
        } catch (e) {
          console.error('[Proxy] Failed to parse browser text message:', e);
        }
      }
    });

    clientWs.on('close', () => {
      console.log('[Proxy] Client browser disconnected. Cleaning up Deepgram WebSocket.');
      if (deepgramWs) {
        if (deepgramWs.readyState === WebSocket.OPEN || deepgramWs.readyState === WebSocket.CONNECTING) {
          deepgramWs.close(1000, 'Client disconnected');
        }
        deepgramWs = null;
      }
    });
  });

  // Mount Vite or static file server
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`[Server] Deepgram Voice Agent Proxy running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
