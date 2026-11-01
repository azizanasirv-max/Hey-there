/**
 * Production-mode verification of the deployed artifact.
 *
 * Unlike tests/proxy.test.ts (which boots server.ts through tsx), this suite
 * runs `server.js` — the exact esbuild bundle that `npm start` runs on Render —
 * with `NODE_ENV=production`, and checks the things that only exist in a real
 * deployment:
 *
 *   * `PORT` binding and `/api/health` (the Render health check path)
 *   * static asset serving, cache headers and SPA deep links from dist/
 *   * API guard status codes (404 / 426) that must not fall through to the SPA
 *   * the WebSocket upgrade, settings handshake and audio relay through the
 *     bundle, over both ws:// and wss:// (via a local TLS terminator that
 *     mimics Render's edge)
 *
 * Requires a build: `npm run build` (the `test:prod` script does it first).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';

import { WebSocket } from 'ws';

import { ROOT, createTestClient, delay, startMockUpstream, startProxy } from './helpers/proxyHarness';
import { startTlsTerminator } from './helpers/tlsTerminator';

const BUNDLE = path.join(ROOT, 'server.js');

function requireBundle() {
  assert.ok(existsSync(BUNDLE), 'server.js bundle missing — run `npm run build` before `npm run test:prod`');
  assert.ok(
    existsSync(path.join(ROOT, 'dist', 'index.html')),
    'dist/index.html missing — run `npm run build` before `npm run test:prod`'
  );
}

/** Boot the built bundle exactly like Render: plain node + NODE_ENV=production. */
async function startProd(env: Record<string, string> = {}) {
  requireBundle();
  return startProxy({ ...env, NODE_ENV: 'production' }, 'server.js', { useNode: true });
}

test('production bundle serves /api/health with the documented contract', async () => {
  const proxy = await startProd();
  try {
    const res = await fetch(`${proxy.httpUrl}/api/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    assert.equal(res.headers.get('x-agent-proxy'), 'deepgram-voice-agent');
    assert.equal(res.headers.get('x-powered-by'), null, 'x-powered-by must be disabled');

    const body = (await res.json()) as Record<string, any>;
    assert.equal(body.status, 'ok');
    assert.equal(body.deepgramApiKeyConfigured, true);
    assert.equal(body.environment, 'production');
    assert.equal(body.serving, 'static-dist', 'production must serve built assets, not Vite middleware');
    assert.equal(body.webSocketPath, '/api/agent-proxy');
    assert.equal(typeof body.nodeVersion, 'string');
    assert.equal(typeof body.uptime, 'number');
    // The key itself must never be returned — only a masked hint.
    assert.ok(!JSON.stringify(body).includes('test-key-not-real'), 'health must not leak the API key');

    const head = await fetch(`${proxy.httpUrl}/api/health`, { method: 'HEAD' });
    assert.equal(head.status, 200, 'HEAD probes (some platforms) must work');
  } finally {
    await proxy.stop();
  }
});

test('production health reports a missing API key instead of crashing', async () => {
  const upstream = await startMockUpstream();
  const proxy = await startProd({ DEEPGRAM_API_KEY: '', DEEPGRAM_AGENT_URL: upstream.url });
  try {
    const body = (await (await fetch(`${proxy.httpUrl}/api/health`)).json()) as Record<string, any>;
    assert.equal(body.status, 'ok');
    assert.equal(body.deepgramApiKeyConfigured, false);
    assert.equal(body.maskedKey, null);
  } finally {
    await proxy.stop();
    await upstream.close();
  }
});

test('built client, assets and SPA deep links are served from dist/', async () => {
  const proxy = await startProd();
  try {
    const index = await fetch(`${proxy.httpUrl}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') || '', /text\/html/);
    assert.match(index.headers.get('cache-control') || '', /no-store/, 'index.html must never be cached');
    const html = await index.text();
    assert.match(html, /<div id="root">/);
    assert.match(html, /<noscript>/, 'the built page keeps the no-JS fallback');

    // The hashed bundle referenced by index.html must actually exist.
    const assetMatch = html.match(/src="(\/assets\/[^"]+\.js)"/);
    assert.ok(assetMatch, 'index.html must reference a hashed JS asset');
    const assetPath = assetMatch![1];
    const asset = await fetch(`${proxy.httpUrl}${assetPath}`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') || '', /javascript/);
    assert.match(asset.headers.get('cache-control') || '', /immutable/, 'hashed assets must be immutable-cacheable');
    const js = await asset.text();
    assert.ok(js.length > 50_000, 'the client bundle must be non-trivial');
    assert.ok(!js.includes('test-key-not-real'), 'the API key must never reach the client bundle');

    const cssMatch = html.match(/href="(\/assets\/[^"]+\.css)"/);
    assert.ok(cssMatch, 'index.html must reference a hashed CSS asset');
    assert.equal((await fetch(`${proxy.httpUrl}${cssMatch![1]}`)).status, 200);

    for (const route of ['/prototype-1', '/architecture', '/deep/link/that/does/not/exist']) {
      const res = await fetch(`${proxy.httpUrl}${route}`);
      assert.equal(res.status, 200, `${route} must return the SPA shell`);
      assert.match(res.headers.get('content-type') || '', /text\/html/);
    }

    const missingAsset = await fetch(`${proxy.httpUrl}/assets/does-not-exist.js`);
    assert.equal(missingAsset.status, 404, 'a missing asset must 404, never fall back to index.html');
  } finally {
    await proxy.stop();
  }
});

test('API routes never fall through to the SPA', async () => {
  const proxy = await startProd();
  try {
    const unknown = await fetch(`${proxy.httpUrl}/api/does-not-exist`);
    assert.equal(unknown.status, 404);
    assert.match(unknown.headers.get('content-type') || '', /application\/json/);
    assert.equal(((await unknown.json()) as any).error, 'NOT_FOUND');

    const plainHttpUpgrade = await fetch(`${proxy.httpUrl}/api/agent-proxy`);
    assert.equal(plainHttpUpgrade.status, 426, 'a plain HTTP GET on the WS path is 426 Upgrade Required');
    assert.equal(plainHttpUpgrade.headers.get('upgrade'), 'websocket');

    const wrongMethod = await fetch(`${proxy.httpUrl}/api/health`, { method: 'POST' });
    assert.equal(wrongMethod.status, 404, 'unknown API method/path combinations stay JSON 404s');
  } finally {
    await proxy.stop();
  }
});

test('production WebSocket upgrade completes the settings handshake and relays audio', async () => {
  const upstream = await startMockUpstream();
  const proxy = await startProd({ DEEPGRAM_AGENT_URL: upstream.url });
  const client = createTestClient(proxy.wsUrl);
  try {
    await client.open();
    assert.equal(client.ws.readyState, WebSocket.OPEN, 'the browser socket must be open (HTTP 101)');

    client.ws.send(
      JSON.stringify({
        type: 'ConfigureSettings',
        config: {
          listenModel: 'flux-general-en',
          thinkModel: 'gpt-4o-mini',
          speakModel: 'flux-kit-en',
        },
      })
    );
    await client.json((m) => m.type === 'SessionReady', 8000);

    const settings = upstream.events.find((e) => e.kind === 'settings');
    assert.ok(settings, 'the proxy must send exactly one Settings message upstream');
    assert.equal(settings!.payload.type, 'Settings');
    assert.equal(settings!.payload.agent.listen.provider.model, 'flux-general-en');
    assert.equal(settings!.payload.agent.speak.provider.model, 'flux-kit-en');

    // Settings are only sent once (no duplicate after SettingsApplied).
    await delay(300);
    assert.equal(upstream.events.filter((e) => e.kind === 'settings').length, 1);

    // Uplink: microphone frames reach the upstream untouched.
    client.ws.send(Buffer.alloc(960, 0x2a), { binary: true });
    const uplink = await upstream.waitFor((e) => e.kind === 'binary');
    assert.equal(uplink.bytes, 960);

    // Downlink: agent PCM is forwarded to the browser instead of being dropped.
    upstream.sendBinary(Buffer.alloc(960, 0x11));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !client.records.some((r) => r.binaryBytes === 960)) await delay(20);
    assert.ok(client.records.some((r) => r.binaryBytes === 960), 'agent audio must be relayed to the client');
  } finally {
    await client.close().catch(() => {});
    await proxy.stop();
    await upstream.close();
  }
});

test('unknown upgrade paths are rejected, not silently accepted', async () => {
  const proxy = await startProd();
  try {
    const status = await new Promise<number | null>((resolve) => {
      const ws = new WebSocket(proxy.wsUrl.replace('/api/agent-proxy', '/api/not-the-proxy'));
      ws.on('unexpected-response', (_req, res) => {
        resolve(res.statusCode ?? null);
        ws.terminate();
      });
      ws.on('open', () => {
        resolve(101);
        ws.close();
      });
      ws.on('error', () => resolve(null));
      setTimeout(() => resolve(null), 4000);
    });
    assert.notEqual(status, 101, 'an unknown path must never complete a WebSocket upgrade');
  } finally {
    await proxy.stop();
  }
});

test('wss:// upgrades work behind a TLS-terminating proxy (Render topology)', async () => {
  const upstream = await startMockUpstream();
  const proxy = await startProd({ DEEPGRAM_AGENT_URL: upstream.url });
  const tls = await startTlsTerminator(Number(new URL(proxy.httpUrl).port));
  try {
    // HTTPS health through the TLS edge, with the forwarded headers Render sets.
    const health = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      https
        .get(`${tls.url}/api/health`, { rejectUnauthorized: false }, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }));
        })
        .on('error', reject);
    });
    assert.equal(health.status, 200);
    assert.equal(health.body.serving, 'static-dist');

    // The browser-facing page is HTTPS, so the app must be reachable over wss://.
    const wss = new WebSocket(tls.wssUrl(), { rejectUnauthorized: false });
    const records: any[] = [];
    wss.on('message', (data: any) => {
      try {
        records.push(JSON.parse(data.toString('utf-8')));
      } catch {
        /* binary */
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        wss.on('open', () => resolve());
        wss.on('error', reject);
        setTimeout(() => reject(new Error('wss handshake timed out')), 8000);
      });
      assert.equal(wss.readyState, WebSocket.OPEN, 'wss:// upgrade through the TLS edge must succeed');

      wss.send(JSON.stringify({ type: 'ConfigureSettings', config: { listenModel: 'nova-3' } }));
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !records.some((m) => m.type === 'SessionReady')) await delay(20);
      assert.ok(
        records.some((m) => m.type === 'SessionReady'),
        'the full Welcome → Settings → SettingsApplied handshake must survive the TLS proxy'
      );

      wss.send(Buffer.alloc(960, 0x33), { binary: true });
      const uplink = await upstream.waitFor((e) => e.kind === 'binary');
      assert.equal(uplink.bytes, 960, 'audio must traverse the TLS-terminating proxy');
    } finally {
      wss.close();
    }
  } finally {
    await tls.close();
    await proxy.stop();
    await upstream.close();
  }
});
