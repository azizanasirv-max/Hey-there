import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRetryAfter, probeAgentUpgrade, probeBackendHealth } from '../src/utils/http';

type FakeInit = { status: number; body?: string; headers?: Record<string, string> };

/** Install a fake global fetch for the duration of a test. */
async function withFetch(
  responder: (url: string, init?: RequestInit) => FakeInit | Promise<FakeInit>,
  fn: () => Promise<void>
) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const spec = await responder(String(url), init);
    return new Response(spec.body ?? null, { status: spec.status, headers: spec.headers });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return calls;
}

const healthBody = JSON.stringify({
  status: 'ok',
  deepgramApiKeyConfigured: true,
  maskedKey: 'abcd...wxyz',
  timestamp: new Date().toISOString(),
  uptime: 12,
  environment: 'production',
});

test('200 with the documented payload is the only "ready" state', async () => {
  await withFetch(() => ({ status: 200, body: healthBody }), async () => {
    const r = await probeBackendHealth();
    assert.equal(r.state, 'ready');
    assert.equal(r.httpStatus, 200);
    assert.equal(r.health?.deepgramApiKeyConfigured, true);
  });
});

test('202 Accepted is success-in-progress, not a failure', async () => {
  await withFetch(
    () => ({
      status: 202,
      body: JSON.stringify({ status: 'accepted', job_id: 'job-42' }),
      headers: { 'retry-after': '2' },
    }),
    async () => {
      const r = await probeBackendHealth();
      assert.equal(r.state, 'starting');
      assert.equal(r.httpStatus, 202);
      assert.equal(r.jobId, 'job-42', 'job id from the 202 body must be surfaced');
      assert.equal(r.retryAfterMs, 2000, 'Retry-After header is honoured');
      assert.match(r.message, /202/);
    }
  );
});

test('202 with an empty body still yields a retry hint (no crash, no offline state)', async () => {
  await withFetch(() => ({ status: 202 }), async () => {
    const r = await probeBackendHealth();
    assert.equal(r.state, 'starting');
    assert.equal(r.health, null);
    assert.ok((r.retryAfterMs ?? 0) > 0, 'a default retry delay is provided');
  });
});

test('204 No Content is treated as starting, not ready', async () => {
  await withFetch(() => ({ status: 204 }), async () => {
    const r = await probeBackendHealth();
    assert.equal(r.state, 'starting');
    assert.equal(r.httpStatus, 204);
  });
});

test('200 with an HTML body (SPA fallback / proxy) is an explicit routing error', async () => {
  await withFetch(() => ({ status: 200, body: '<!doctype html><html></html>', headers: { 'content-type': 'text/html' } }), async () => {
    const r = await probeBackendHealth();
    assert.equal(r.state, 'error');
    assert.match(r.message, /not the health payload/);
  });
});

test('5xx surfaces the status and the server message', async () => {
  await withFetch(
    () => ({ status: 503, body: JSON.stringify({ message: 'container starting' }) }),
    async () => {
      const r = await probeBackendHealth();
      assert.equal(r.state, 'unavailable');
      assert.equal(r.httpStatus, 503);
      assert.match(r.message, /503/);
      assert.match(r.message, /container starting/);
    }
  );
});

test('network failure is reported as an error, not as an HTTP status', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  try {
    const r = await probeBackendHealth();
    assert.equal(r.state, 'error');
    assert.equal(r.httpStatus, null);
    assert.match(r.message, /unreachable/i);
  } finally {
    globalThis.fetch = original;
  }
});

test('the health probe is sent with no-store caching', async () => {
  await withFetch(
    () => ({ status: 200, body: healthBody }),
    async () => {
      const calls = await withFetch(() => ({ status: 200, body: healthBody }), async () => {
        await probeBackendHealth();
      });
      assert.equal((calls[0].init as RequestInit)?.cache, 'no-store');
    }
  );
});

test('parseRetryAfter understands seconds and HTTP dates', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('not-a-date'), null);
  const future = new Date(Date.now() + 5000).toUTCString();
  const ms = parseRetryAfter(future);
  assert.ok(ms !== null && ms > 3000 && ms <= 6000, `date parse gave ${ms}`);
});

test('WebSocket upgrade probe names a 202 answer instead of a generic WS error', async () => {
  await withFetch(
    () => ({ status: 202, body: JSON.stringify({ job_id: 'async-1' }) }),
    async () => {
      const r = await probeAgentUpgrade('wss://example.test/api/agent-proxy');
      assert.equal(r.ok, false);
      assert.equal(r.httpStatus, 202);
      assert.match(r.message, /202/);
      assert.match(r.message, /101/);
    }
  );
});

test('WebSocket upgrade probe accepts the real upgrade-required/fallback answers', async () => {
  for (const status of [426, 400, 200]) {
    await withFetch(
      () => ({ status }),
      async () => {
        const r = await probeAgentUpgrade('ws://example.test/api/agent-proxy');
        assert.equal(r.ok, true, `status ${status}`);
        assert.equal(r.httpStatus, status);
      }
    );
  }

  await withFetch(
    () => ({ status: 404 }),
    async () => {
      const r = await probeAgentUpgrade('ws://example.test/api/agent-proxy');
      assert.equal(r.ok, false);
      assert.match(r.message, /not routed/);
    }
  );
});
