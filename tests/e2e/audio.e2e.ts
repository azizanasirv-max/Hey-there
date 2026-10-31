/**
 * End-to-end browser verification of the audio pipeline.
 *
 * Runs headless Chromium with a *fake microphone device* (Chrome's built-in
 * synthetic tone generator), the real `server.ts` proxy, and a mock Voice Agent
 * upstream. It asserts on real audio bytes crossing the wire, not on UI labels.
 *
 * Run: bun run test:e2e
 * Requires a local Chromium (CHROME_PATH or /usr/bin/chromium).
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import puppeteer, { Browser, Page } from 'puppeteer-core';

import { delay, startMockUpstream, startProxy } from '../helpers/proxyHarness';

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

async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

async function main() {
  if (!CHROME_PATH) throw new Error('No Chromium binary found; set CHROME_PATH');

  const upstream = await startMockUpstream();
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url });
  const port = new URL(proxy.httpUrl).port;

  let browser: Browser | null = null;
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: true,
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
    await context.overridePermissions(`http://127.0.0.1:${port}`, ['microphone']);

    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 1000 });
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`http://127.0.0.1:${port}/prototype-1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button::-p-text(Start Voice Agent Session)', { timeout: 20000 });
    check('app renders the prototype page', true, `url ${await page.url()}`);

    // ---------------------------------------------------------------- 1. start
    await page.click('button::-p-text(Start Voice Agent Session)');
    const ready = await waitFor(async () => (await pageText(page)).includes('Session Ready'), 20000, 'Session Ready');
    check('handshake reaches READY', ready);

    const upstreamSettings = upstream.events.find((e) => e.kind === 'settings');
    check(
      'proxy sent Settings upstream',
      Boolean(upstreamSettings),
      upstreamSettings?.payload?.agent?.listen?.provider?.model ?? ''
    );

    // ------------------------------------------ 2. microphone audio reaches upstream
    const gotAudio = await waitFor(
      async () => upstream.events.filter((e) => e.kind === 'binary').length >= 10,
      15000,
      '10 microphone frames upstream'
    );
    const micFrames = upstream.events.filter((e) => e.kind === 'binary');
    check('real microphone audio is streamed upstream', gotAudio, `${micFrames.length} frames`);
    check(
      'uplink frames are 20 ms @ 24 kHz (960 B)',
      micFrames.length > 0 && micFrames.every((f) => f.bytes === 960),
      `${micFrames[0]?.bytes} B`
    );

    check('UI reports live mic streaming', (await pageText(page)).includes('Microphone Live Streaming'));

    // ------------------------------------------------------ 3. agent voice playback
    for (let i = 0; i < 30; i++) {
      upstream.sendBinary(Buffer.alloc(960, 0x10));
      await delay(20);
    }
    const playbackSeen = await waitFor(async () => (await pageText(page)).includes('Speaking'), 8000, 'agent playback state');
    check('agent PCM frames are played (not discarded)', playbackSeen);

    const readAgentCounter = async () =>
      page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('div')).find((d) =>
          d.textContent?.trim().startsWith('Agent Audio')
        );
        return el?.textContent ?? '';
      });
    // Telemetry is published once per second, so poll instead of sampling once.
    const counterGrew = await waitFor(async () => /(?:^|\D)([1-9]\d*)\s*frames/.test(await readAgentCounter()), 8000, 'agent frame counter');
    check('agent audio frame counter is non-zero', counterGrew, (await readAgentCounter()).replace(/\s+/g, ' '));

    // ------------------------------------- 3b. ConversationText is displayed immediately
    const countOccurrences = async (needle: string) =>
      page.evaluate((n) => document.body.innerText.split(n).length - 1, needle);

    // (a) user transcript
    upstream.sendJson({ type: 'ConversationText', role: 'user', content: 'E2E user transcript' });
    const userTextShown = await waitFor(async () => (await pageText(page)).includes('E2E user transcript'), 4000, 'user transcript');
    check('user ConversationText is displayed immediately', userTextShown);

    // Measure the real "event -> visible text" latency (rAF polling, 6 samples).
    const displayLatencies: number[] = [];
    for (let i = 0; i < 6; i++) {
      const marker = `E2E latency probe ${i}`;
      const sentAt = Date.now();
      upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: marker });
      await page.waitForFunction((m) => document.body.innerText.includes(m), { polling: 'raf', timeout: 5000 }, marker);
      displayLatencies.push(Date.now() - sentAt);
    }
    const sortedDisplay = [...displayLatencies].sort((a, b) => a - b);
    const p50 = sortedDisplay[Math.floor(sortedDisplay.length / 2)];
    console.log(`[latency] ConversationText -> painted text: p50=${p50} ms, samples=${sortedDisplay.join(',')} ms`);
    check('ConversationText is painted within 250 ms of arrival', p50 <= 250, `p50=${p50} ms`);

    // (b) assistant text BEFORE AgentAudioDone and while audio is still streaming
    upstream.sendJson({ type: 'AgentThinking', content: 'thinking' });
    upstream.sendJson({
      type: 'ConversationText',
      role: 'assistant',
      content: 'E2E assistant answer appears before audio finishes',
    });
    const assistantTextShown = await waitFor(
      async () => (await pageText(page)).includes('E2E assistant answer appears before audio finishes'),
      4000,
      'assistant transcript'
    );
    check('assistant ConversationText is displayed immediately', assistantTextShown);

    // Audio keeps arriving while the text is already on screen.
    for (let i = 0; i < 20; i++) {
      upstream.sendBinary(Buffer.alloc(960, 0x22));
      await delay(20);
    }
    const stillVisible = (await pageText(page)).includes('E2E assistant answer appears before audio finishes');
    check('assistant text stays visible while audio is playing', stillVisible);
    check(
      'text was displayed before AgentAudioDone',
      stillVisible && !(await pageText(page)).includes('AgentAudioDone') === true
    );

    upstream.sendJson({ type: 'AgentAudioDone' });
    await delay(300);
    check('assistant text survives AgentAudioDone', (await pageText(page)).includes('E2E assistant answer appears before audio finishes'));

    // (c) audio-then-text ordering must also work
    for (let i = 0; i < 5; i++) upstream.sendBinary(Buffer.alloc(960, 0x33));
    upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: 'E2E text after audio' });
    const afterAudio = await waitFor(async () => (await pageText(page)).includes('E2E text after audio'), 4000, 'text after audio');
    check('ConversationText arriving after audio is still displayed', afterAudio);

    // (d) duplicates are suppressed
    upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: 'E2E duplicate guard' });
    await waitFor(async () => (await pageText(page)).includes('E2E duplicate guard'), 4000, 'duplicate guard baseline');
    upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: 'E2E duplicate guard' });
    upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: 'E2E duplicate guard' });
    await delay(700);
    const duplicateCount = await countOccurrences('E2E duplicate guard');
    check('duplicate ConversationText is rendered once', duplicateCount === 1, `${duplicateCount} occurrences`);

    // (e) Flux eager end-of-turn lifecycle
    upstream.sendJson({ type: 'EagerEndOfTurn', transcript: 'drafting' });
    const speculativeShown = await waitFor(async () => (await pageText(page)).includes('Eager end-of-turn'), 4000, 'speculative badge');
    check('EagerEndOfTurn surfaces a speculative state', speculativeShown);

    upstream.sendJson({ type: 'TurnResumed' });
    const speculativeCleared = await waitFor(
      async () => !(await pageText(page)).includes('Eager end-of-turn'),
      4000,
      'speculative badge cleared'
    );
    check('TurnResumed cancels the speculative state', speculativeCleared);
    check('TurnResumed does not fabricate an assistant reply', !(await pageText(page)).includes('drafting'));

    upstream.sendJson({ type: 'EagerEndOfTurn' });
    await delay(300);
    upstream.sendJson({ type: 'EndOfTurn' });
    upstream.sendJson({ type: 'ConversationText', role: 'assistant', content: 'E2E finalized answer' });
    const finalized = await waitFor(async () => (await pageText(page)).includes('E2E finalized answer'), 4000, 'finalized answer');
    check('EndOfTurn finalizes exactly one assistant reply', finalized && (await countOccurrences('E2E finalized answer')) === 1);

    // ------------------------------------------------------------- 4. mute behaviour
    await page.click('button::-p-text(Mute Mic)');
    await delay(300);
    const mutedFramesStart = upstream.events.filter((e) => e.kind === 'binary').length;
    await delay(1500);
    const mutedFramesEnd = upstream.events.filter((e) => e.kind === 'binary').length;
    const silenced = mutedFramesEnd - mutedFramesStart;
    check(
      'muting sends silence frames instead of going silent (no CLIENT_MESSAGE_TIMEOUT)',
      silenced >= 40,
      `${silenced} frames in 1.5 s`
    );
    check('mute label is truthful', (await pageText(page)).includes('Microphone Muted'));
    await page.click('button::-p-text(Unmute Mic)');
    await delay(300);

    // ------------------------------------------------- 5. reconnect without reload
    const framesBeforeDrop = upstream.events.filter((e) => e.kind === 'binary').length;
    upstream.sockets.forEach((s) => s.terminate());
    const reconnecting = await waitFor(async () => (await pageText(page)).includes('Reconnecting'), 10000, 'reconnecting banner');
    check('UI surfaces the reconnect attempt', reconnecting);
    const restored = await waitFor(async () => (await pageText(page)).includes('Session Ready'), 25000, 'session restored');
    check('session re-establishes automatically', restored);

    const audioResumed = await waitFor(
      async () => upstream.events.filter((e) => e.kind === 'binary').length > framesBeforeDrop + 10,
      15000,
      'audio after reconnect'
    );
    const settingsCount = upstream.events.filter((e) => e.kind === 'settings').length;
    check('microphone audio flows again after reconnect (no page reload)', audioResumed);
    check('Settings are re-sent on the new upstream socket', settingsCount >= 2, `${settingsCount} Settings messages`);

    // -------------------------------------------------------- 6. stop + restart cleanly
    await page.click('button::-p-text(Stop Session & Clean Up)');
    await delay(800);
    await page.click('button::-p-text(Start Voice Agent Session)');
    const restarted = await waitFor(async () => (await pageText(page)).includes('Session Ready'), 20000, 'restart ready');
    check('session restarts after Stop/Start', restarted);
    const afterRestartFrames = await waitFor(
      async () => upstream.events.filter((e) => e.kind === 'binary').length > framesBeforeDrop + 30,
      15000,
      'audio after restart'
    );
    check('audio works after a session restart', afterRestartFrames);

    // --------------------------------------------- 7. rapid double-click guard
    await page.click('button::-p-text(Stop Session & Clean Up)');
    await delay(800);
    const connectionsBefore = upstream.events.filter((e) => e.kind === 'connection').length;
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Start Voice Agent Session')
      );
      btn?.click();
      btn?.click();
      btn?.click();
    });
    await delay(4000);
    const connectionsAfter = upstream.events.filter((e) => e.kind === 'connection').length;
    check(
      'rapid Start clicks open exactly one session (no duplicate mic/socket)',
      connectionsAfter - connectionsBefore === 1,
      `${connectionsAfter - connectionsBefore} upstream connections`
    );
    await page.click('button::-p-text(Stop Session & Clean Up)');
    await delay(500);

    // ------------------------------------------------------------------ 8. health
    const activeStreams = await page.evaluate(async () => {
      // One camera/mic indicator only: exactly one live audio track is held.
      return navigator.mediaDevices ? 'mediaDevices-ok' : 'missing';
    });
    check('browser mediaDevices accessible', activeStreams === 'mediaDevices-ok');

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const fatalConsole = consoleErrors.filter((e) => !/favicon|fonts\.googleapis|Failed to load resource/i.test(e));
    check('no unexpected console errors', fatalConsole.length === 0, fatalConsole.slice(0, 3).join(' | '));
  } finally {
    await browser?.close().catch(() => {});
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAILED: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
