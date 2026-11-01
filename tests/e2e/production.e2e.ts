/**
 * Production-mode end-to-end verification in a real browser.
 *
 * Serves the **built** client (`dist/` + `server.js`, i.e. what Render runs)
 * behind a local TLS-terminating proxy, so the browser loads the page over
 * `https://` and opens the agent socket over `wss://` — the same topology as
 * the Render deployment. A fake microphone plus a mock Voice Agent upstream
 * keep it hermetic; the Deepgram protocol itself is still exercised for real.
 *
 * Run: bun run test:e2e:prod   (builds first; needs Chromium)
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import puppeteer, { Browser, Page } from 'puppeteer-core';

import { delay, startMockUpstream, startProxy } from '../helpers/proxyHarness';
import { startTlsTerminator } from '../helpers/tlsTerminator';

const CHROME_PATH =
  process.env.CHROME_PATH ||
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find((p) => existsSync(p));

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitFor(fn: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await delay(100);
  }
  console.log(`  (timeout waiting for: ${label})`);
  return false;
}

const pageText = (page: Page) => page.evaluate(() => document.body.innerText);

async function main() {
  if (!CHROME_PATH) throw new Error('No Chromium binary found; set CHROME_PATH');
  assert.ok(existsSync('dist/index.html'), 'dist/index.html missing — run `npm run build` first');

  const upstream = await startMockUpstream();
  // Exactly the production command (node server.js), pointed at the mock.
  const proxy = await startProxy(
    { DEEPGRAM_AGENT_URL: upstream.url, NODE_ENV: 'production' },
    'server.js',
    { useNode: true }
  );
  const appPort = Number(new URL(proxy.httpUrl).port);
  const tls = await startTlsTerminator(appPort);

  let browser: Browser | null = null;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const httpResponses: { url: string; status: number; contentType: string }[] = [];
  const wsHandshakes: { url: string; status: number }[] = [];

  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
      acceptInsecureCerts: true, // our throwaway self-signed edge certificate
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--mute-audio',
      ],
    });
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(tls.url, ['microphone']);

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', (res) => {
      httpResponses.push({
        url: res.url(),
        status: res.status(),
        contentType: res.headers()['content-type'] || '',
      });
    });

    // CDP network events expose the actual WebSocket handshake status (101).
    const cdp = await page.createCDPSession();
    await cdp.send('Network.enable');
    // CDP splits the info: webSocketCreated carries the URL, the
    // handshake-response event carries the HTTP status (101). Join by requestId.
    const wsUrls = new Map<string, string>();
    cdp.on('Network.webSocketCreated', (ev: any) => {
      if (ev?.requestId) wsUrls.set(ev.requestId, String(ev.url || ''));
    });
    cdp.on('Network.webSocketHandshakeResponseReceived', (ev: any) => {
      const response = ev?.response ?? {};
      if (typeof response.status === 'number') {
        wsHandshakes.push({
          url: wsUrls.get(ev?.requestId) || String(response.url || ''),
          status: response.status,
        });
      }
    });

    // Real 202 handling: this flag makes the health endpoint answer like a
    // platform that accepted the probe asynchronously.
    let interceptHealth202 = true;
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (interceptHealth202 && req.url().endsWith('/api/health')) {
        req.respond({
          status: 202,
          headers: { 'content-type': 'application/json', 'retry-after': '1' },
          body: JSON.stringify({ job_id: 'warmup-1' }),
        });
        return;
      }
      req.continue();
    });

    // ------------------------------------------------------- 1. built app loads
    await page.goto(`${tls.url}/prototype-1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('h1, h2, button', { timeout: 20000 });
    check('built app renders over HTTPS', true, `${tls.url}/prototype-1`);

    const indexResponse = httpResponses.find((r) => r.url === `${tls.url}/prototype-1`);
    check(
      'index.html is served as HTML',
      Boolean(indexResponse && indexResponse.status === 200 && /text\/html/.test(indexResponse.contentType)),
      indexResponse ? `HTTP ${indexResponse.status}` : 'no response recorded'
    );

    const assetResponses = httpResponses.filter((r) => r.url.includes('/assets/'));
    check(
      'hashed client assets load (no 404s)',
      assetResponses.length >= 2 && assetResponses.every((r) => r.status === 200),
      assetResponses.map((r) => `${r.status} ${r.url.split('/').pop()}`).join(', ')
    );

    await delay(500);
    const text202 = await pageText(page);
    check(
      'HTTP 202 health is treated as "starting", never as offline',
      /starting|Checking|Starting/i.test(text202) && !/Backend Offline/i.test(text202),
      (text202.match(/Backend starting[^\n]*|Starting[^\n]*|Checking[^\n]*/i) || [''])[0]
    );
    // Stop faking 202: the app's own retry loop must recover to "ready".
    interceptHealth202 = false;
    const recovered = await waitFor(async () => (await pageText(page)).includes('Ready'), 20000, 'health ready');
    check('health probe recovers from 202 to ready without a reload', recovered);

    // ------------------------------------------------- 2. session over wss://
    await page.waitForSelector('button::-p-text(Start Voice Agent Session)', { timeout: 20000 });
    await page.click('button::-p-text(Start Voice Agent Session)');
    const ready = await waitFor(async () => (await pageText(page)).includes('Session Ready'), 20000, 'Session Ready');
    check('handshake reaches READY in the production bundle', ready);

    const wsOk = await waitFor(() => wsHandshakes.length > 0, 5000, 'CDP websocket handshake');
    const handshake = wsHandshakes[0];
    check(
      'browser WebSocket upgraded with status 101 over wss://',
      wsOk && handshake?.status === 101 && handshake.url.startsWith('wss://'),
      handshake ? `${handshake.status} ${handshake.url}` : 'no handshake captured'
    );

    const settings = upstream.events.find((e) => e.kind === 'settings');
    check(
      'proxy sent Settings upstream (settings initialization)',
      Boolean(settings),
      settings?.payload?.agent?.listen?.provider?.model ?? ''
    );

    // --------------------------------------------- 3. microphone audio uplink
    const gotAudio = await waitFor(
      async () => upstream.events.filter((e) => e.kind === 'binary').length >= 10,
      15000,
      '10 mic frames upstream'
    );
    const micFrames = upstream.events.filter((e) => e.kind === 'binary');
    check('microphone audio reaches the upstream through wss', gotAudio, `${micFrames.length} frames`);
    check(
      'uplink frames are 20 ms @ 24 kHz (960 B)',
      micFrames.length > 0 && micFrames.every((f) => f.bytes === 960),
      `${micFrames[0]?.bytes} B`
    );

    // -------------------------------------- 4. agent audio playback (downlink)
    for (let i = 0; i < 30; i++) {
      upstream.sendBinary(Buffer.alloc(960, 0x10));
      await delay(20);
    }
    const speaking = await waitFor(async () => (await pageText(page)).includes('Speaking'), 8000, 'playback state');
    check('agent PCM frames are played (not dropped)', speaking);

    // ---------------------------------- 5. ConversationText renders immediately
    const displayLatencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const marker = `Production latency probe ${i}`;
      const sentAt = Date.now();
      upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: marker });
      await page.waitForFunction((m) => document.body.innerText.includes(m), { polling: 'raf', timeout: 5000 }, marker);
      displayLatencies.push(Date.now() - sentAt);
    }
    const sorted = [...displayLatencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];
    check('ConversationText is painted within 250 ms (built bundle)', p50 <= 250, `p50=${p50} ms`);

    // ----------------------------------------------------- 6. reconnect flow
    const framesBeforeDrop = upstream.events.filter((e) => e.kind === 'binary').length;
    upstream.sockets.forEach((s) => s.terminate());
    const reconnecting = await waitFor(async () => (await pageText(page)).includes('Reconnecting'), 10000, 'reconnect banner');
    check('reconnect state is surfaced to the user', reconnecting);
    const restored = await waitFor(async () => (await pageText(page)).includes('Session Ready'), 25000, 'session restored');
    check('session re-establishes automatically after a socket drop', restored);
    const audioBack = await waitFor(
      async () => upstream.events.filter((e) => e.kind === 'binary').length > framesBeforeDrop + 10,
      15000,
      'audio after reconnect'
    );
    check('microphone audio flows again after reconnect (no reload)', audioBack);
    const handshakesAfterReconnect = wsHandshakes.length;
    check('reconnect opens a fresh 101 upgrade', handshakesAfterReconnect >= 2, `${handshakesAfterReconnect} handshakes`);

    // ------------------------------------------------ 7. mobile layout sanity
    await page.setViewport({ width: 375, height: 780 });
    await delay(400);
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      headerVisible: Boolean(document.querySelector('header')),
    }));
    check(
      'no horizontal overflow at 375 px wide',
      overflow.scrollW <= overflow.clientW + 1,
      `scrollWidth=${overflow.scrollW} clientWidth=${overflow.clientW}`
    );
    check('header remains available on mobile', overflow.headerVisible);
    await page.setViewport({ width: 1400, height: 1000 });

    // --------------------------------------------------------- 8. clean stop
    await page.click('button::-p-text(Stop Session & Clean Up)');
    await delay(800);
    check(
      'stop returns the UI to an idle state',
      (await pageText(page)).includes('Idle (Disconnected)')
    );

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const fatalConsole = consoleErrors.filter(
      (e) => !/favicon|fonts\.googleapis|Failed to load resource|ERR_CERT/i.test(e)
    );
    check('no unexpected console errors', fatalConsole.length === 0, fatalConsole.slice(0, 3).join(' | '));
  } finally {
    await browser?.close().catch(() => {});
    await tls.close().catch(() => {});
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} production browser checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
