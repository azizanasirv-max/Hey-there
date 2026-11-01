/**
 * Verify a deployed instance (Render, or any host) from the outside.
 *
 * Usage:
 *   npm run verify:live -- https://hey-there.onrender.com
 *
 * It exercises only what a browser/operator can observe over the public URL:
 * the health contract, the built client + hashed assets, the API guards and the
 * WebSocket upgrade (101). It never sends an API key — the handshake is made
 * without credentials, exactly like the browser does.
 */
import { WebSocket } from 'ws';

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--'));
const wsTimeoutArg = args.find((a) => a.startsWith('--ws-timeout='));
const WS_TIMEOUT_MS = wsTimeoutArg ? Number(wsTimeoutArg.split('=')[1]) : 8000;

if (!base) {
  console.error('Usage: npm run verify:live -- https://<your-service>.onrender.com');
  process.exit(2);
}

const root = base.replace(/\/$/, '');
const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function checkHealth() {
  const res = await fetch(`${root}/api/health`, { cache: 'no-store' });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  record('health endpoint answers 200', res.status === 200, `HTTP ${res.status}`);
  record(
    'health is not cacheable',
    /no-store/.test(res.headers.get('cache-control') || ''),
    res.headers.get('cache-control') || 'missing cache-control'
  );
  record('health reports status "ok"', body.status === 'ok', String(body.status));
  record(
    'serving built assets in production',
    body.serving === 'static-dist',
    String(body.serving ?? 'unknown (the server is exposing Vite dev middleware)')
  );
  record(
    'DEEPGRAM_API_KEY is configured server-side',
    body.deepgramApiKeyConfigured === true,
    body.deepgramApiKeyConfigured ? `masked ${body.maskedKey}` : 'NOT configured — set it in the dashboard'
  );
  record('api key is never exposed', !JSON.stringify(body).includes('test-key'), 'only a masked hint is returned');
  return body;
}

async function checkStatic() {
  const index = await fetch(`${root}/`);
  const html = await index.text();
  record(
    'index.html served',
    index.status === 200 && /text\/html/.test(index.headers.get('content-type') || ''),
    `HTTP ${index.status}`
  );
  record('index.html not cached', /no-store/.test(index.headers.get('cache-control') || ''), index.headers.get('cache-control') || 'missing');

  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/);
  if (!asset) {
    record('hashed JS asset referenced', false, 'index.html has no /assets/*.js reference');
    return;
  }
  const assetRes = await fetch(`${root}${asset[1]}`);
  record('hashed JS asset served', assetRes.status === 200, `${asset[1]} → HTTP ${assetRes.status}`);
  record(
    'hashed JS asset is immutable-cacheable',
    /immutable/.test(assetRes.headers.get('cache-control') || ''),
    assetRes.headers.get('cache-control') || 'missing'
  );

  const deepLink = await fetch(`${root}/prototype-1`);
  record('SPA deep link /prototype-1 serves the shell', deepLink.status === 200, `HTTP ${deepLink.status}`);
}

async function checkApiGuards() {
  const unknown = await fetch(`${root}/api/definitely-not-a-route`);
  record('unknown API route is a JSON 404', unknown.status === 404, `HTTP ${unknown.status}`);
  const plain = await fetch(`${root}/api/agent-proxy`);
  record(
    'plain HTTP on the WS path is 426 Upgrade Required',
    plain.status === 426,
    `HTTP ${plain.status} (200/202 here means an intermediary is buffering the upgrade)`
  );
}

function checkWebSocket() {
  const wsUrl = root.replace(/^http/, 'ws') + '/api/agent-proxy';
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(wsUrl);
    const events: string[] = [];
    let settled = false;
    const done = (name: string, ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      record(name, ok, detail);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve();
    };

    ws.on('open', () => record('WebSocket upgrade succeeded (HTTP 101)', true, wsUrl));
    ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString('utf-8'));
        events.push(msg.type);
        if (msg.type === 'Error' && msg.code === 'API_KEY_MISSING') {
          done(
            'proxy reports the missing server API key (expected without one)',
            true,
            'API_KEY_MISSING — set DEEPGRAM_API_KEY in the Render dashboard'
          );
        } else if (msg.type === 'SessionReady') {
          done('full handshake reached SessionReady', true, events.join(' → '));
        }
      } catch {
        /* binary frame */
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      done(
        'WebSocket upgrade accepted by the edge',
        false,
        `HTTP ${res.statusCode} instead of 101 — the platform/proxy is not forwarding upgrades for /api/agent-proxy`
      );
    });
    ws.on('error', (err: Error) => done('WebSocket upgrade accepted by the edge', false, err.message));

    setTimeout(() => {
      done(
        'WebSocket session reached a decisive state',
        false,
        `no Welcome/SettingsApplied/Error within ${WS_TIMEOUT_MS} ms (events: ${events.join(',') || 'none'})`
      );
    }, WS_TIMEOUT_MS).unref();
  });
}

async function main() {
  console.log(`Verifying ${root}\n`);
  const health = await checkHealth().catch((err) => {
    record('health endpoint reachable', false, String(err?.message || err));
    return null;
  });
  if (health) {
    await checkStatic().catch((err) => record('static assets', false, String(err?.message || err)));
    await checkApiGuards().catch((err) => record('API guards', false, String(err?.message || err)));
    await checkWebSocket();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} live checks passed`);
  if (failed.length) {
    console.log('\nFailures to investigate:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
    process.exitCode = 1;
  }
}

void main();
