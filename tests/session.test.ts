import test from 'node:test';
import assert from 'node:assert/strict';

import { reconnectDelay } from '../src/utils/voiceAgentSession';

const noJitter = () => 0.5; // jitter factor becomes exactly 1.0

test('reconnect delay backs off exponentially and is capped at 8 s', () => {
  const delays = [1, 2, 3, 4, 5, 6].map((attempt) => reconnectDelay(attempt, noJitter));
  assert.deepEqual(delays, [500, 1000, 2000, 4000, 8000, 8000]);
});

test('reconnect delay never exceeds the cap with maximum jitter', () => {
  for (let attempt = 1; attempt <= 8; attempt++) {
    assert.ok(reconnectDelay(attempt, () => 1) <= 8000, `attempt ${attempt}`);
    assert.ok(reconnectDelay(attempt, () => 0) >= 400, `attempt ${attempt}`);
  }
});

test('reconnect delay is bounded and jittered (prevents thundering herd)', () => {
  const a = reconnectDelay(3, () => 0);
  const b = reconnectDelay(3, () => 1);
  assert.ok(a < b, 'jitter must vary the delay');
  assert.ok(a >= 1600 && b <= 2400, `unexpected jitter range ${a}..${b}`);
});
