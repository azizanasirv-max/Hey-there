/**
 * Optional LIVE latency run against the real Deepgram Voice Agent.
 *
 * Requires DEEPGRAM_API_KEY. Drives the real proxy (server.ts) exactly like the
 * browser does, but uses `InjectUserMessage` so the measurement does not depend
 * on microphone hardware. Because the text is injected, STT latency is NOT
 * exercised — TTFT/TTFA here are the LLM + TTS + network path (Deepgram also
 * reports its own STT/LLM/TTS breakdown in `LatencyReport`).
 *
 * Run: bun run test:live   (exits 0 with SKIPPED when no key is configured)
 */
import { delay, startProxy } from '../tests/helpers/proxyHarness';
import WebSocket from 'ws';

const TURNS = Number(process.env.LIVE_TURNS || 10);
const TURN_TIMEOUT_MS = 45000;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

function stats(values: number[]): string {
  if (!values.length) return 'n/a';
  const s = [...values].sort((a, b) => a - b);
  return `median=${percentile(s, 50)} ms  p95=${percentile(s, 95)} ms  max=${s[s.length - 1]} ms`;
}

async function main() {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key || key.includes('your_actual')) {
    console.log('SKIPPED: DEEPGRAM_API_KEY is not configured in this environment.');
    console.log('         Live conversational latency was NOT measured (no credentials available).');
    return;
  }

  const proxy = await startProxy({ DEEPGRAM_API_KEY: key, PROXY_IDLE_KEEPALIVE_MS: '8000' }, 'server.ts');
  const ws = new WebSocket(proxy.wsUrl);
  ws.binaryType = 'arraybuffer';

  const ttfts: number[] = [];
  const ttfas: number[] = [];
  const totals: number[] = [];
  const reports: any[] = [];
  let audioFrames = 0;
  let pending: { firstText?: number; firstAudio?: number; done?: number } | null = null;

  ws.on('message', (data: any, isBinary: boolean) => {
    if (isBinary) {
      audioFrames += 1;
      if (pending && pending.firstAudio === undefined) pending.firstAudio = Date.now();
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'ConversationText' && msg.role === 'assistant' && pending && pending.firstText === undefined) {
      pending.firstText = Date.now();
    }
    if (msg.type === 'AgentAudioDone' && pending) pending.done = Date.now();
    if (msg.type === 'LatencyReport') reports.push(msg);
  });

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'ConfigureSettings', config: { listenModel: 'nova-3' } }));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('handshake timeout')), 20000);
    ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'SessionReady') {
          clearTimeout(timer);
          resolve();
        }
        if (msg.type === 'Error') {
          clearTimeout(timer);
          reject(new Error(`Deepgram error: ${msg.code} ${msg.description}`));
        }
      } catch {
        /* binary */
      }
    });
  });

  console.log(`Connected. Running ${TURNS} live turns against Deepgram…`);
  for (let i = 1; i <= TURNS; i++) {
    pending = {};
    const startedAt = Date.now();
    ws.send(JSON.stringify({ type: 'InjectUserMessage', content: `Turn ${i}: reply with one short sentence.` }));

    const deadline = startedAt + TURN_TIMEOUT_MS;
    while (Date.now() < deadline && !pending.done) await delay(25);
    if (!pending.done) {
      console.warn(`  turn ${i}: timed out`);
      continue;
    }
    if (pending.firstText) ttfts.push(pending.firstText - startedAt);
    if (pending.firstAudio) ttfas.push(pending.firstAudio - startedAt);
    totals.push(pending.done - startedAt);
    console.log(
      `  turn ${i}: first text ${pending.firstText ? pending.firstText - startedAt : 'n/a'} ms, ` +
        `first audio ${pending.firstAudio ? pending.firstAudio - startedAt : 'n/a'} ms, ` +
        `audio done ${pending.done - startedAt} ms (frames ${audioFrames})`
    );
    await delay(400);
  }

  console.log('\n=== Live results (injected text, so STT is excluded) ===');
  console.log(`time to first text  ${stats(ttfts)}`);
  console.log(`time to first audio ${stats(ttfas)}`);
  console.log(`turn total          ${stats(totals)}`);
  if (reports.length) {
    const pick = (k: string) =>
      stats(reports.map((r) => Number(r[k]) * 1000).filter((n) => Number.isFinite(n)));
    console.log(`Deepgram stt_latency      ${pick('stt_latency')}`);
    console.log(`Deepgram ttt_text_latency ${pick('ttt_text_latency')}`);
    console.log(`Deepgram tts_latency      ${pick('tts_latency')}`);
    console.log(`Deepgram total_latency    ${pick('total_latency')}`);
  }

  ws.close();
  await proxy.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
