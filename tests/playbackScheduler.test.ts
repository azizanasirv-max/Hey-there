import test from 'node:test';
import assert from 'node:assert/strict';

import { PlaybackScheduler } from '../src/utils/playbackScheduler';

const RATE = 24000;
const FRAME_SAMPLES = 480; // 20 ms

test('first chunk of a turn starts after the configured lead time', () => {
  const s = new PlaybackScheduler(0.06);
  const start = s.schedule(FRAME_SAMPLES, RATE, 10, false);
  assert.equal(start, 10.06);
});

test('subsequent chunks are scheduled back-to-back with no gaps', () => {
  const s = new PlaybackScheduler(0.06);
  let now = 10;
  const starts: number[] = [];
  for (let i = 0; i < 5; i++) {
    starts.push(s.schedule(FRAME_SAMPLES, RATE, now, i > 0));
    now += FRAME_SAMPLES / RATE; // frames arrive in real time
  }
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1] - FRAME_SAMPLES / RATE;
    assert.ok(Math.abs(gap) < 1e-9, `gap between chunk ${i - 1} and ${i} = ${gap}`);
  }
});

test('late chunks are clamped to now+lead instead of being scheduled in the past', () => {
  const s = new PlaybackScheduler(0.06);
  s.schedule(FRAME_SAMPLES, RATE, 5, false);
  // The queue ran dry: the next chunk arrives much later.
  const start = s.schedule(FRAME_SAMPLES, RATE, 9, true);
  assert.equal(start, 9.06);
});

test('bufferedUntil tracks the committed timeline and reset clears it', () => {
  const s = new PlaybackScheduler(0.06);
  s.schedule(FRAME_SAMPLES, RATE, 0, false);
  assert.ok(Math.abs(s.bufferedUntil - 0.08) < 1e-9);
  s.reset();
  assert.equal(s.bufferedUntil, 0);
});
