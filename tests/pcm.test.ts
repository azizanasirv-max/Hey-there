import test from 'node:test';
import assert from 'node:assert/strict';

import {
  StreamingResampler,
  PcmFramer,
  floatTo16BitPCM,
  int16ToFloat32,
  int16ToArrayBuffer,
  samplesForMs,
} from '../src/utils/pcm';

const RATE_48K = 48000;
const RATE_24K = 24000;

function sine(freq: number, rate: number, samples: number, phase = 0): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = Math.sin(2 * Math.PI * freq * (i / rate) + phase);
  return out;
}

test('floatTo16BitPCM clamps and keeps full-scale values', () => {
  const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1, 2, -2, NaN]));
  assert.equal(pcm[0], 0);
  assert.equal(pcm[1], 32767);
  assert.equal(pcm[2], -32768);
  assert.equal(pcm[3], 32767, 'out-of-range values are clamped, not wrapped');
  assert.equal(pcm[4], -32768);
  assert.equal(pcm[5], 0, 'NaN becomes silence');
});

test('int16 <-> float round trip preserves amplitude within 1 LSB', () => {
  const original = new Int16Array([0, 16384, -16384, 32767, -32768]);
  const round = floatTo16BitPCM(int16ToFloat32(original));
  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs(round[i] - original[i]) <= 1, `sample ${i}: ${round[i]} vs ${original[i]}`);
  }
});

test('int16ToArrayBuffer writes little-endian PCM', () => {
  const buffer = int16ToArrayBuffer(new Int16Array([1, -1]));
  const view = new DataView(buffer);
  assert.equal(view.getInt16(0, true), 1);
  assert.equal(view.getInt16(2, true), -1);
  assert.equal(buffer.byteLength, 4);
});

test('resampler output length is exact and drift-free across chunks', () => {
  const resampler = new StreamingResampler(RATE_48K, RATE_24K);
  const chunk = 1024;
  const chunks = 200;
  let produced = 0;
  for (let i = 0; i < chunks; i++) {
    produced += resampler.process(sine(440, RATE_48K, chunk, i)).length;
  }
  const expected = (chunks * chunk) / 2;
  assert.ok(Math.abs(produced - expected) <= 1, `produced=${produced} expected=${expected}`);
});

test('resampler handles a fractional ratio (44.1k -> 24k) without drift', () => {
  const resampler = new StreamingResampler(44100, RATE_24K);
  let produced = 0;
  let input = 0;
  for (let i = 0; i < 300; i++) {
    const block = sine(300, 44100, 1024, i);
    input += block.length;
    produced += resampler.process(block).length;
  }
  const expected = Math.round(input / (44100 / RATE_24K));
  assert.ok(Math.abs(produced - expected) <= 2, `produced=${produced} expected=${expected}`);
});

test('resampler output is continuous across chunk boundaries (no clicks)', () => {
  const resampler = new StreamingResampler(RATE_48K, RATE_24K);
  const signal = sine(1000, RATE_48K, 1024 * 8);
  const out: number[] = [];
  for (let i = 0; i < 8; i++) {
    for (const v of resampler.process(signal.subarray(i * 1024, (i + 1) * 1024))) out.push(v);
  }
  const single = new StreamingResampler(RATE_48K, RATE_24K);
  const reference = Array.from(single.process(signal));
  const n = Math.min(out.length, reference.length) - 4;
  let maxErr = 0;
  for (let i = 1; i < n; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - reference[i]));
  assert.ok(maxErr < 1e-6, `max deviation ${maxErr}`);
});

test('resampler passthrough when rates match', () => {
  const resampler = new StreamingResampler(RATE_24K, RATE_24K);
  assert.equal(resampler.passthrough, true);
  const input = sine(440, RATE_24K, 480);
  assert.equal(resampler.process(input), input);
});

test('PcmFramer emits fixed 20 ms frames and flushes the remainder', () => {
  const framer = new PcmFramer(480, RATE_24K);
  assert.ok(Math.abs(framer.frameDurationMs - 20) < 1e-6);
  const frames: number[] = [];
  framer.push(new Float32Array(1000), (frame) => frames.push(frame.length));
  assert.deepEqual(frames, [480, 480]);
  framer.flush((frame) => frames.push(frame.length));
  assert.deepEqual(frames, [480, 480, 40]);
});

test('samplesForMs is exact for 20 ms at 24 kHz', () => {
  assert.equal(samplesForMs(20, 24000), 480);
  assert.equal(samplesForMs(20, 48000), 960);
});
