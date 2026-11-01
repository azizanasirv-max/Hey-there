/**
 * Test harness: boots the real proxy (`server.ts`) as a child process pointed at
 * a local mock Voice Agent WebSocket, so the proxy's protocol handling, audio
 * relay and telemetry throttling can be exercised end-to-end in Node.
 *
 * The mock upstream only emulates Deepgram's documented wire protocol — it is
 * NOT evidence that Deepgram itself works; that needs a real DEEPGRAM_API_KEY.
 */
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error('no port')));
      }
    });
  });
}

export interface UpstreamEvent {
  kind: 'connection' | 'binary' | 'settings' | 'keepalive' | 'inject' | 'close' | 'other';
  at: number;
  bytes?: number;
  payload?: any;
}

export interface MockUpstream {
  url: string;
  events: UpstreamEvent[];
  sockets: WebSocket[];
  /** Sends a raw JSON message to every connected proxy socket. */
  sendJson: (payload: unknown) => void;
  /** Sends a binary frame to every connected proxy socket. */
  sendBinary: (buffer: Buffer) => void;
  waitFor: (predicate: (e: UpstreamEvent) => boolean, timeoutMs?: number) => Promise<UpstreamEvent>;
  close: () => Promise<void>;
}

export async function startMockUpstream(
  options: { autoSettingsApplied?: boolean; port?: number } = {}
): Promise<MockUpstream> {
  const port = options.port ?? (await getFreePort());
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  const events: UpstreamEvent[] = [];
  const sockets: WebSocket[] = [];
  const autoApplied = options.autoSettingsApplied ?? true;

  wss.on('connection', (ws) => {
    sockets.push(ws);
    events.push({ kind: 'connection', at: Date.now() });
    ws.send(JSON.stringify({ type: 'Welcome', request_id: 'mock-request-id' }));

    ws.on('message', (data: any, isBinary: boolean) => {
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        events.push({ kind: 'binary', at: Date.now(), bytes: buf.length });
        return;
      }
      let json: any = null;
      try {
        json = JSON.parse(data.toString('utf-8'));
      } catch {
        events.push({ kind: 'other', at: Date.now() });
        return;
      }
      if (json.type === 'Settings') {
        events.push({ kind: 'settings', at: Date.now(), payload: json });
        if (autoApplied) ws.send(JSON.stringify({ type: 'SettingsApplied' }));
      } else if (json.type === 'KeepAlive') {
        events.push({ kind: 'keepalive', at: Date.now() });
      } else if (json.type === 'InjectUserMessage') {
        events.push({ kind: 'inject', at: Date.now(), payload: json });
      } else {
        events.push({ kind: 'other', at: Date.now(), payload: json });
      }
    });

    ws.on('close', () => events.push({ kind: 'close', at: Date.now() }));
  });

  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));

  return {
    url: `ws://127.0.0.1:${port}`,
    events,
    sockets,
    sendJson: (payload) => sockets.forEach((s) => s.readyState === WebSocket.OPEN && s.send(JSON.stringify(payload))),
    sendBinary: (buffer) => sockets.forEach((s) => s.readyState === WebSocket.OPEN && s.send(buffer, { binary: true })),
    waitFor: async (predicate, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = events.find(predicate);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error('Timed out waiting for upstream event');
        await delay(20);
      }
    },
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((s) => s.terminate());
        wss.close(() => resolve());
      }),
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ProxyProcess {
  wsUrl: string;
  httpUrl: string;
  stop: () => Promise<void>;
  stopAndDumpLogs: () => Promise<string>;
}

export interface ClientRecord {
  at: number;
  text?: any;
  binaryBytes?: number;
  binary?: ArrayBuffer;
}

export interface TestClient {
  ws: WebSocket;
  records: ClientRecord[];
  json: (predicate: (msg: any) => boolean, timeoutMs?: number) => Promise<any>;
  countJson: (predicate: (msg: any) => boolean) => number;
  open: () => Promise<void>;
  close: () => Promise<void>;
}

/** Spawn the real proxy server against the mock upstream. */
export async function startProxy(
  env: Record<string, string>,
  serverFile = 'server.ts',
  options: { useNode?: boolean } = {}
): Promise<ProxyProcess> {
  const port = await getFreePort();
  let logs = '';
  const entry = path.isAbsolute(serverFile) ? serverFile : path.join(ROOT, serverFile);
  // `useNode` runs the esbuild bundle exactly like Render's `npm start`
  // (plain node, no TypeScript loader) instead of loading server.ts through tsx.
  const args = options.useNode ? [entry] : ['--import', 'tsx', entry];
  const child: ChildProcess = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      DEEPGRAM_API_KEY: 'test-key-not-real',
      PROXY_IDLE_KEEPALIVE_MS: '800',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (d) => (logs += d.toString()));
  child.stderr?.on('data', (d) => (logs += d.toString()));

  const httpUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(`${httpUrl}/api/health`);
      if (res.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`Proxy did not start. Logs:\n${logs}`);
    }
    await delay(100);
  }

  const stop = async () => {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.once('exit', resolve));
  };

  return {
    wsUrl: `ws://127.0.0.1:${port}/api/agent-proxy`,
    httpUrl,
    stop,
    stopAndDumpLogs: async () => {
      await stop();
      return logs;
    },
  };
}

/** Open a browser-equivalent client to the proxy. */
export function createTestClient(url: string): TestClient {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  const records: ClientRecord[] = [];

  ws.on('message', (data: any, isBinary: boolean) => {
    if (isBinary) {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      const copy = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      records.push({ at: Date.now(), binaryBytes: buf.length, binary: copy });
    } else {
      let parsed: any = null;
      try {
        parsed = JSON.parse(data.toString('utf-8'));
      } catch {
        parsed = { type: 'Unparsable' };
      }
      records.push({ at: Date.now(), text: parsed });
    }
  });

  const json = async (predicate: (msg: any) => boolean, timeoutMs = 8000): Promise<any> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = records.find((r) => r.text && predicate(r.text));
      if (hit) return hit.text;
      if (Date.now() > deadline) throw new Error('Timed out waiting for client JSON message');
      await delay(20);
    }
  };

  return {
    ws,
    records,
    json,
    countJson: (predicate) => records.filter((r) => r.text && predicate(r.text)).length,
    open: () =>
      new Promise<void>((resolve, reject) => {
        if (ws.readyState === WebSocket.OPEN) return resolve();
        ws.once('open', () => resolve());
        ws.once('error', reject);
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) return resolve();
        ws.once('close', () => resolve());
        ws.close();
      }),
  };
}

/** Perform the client handshake the app uses and wait for SessionReady. */
export async function connectAndReady(
  client: TestClient,
  config?: Record<string, unknown>
): Promise<number> {
  await client.open();
  if (config) client.ws.send(JSON.stringify({ type: 'ConfigureSettings', config }));
  await client.json((m) => m.type === 'SessionReady', 8000);
  return Date.now();
}
