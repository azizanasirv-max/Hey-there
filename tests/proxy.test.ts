import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import {
  connectAndReady,
  createTestClient,
  delay,
  startMockUpstream,
  startProxy,
  TestClient,
} from './helpers/proxyHarness';

const FRAME_BYTES = 960; // 20 ms of 24 kHz linear16 mono

function pcmFrame(marker = 0): Buffer {
  const buf = Buffer.alloc(FRAME_BYTES);
  for (let i = 0; i < FRAME_BYTES; i += 2) buf.writeInt16LE(marker + i, i);
  return buf;
}

/** Boots a mock upstream + the real proxy, and connects one client. */
async function withSession(
  fn: (ctx: {
    upstream: Awaited<ReturnType<typeof startMockUpstream>>;
    client: TestClient;
    proxy: Awaited<ReturnType<typeof startProxy>>;
  }) => Promise<void>,
  config?: Record<string, unknown>
) {
  const upstream = await startMockUpstream();
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url });
  const client = createTestClient(proxy.wsUrl);
  try {
    await client.open();
    if (config) client.ws.send(JSON.stringify({ type: 'ConfigureSettings', config }));
    await fn({ upstream, client, proxy });
  } finally {
    await client.close().catch(() => {});
    await delay(100);
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }
}

test('handshake: Welcome -> Settings -> SettingsApplied -> SessionReady', async () => {
  await withSession(async ({ upstream, client }) => {
    const ready = await client.json((m) => m.type === 'SessionReady', 10000);
    assert.equal(ready.type, 'SessionReady');

    const settings = await upstream.waitFor((e) => e.kind === 'settings');
    assert.equal(settings.payload.type, 'Settings');
    assert.ok(upstream.events.some((e) => e.kind === 'connection'));
    // The proxy must not forward the client-only ConfigureSettings message.
    assert.equal(
      upstream.events.filter((e) => e.kind === 'other' && e.payload?.type === 'ConfigureSettings').length,
      0
    );
  });
});

test('settings gating: the browser config wins the race against Welcome', async () => {
  await withSession(async ({ upstream, client }) => {
    const configSentAt = Date.now();
    const settings = await upstream.waitFor((e) => e.kind === 'settings', 8000);
    assert.ok(
      settings.at >= configSentAt,
      'Settings must not be sent before the browser configuration arrives'
    );
    assert.equal(settings.payload.agent.listen.provider.model, 'nova-2');
    assert.equal(settings.payload.agent.think.provider.model, 'gpt-4o');
    assert.equal(settings.payload.agent.speak.provider.model, 'aura-luna-en');
    assert.equal(settings.payload.audio.input.sample_rate, 24000);
    await client.json((m) => m.type === 'SessionReady', 8000);
  }, {
    listenModel: 'nova-2',
    thinkModel: 'gpt-4o',
    speakModel: 'aura-luna-en',
    sampleRate: 24000,
    encoding: 'linear16',
    listenProvider: 'deepgram',
    thinkProvider: 'open_ai',
    speakProvider: 'deepgram',
    speakVersion: 'v2',
  });
});

test('agent (TTS) audio is forwarded to the browser byte-for-byte', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    const frame = pcmFrame(7);
    upstream.sendBinary(frame);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !client.records.some((r) => r.binaryBytes)) await delay(20);

    const audio = client.records.find((r) => r.binaryBytes);
    assert.ok(audio, 'client must receive agent audio as a binary frame');
    assert.equal(audio!.binaryBytes, FRAME_BYTES);
    assert.deepEqual(Buffer.from(audio!.binary!), frame);
  });
});

test('microphone audio is forwarded upstream once settings are applied', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    for (let i = 0; i < 10; i++) client.ws.send(pcmFrame(i));

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && upstream.events.filter((e) => e.kind === 'binary').length < 10) {
      await delay(20);
    }
    const frames = upstream.events.filter((e) => e.kind === 'binary');
    assert.equal(frames.length, 10);
    assert.ok(frames.every((f) => f.bytes === FRAME_BYTES));
  });
});

test('agent audio telemetry is aggregated (no per-frame JSON storm)', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    const before = client.records.length;

    // 50 frames/s for ~1.2 s = ~60 audio frames (the old proxy emitted 60 JSON msgs).
    const frame = pcmFrame(1);
    for (let i = 0; i < 60; i++) {
      upstream.sendBinary(frame);
      await delay(20);
    }
    await delay(1200);

    const audioFrames = client.records.filter((r) => r.binaryBytes).length;
    const statsMessages = client.countJson((m) => m.type === 'AgentAudioStats');
    const legacyMessages = client.countJson((m) => m.type === 'AudioDiscardedTelemetry');

    assert.equal(audioFrames, 60, 'every agent audio frame must reach the browser');
    assert.equal(legacyMessages, 0, 'per-frame discard telemetry must be gone');
    assert.ok(statsMessages <= 4, `expected <=4 aggregated stats messages, got ${statsMessages}`);
    assert.ok(client.records.length - before < 60 + 10, 'JSON traffic must not scale with audio frames');
  });
});

test('proxy sends KeepAlive upstream when the uplink is idle (prevents CLIENT_MESSAGE_TIMEOUT)', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    // A single frame arms the idle timer, then the browser goes silent (muted).
    client.ws.send(pcmFrame(1));
    await upstream.waitFor((e) => e.kind === 'binary', 4000);

    const keepAlive = await upstream.waitFor((e) => e.kind === 'keepalive', 6000);
    assert.ok(keepAlive, 'proxy must keep the upstream session alive while the mic is silent');
  });
});

test('Deepgram Error is forwarded with its code and the session is closed', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    upstream.sendJson({ type: 'Error', code: 'INVALID_SETTINGS', description: 'bad settings' });

    const err = await client.json((m) => m.type === 'Error', 5000);
    assert.equal(err.code, 'INVALID_SETTINGS');
    assert.equal(err.description, 'bad settings');

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && client.ws.readyState !== WebSocket.CLOSED) await delay(20);
    assert.equal(client.ws.readyState, WebSocket.CLOSED, 'proxy closes the browser socket after a fatal error');
  });
});

test('Warning events are forwarded without ending the session', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    upstream.sendJson({ type: 'Warning', code: 'MAXIMUM_SESSION_LENGTH_APPROACHING', description: 'wrap up' });

    const warning = await client.json((m) => m.type === 'Warning', 5000);
    assert.equal(warning.code, 'MAXIMUM_SESSION_LENGTH_APPROACHING');
    assert.equal(client.ws.readyState, WebSocket.OPEN, 'warnings must not tear the session down');

    // Audio still flows afterwards.
    upstream.sendBinary(pcmFrame(3));
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !client.records.some((r) => r.binaryBytes)) await delay(20);
    assert.ok(client.records.some((r) => r.binaryBytes));
  });
});

test('browser disconnect releases the upstream (paid) socket', async () => {
  await withSession(async ({ upstream, client, proxy }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    await client.close();
    const closed = await upstream.waitFor((e) => e.kind === 'close', 8000);
    assert.ok(closed);
    assert.ok(proxy.httpUrl.includes('127.0.0.1'));
  });
});

/** Measures real proxy hop latency: client send -> upstream receive, and back. */
test('proxy hop latency stays sub-5 ms (measured)', async () => {
  await withSession(async ({ upstream, client }) => {
    await connectAndReady(client, { listenModel: 'nova-3' });
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const before = upstream.events.filter((e) => e.kind === 'binary').length;
      const sentAt = Date.now();
      client.ws.send(pcmFrame(i));
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline && upstream.events.filter((e) => e.kind === 'binary').length === before) {
        await delay(1);
      }
      const frames = upstream.events.filter((e) => e.kind === 'binary');
      const received = frames[frames.length - 1];
      if (received && frames.length > before) samples.push(received.at - sentAt);
      await delay(5);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? 0;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? 0;
    console.log(`[latency] uplink proxy hop p50=${p50} ms p95=${p95} ms (n=${samples.length})`);
    assert.ok(samples.length >= 30, 'collected enough hop samples');
    assert.ok(p95 <= 5, `p95 proxy hop ${p95} ms should stay under 5 ms`);
  });
});
