import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket } from 'ws';

import { connectAndReady, createTestClient, delay, startMockUpstream, startProxy, TestClient } from './helpers/proxyHarness';
import { probeBackendHealth } from '../src/utils/http';

const FRAME = Buffer.alloc(960, 1);

async function withProxy(
  opts: { autoSettingsApplied?: boolean; env?: Record<string, string> },
  fn: (ctx: Awaited<ReturnType<typeof startMockUpstream>> & { client: TestClient; httpUrl: string }) => Promise<void>
) {
  const upstream = await startMockUpstream({ autoSettingsApplied: opts.autoSettingsApplied });
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url, ...(opts.env || {}) });
  const client = createTestClient(proxy.wsUrl);
  try {
    await client.open();
    await fn({ ...upstream, client, httpUrl: proxy.httpUrl });
  } finally {
    await client.close().catch(() => {});
    await delay(100);
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }
}

test('exactly one Settings message per session, even if the client re-sends config', async () => {
  await withProxy({}, async ({ client, events }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    // Duplicate config messages must not produce another Settings.
    client.ws.send(JSON.stringify({ type: 'ConfigureSettings', config: { listenModel: 'nova-2' } }));
    client.ws.send(JSON.stringify({ type: 'ConfigureSettings', config: { listenModel: 'flux-general-en' } }));
    await delay(800);
    const settings = events.filter((e) => e.kind === 'settings');
    assert.equal(settings.length, 1, 'Deepgram would answer SETTINGS_ALREADY_APPLIED otherwise');
    assert.equal(settings[0].payload.agent.listen.provider.model, 'nova-3', 'the first applied config wins');
  });
});

test('nothing but Settings is sent upstream before SettingsApplied', async () => {
  // The mock never confirms settings, so the proxy must refuse to forward audio
  // or KeepAlive (`NON_SETTINGS_MESSAGE_BEFORE_SETTINGS` would be fatal).
  await withProxy({ autoSettingsApplied: false }, async ({ client, events }) => {
    client.ws.send(JSON.stringify({ type: 'ConfigureSettings', config: { listenModel: 'nova-3' } }));
    await delay(300);
    for (let i = 0; i < 20; i++) client.ws.send(FRAME);
    client.ws.send(JSON.stringify({ type: 'KeepAlive' }));
    client.ws.send(JSON.stringify({ type: 'InjectUserMessage', content: 'hi' }));
    await delay(900);

    assert.equal(events.filter((e) => e.kind === 'settings').length, 1);
    assert.equal(events.filter((e) => e.kind === 'binary').length, 0, 'audio before SettingsApplied must be dropped');
    assert.equal(events.filter((e) => e.kind === 'keepalive').length, 0, 'KeepAlive before SettingsApplied must be dropped');
    assert.equal(events.filter((e) => e.kind === 'inject').length, 0, 'Inject before SettingsApplied must be dropped');
  });
});

test('a late SettingsApplied unlocks audio (sequencing is enforced, not assumed)', async () => {
  const upstream = await startMockUpstream({ autoSettingsApplied: false });
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url });
  const client = createTestClient(proxy.wsUrl);
  try {
    await client.open();
    client.ws.send(JSON.stringify({ type: 'ConfigureSettings', config: { listenModel: 'nova-3' } }));
    await upstream.waitFor((e) => e.kind === 'settings');
    client.ws.send(FRAME);
    await delay(300);
    assert.equal(upstream.events.filter((e) => e.kind === 'binary').length, 0);

    upstream.sendJson({ type: 'SettingsApplied' });
    await client.json((m) => m.type === 'SessionReady', 5000);
    client.ws.send(FRAME);
    await upstream.waitFor((e) => e.kind === 'binary', 5000);
    assert.equal(upstream.events.filter((e) => e.kind === 'binary').length, 1);
  } finally {
    await client.close().catch(() => {});
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }
});

test('malformed client JSON is dropped with a specific warning', async () => {
  await withProxy({}, async ({ client, events }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    client.ws.send('{not json');
    const warning = await client.json((m) => m.type === 'Warning' && m.code === 'MALFORMED_CLIENT_MESSAGE', 5000);
    assert.equal(warning.code, 'MALFORMED_CLIENT_MESSAGE');
    // Nothing unparsable may reach Deepgram.
    assert.equal(events.filter((e) => e.kind === 'other').length, 0);
  });
});

test('unexpected / informational server events are relayed unchanged', async () => {
  await withProxy({}, async ({ client, sendJson }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    const events = [
      { type: 'History', role: 'assistant', content: 'previous' },
      { type: 'AgentStartedSpeaking', total_latency: 0.4 },
      { type: 'LatencyReport', total_latency: '0.42' },
      { type: 'SomeFutureEvent', payload: 1 },
    ];
    for (const e of events) sendJson(e);

    for (const e of events) {
      const got = await client.json((m) => m.type === e.type, 5000);
      assert.deepEqual(got, e, `${e.type} must pass through untouched`);
    }
  });
});

test('reconnect creates a clean session: new Settings, no stale audio', async () => {
  const upstream = await startMockUpstream();
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url });
  const client = createTestClient(proxy.wsUrl);
  try {
    await connectAndReady(client, { listenModel: 'nova-3' });
    assert.equal(upstream.events.filter((e) => e.kind === 'settings').length, 1);

    // Kill the upstream: the proxy closes the browser socket.
    upstream.sockets.forEach((s: WebSocket) => s.terminate());
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (client.ws.readyState === WebSocket.CLOSED) {
          clearInterval(t);
          resolve();
        }
      }, 25);
    });

    // A brand new browser connection repeats the full handshake exactly once.
    const second = createTestClient(proxy.wsUrl);
    try {
      await connectAndReady(second, { listenModel: 'nova-3' });
      await delay(300);
      assert.equal(upstream.events.filter((e) => e.kind === 'settings').length, 2);
      assert.equal(second.records.filter((r) => r.binaryBytes).length, 0, 'no stale audio from the old session');
    } finally {
      await second.close().catch(() => {});
    }
  } finally {
    await client.close().catch(() => {});
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }
});

test('HTTP contract: 426 for the WebSocket path, JSON 404 for unknown API routes, no-store health', async () => {
  await withProxy({}, async ({ httpUrl }) => {
    const wsAsHttp = await fetch(`${httpUrl}/api/agent-proxy`);
    assert.equal(wsAsHttp.status, 426, 'a plain HTTP GET must not look like a successful API call');
    assert.equal(wsAsHttp.headers.get('upgrade'), 'websocket');
    const body = await wsAsHttp.json();
    assert.equal(body.error, 'UPGRADE_REQUIRED');

    const head = await fetch(`${httpUrl}/api/agent-proxy`, { method: 'HEAD' });
    assert.equal(head.status, 426);

    const missing = await fetch(`${httpUrl}/api/does-not-exist`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type') || '', /application\/json/);

    const health = await fetch(`${httpUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get('cache-control') || '', /no-store/);
    assert.equal(health.headers.get('x-agent-proxy'), 'deepgram-voice-agent');
  });
});

test('reproducible HTTP 202: an edge that accepts /api/health asynchronously then serves it', async () => {
  const upstream = await startMockUpstream();
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url });
  const backendPort = new URL(proxy.httpUrl).port;

  // Mock edge / ingress: first N requests are "accepted for async processing".
  let asyncAcceptsLeft = 1;
  const edge = http.createServer((req, res) => {
    if (req.url === '/api/health' && asyncAcceptsLeft > 0) {
      asyncAcceptsLeft -= 1;
      res.writeHead(202, { 'content-type': 'application/json', 'retry-after': '0' });
      res.end(JSON.stringify({ status: 'accepted', job_id: 'job-edge-1' }));
      return;
    }
    const proxied = http.request(
      { host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers },
      (backendRes) => {
        res.writeHead(backendRes.statusCode || 502, backendRes.headers);
        backendRes.pipe(res);
      }
    );
    proxied.on('error', () => {
      res.writeHead(502).end();
    });
    req.pipe(proxied);
  });

  await new Promise<void>((resolve) => edge.listen(0, '127.0.0.1', () => resolve()));
  const edgePort = (edge.address() as any).port;

  try {
    const first = await probeBackendHealth(`http://127.0.0.1:${edgePort}/api/health`);
    assert.equal(first.httpStatus, 202);
    assert.equal(first.state, 'starting', 'HTTP 202 must never be reported as offline');
    assert.equal(first.jobId, 'job-edge-1');

    // The client retries — the edge now passes the request through.
    const second = await probeBackendHealth(`http://127.0.0.1:${edgePort}/api/health`);
    assert.equal(second.httpStatus, 200);
    assert.equal(second.state, 'ready');
    assert.equal(second.health?.deepgramApiKeyConfigured, true);
  } finally {
    await new Promise<void>((resolve) => edge.close(() => resolve()));
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }
});
