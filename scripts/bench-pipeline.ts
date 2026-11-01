/**
 * Measured before/after benchmark for the two latency levers in this change:
 *
 *  1. Proxy path — runs the ORIGINAL server (git commit ad474ee) and the fixed
 *     server against the same mock Voice Agent upstream, and counts what each
 *     one sends to the browser while the agent streams 50 audio frames/second.
 *  2. Browser capture path — CPU cost per audio chunk of the original per-chunk
 *     resampler + DataView encoder vs the new streaming resampler + Int16Array
 *     encoder, for 60 s of 48 kHz microphone audio.
 *
 * Run: node --import tsx scripts/bench-pipeline.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestClient, delay, getFreePort, startMockUpstream, startProxy } from '../tests/helpers/proxyHarness';
import { StreamingResampler, floatTo16BitPCM } from '../src/utils/pcm';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const BASELINE_COMMIT = process.env.BASELINE_COMMIT || 'ad474ee';
const FRAME_BYTES = 960; // 20 ms @ 24 kHz linear16
const AGENT_FPS = 50; // frames/s a real TTS stream produces

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

interface ProxyMeasurement {
  label: string;
  handshakeMs: number;
  uplinkHopP50: number;
  uplinkHopP95: number;
  agentFramesDelivered: number;
  jsonMessagesPerSecond: number;
  jsonMessagesTotal: number;
  firstAudioDelayMs: number | null;
}

async function measureProxy(serverFile: string, label: string, mockPort?: number): Promise<ProxyMeasurement> {
  const upstream = await startMockUpstream({ port: mockPort });
  const proxy = await startProxy({ DEEPGRAM_AGENT_URL: upstream.url }, serverFile);
  const client = createTestClient(proxy.wsUrl);
  try {
    const connectStart = Date.now();
    await client.open();
    client.ws.send(
      JSON.stringify({
        type: 'ConfigureSettings',
        config: { listenModel: 'nova-3', thinkModel: 'gpt-4o-mini', speakModel: 'flux-kit-en', sampleRate: 24000, encoding: 'linear16' },
      })
    );
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && !client.records.some((r) => r.text?.type === 'SessionReady')) await delay(20);
    const handshakeMs = Date.now() - connectStart;
    await delay(300);

    // --- uplink hop latency: client send -> mock upstream receive
    const hops: number[] = [];
    for (let i = 0; i < 40; i++) {
      const before = upstream.events.filter((e) => e.kind === 'binary').length;
      const sentAt = Date.now();
      client.ws.send(Buffer.alloc(FRAME_BYTES));
      const waitUntil = Date.now() + 2000;
      while (Date.now() < waitUntil && upstream.events.filter((e) => e.kind === 'binary').length === before) {
        await delay(1);
      }
      const frames = upstream.events.filter((e) => e.kind === 'binary');
      if (frames.length > before) hops.push(frames[frames.length - 1].at - sentAt);
      await delay(5);
    }
    hops.sort((a, b) => a - b);

    // --- agent streams 2 s of audio at 50 frames/s
    const jsonBefore = client.records.filter((r) => r.text).length;
    const binaryBefore = client.records.filter((r) => r.binaryBytes).length;
    const streamStart = Date.now();
    for (let i = 0; i < AGENT_FPS * 2; i++) {
      upstream.sendBinary(Buffer.alloc(FRAME_BYTES));
      await delay(1000 / AGENT_FPS);
    }
    await delay(1200);
    const streamSeconds = (Date.now() - streamStart) / 1000;

    const jsonTotal = client.records.filter((r) => r.text).length - jsonBefore;
    const audioTotal = client.records.filter((r) => r.binaryBytes).length - binaryBefore;

    const statsMsg = client.records.find((r) => r.text?.type === 'AgentAudioStats');
    return {
      label,
      handshakeMs,
      uplinkHopP50: percentile(hops, 0.5),
      uplinkHopP95: percentile(hops, 0.95),
      agentFramesDelivered: audioTotal,
      jsonMessagesPerSecond: Math.round((jsonTotal / streamSeconds) * 10) / 10,
      jsonMessagesTotal: jsonTotal,
      firstAudioDelayMs: statsMsg?.text?.firstAudioDelayMs ?? null,
    };
  } finally {
    await client.close().catch(() => {});
    await proxy.stop().catch(() => {});
    await upstream.close().catch(() => {});
  }
}

// ---------------------------------------------------------------- client side

/** Verbatim copy of the pre-fix resampler (src/utils/audioStreamer.ts @ ad474ee). */
function legacyResample(inputData: Float32Array, inSampleRate: number, outSampleRate: number): Float32Array {
  if (inSampleRate === outSampleRate) return inputData;
  const ratio = inSampleRate / outSampleRate;
  const newLength = Math.round(inputData.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const originIndex = i * ratio;
    const index1 = Math.floor(originIndex);
    const index2 = Math.min(index1 + 1, inputData.length - 1);
    const fraction = originIndex - index1;
    result[i] = inputData[index1] * (1 - fraction) + inputData[index2] * fraction;
  }
  return result;
}

/** Verbatim copy of the pre-fix encoder (DataView per sample). */
function legacyFloatToPCM(float32Array: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function sine(freq: number, rate: number, samples: number): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

interface CaptureMeasurement {
  label: string;
  chunkMs: number;
  chunksPerSecond: number;
  cpuMsPerSecondOfAudio: number;
  chunkP50Ms: number;
  chunkP95Ms: number;
  bufferingLatencyMs: number;
  driftSamplesPerMinute: number;
}

function measureLegacyCapture(seconds = 60, inRate = 48000): CaptureMeasurement {
  const outRate = 24000;
  const chunk = 2048; // ScriptProcessor buffer
  const blocks = Math.round((inRate * seconds) / chunk);
  const block = sine(440, inRate, chunk);
  const durations: number[] = [];
  let produced = 0;
  const t0 = performance.now();
  for (let i = 0; i < blocks; i++) {
    const s = performance.now();
    const resampled = legacyResample(block, inRate, outRate);
    legacyFloatToPCM(resampled);
    durations.push(performance.now() - s);
    produced += resampled.length;
  }
  const total = performance.now() - t0;
  durations.sort((a, b) => a - b);
  const chunkMs = (chunk / inRate) * 1000;
  const expected = (blocks * chunk * outRate) / inRate;
  return {
    label: `before (ScriptProcessor 2048 @ ${inRate} Hz + per-chunk resample)`,
    chunkMs: Math.round(chunkMs * 10) / 10,
    chunksPerSecond: Math.round((1000 / chunkMs) * 10) / 10,
    cpuMsPerSecondOfAudio: Math.round((total / seconds) * 100) / 100,
    chunkP50Ms: Math.round(percentile(durations, 0.5) * 1000) / 1000,
    chunkP95Ms: Math.round(percentile(durations, 0.95) * 1000) / 1000,
    bufferingLatencyMs: Math.round(chunkMs * 10) / 10,
    driftSamplesPerMinute: Math.round(produced - expected),
  };
}

function measureNewCapture(seconds = 60, inRate = 48000): CaptureMeasurement {
  const outRate = 24000;
  const chunk = 1024; // AudioWorklet batch
  const blocks = Math.round((inRate * seconds) / chunk);
  const block = sine(440, inRate, chunk);
  const resampler = new StreamingResampler(inRate, outRate);
  const durations: number[] = [];
  let produced = 0;
  const t0 = performance.now();
  for (let i = 0; i < blocks; i++) {
    const s = performance.now();
    const resampled = resampler.process(block);
    floatTo16BitPCM(resampled);
    durations.push(performance.now() - s);
    produced += resampled.length;
  }
  const total = performance.now() - t0;
  durations.sort((a, b) => a - b);
  const expected = (blocks * chunk * outRate) / inRate;
  return {
    label: `after (AudioWorklet 1024 @ ${inRate} Hz + streaming resample, 20 ms frames)`,
    chunkMs: Math.round((chunk / inRate) * 10000) / 10,
    chunksPerSecond: Math.round((inRate / chunk) * 10) / 10,
    cpuMsPerSecondOfAudio: Math.round((total / seconds) * 100) / 100,
    chunkP50Ms: Math.round(percentile(durations, 0.5) * 1000) / 1000,
    chunkP95Ms: Math.round(percentile(durations, 0.95) * 1000) / 1000,
    bufferingLatencyMs: 20,
    driftSamplesPerMinute: Math.round(produced - expected),
  };
}

async function main() {
  console.log('=== Proxy: original (ad474ee) vs fixed ===');

  // The baseline server hardcodes the Deepgram URL, so patch it to a mock port
  // we control (the mock is recreated on that port for the run).
  const baselinePort = await getFreePort();
  const baselineMockUrl = `ws://127.0.0.1:${baselinePort}`;
  const source = execFileSync('git', ['show', `${BASELINE_COMMIT}:server.ts`], {
    cwd: path.resolve(SCRIPT_DIR, '..'),
  }).toString();
  const dir = path.resolve(SCRIPT_DIR, '..', '.bench');
  fs.mkdirSync(dir, { recursive: true });
  const baselinePath = path.join(dir, 'server.baseline.ts');
  fs.writeFileSync(baselinePath, source.replace(/wss:\/\/agent\.deepgram\.com\/v1\/agent\/converse/g, baselineMockUrl));

  const runs: ProxyMeasurement[] = [];
  runs.push(await measureProxy(baselinePath, 'before: ad474ee server.ts', baselinePort));
  runs.push(await measureProxy('server.ts', 'after: fixed server.ts'));

  for (const r of runs) {
    console.log(
      `${r.label}
` +
        `  handshake=${r.handshakeMs} ms  uplinkHop p50=${r.uplinkHopP50} ms p95=${r.uplinkHopP95} ms
` +
        `  agent audio frames delivered to browser: ${r.agentFramesDelivered}
` +
        `  JSON messages to browser: ${r.jsonMessagesTotal} (${r.jsonMessagesPerSecond}/s)
` +
        `  SettingsApplied -> first agent audio: ${r.firstAudioDelayMs ?? 'n/a'} ms`
    );
  }

  console.log('\n=== Client capture path ===');
  const measurements = [
    measureLegacyCapture(60, 48000),
    measureNewCapture(60, 48000),
    measureLegacyCapture(60, 44100),
    measureNewCapture(60, 44100),
  ];
  for (const m of measurements) {
    console.log(
      `${m.label}
` +
        `  chunk=${m.chunkMs} ms (${m.chunksPerSecond} chunks/s)  capture-side buffering=${m.bufferingLatencyMs} ms
` +
        `  CPU=${m.cpuMsPerSecondOfAudio} ms per second of audio  chunk p50=${m.chunkP50Ms} ms p95=${m.chunkP95Ms} ms
` +
        `  resampled sample drift over 60 s: ${m.driftSamplesPerMinute} samples`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
