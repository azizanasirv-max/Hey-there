import test from 'node:test';
import assert from 'node:assert/strict';

import { ConversationTracker } from '../src/utils/conversation';

test('assistant ConversationText is accepted immediately (no audio required)', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(1000);
  t.noteConversationText({ type: 'ConversationText', role: 'user', content: 'what is the weather' }, 1500);

  const res = t.noteConversationText({ type: 'ConversationText', role: 'assistant', content: 'It is sunny.' }, 2000);
  assert.equal(res.accepted, true);
  assert.equal(res.message?.role, 'assistant');
  assert.equal(res.message?.content, 'It is sunny.');
  assert.equal(res.isFirstAssistantText, true);
  // No AgentAudioDone / audio frame was ever delivered.
  assert.equal(t.current.firstAudioAt, null);
  assert.equal(t.current.audioDoneAt, null);
  assert.equal(t.current.firstAssistantTextAt, 2000);
});

test('user ConversationText is accepted immediately and attached to the current turn', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(1000);
  const res = t.noteConversationText({ role: 'user', content: 'book a table' }, 1600);
  assert.equal(res.accepted, true);
  assert.equal(res.message?.role, 'user');
  assert.equal(res.turnId, 1);
  assert.equal(res.message?.turnId, 1);
  assert.equal(t.current.firstUserTextAt, 1600);
});

test('text can arrive before, after, or interleaved with audio', () => {
  // text first
  const a = new ConversationTracker();
  a.noteUserStartedSpeaking(0);
  a.noteConversationText({ role: 'assistant', content: 'Hello.' }, 300);
  a.noteAudioFrame(900);
  a.noteAgentAudioDone(1500);
  assert.equal(a.latency().firstTextToFirstAudioMs, 600);

  // audio first
  const b = new ConversationTracker();
  b.noteUserStartedSpeaking(0);
  b.noteAudioFrame(300);
  b.noteConversationText({ role: 'assistant', content: 'Hello.' }, 500);
  b.noteAgentAudioDone(900);
  assert.equal(b.latency().firstTextToFirstAudioMs, -200);

  // both accepted, same content
  assert.equal(a.current.firstAssistantTextAt, 300);
  assert.equal(b.current.firstAssistantTextAt, 500);
});

test('duplicate ConversationText is ignored, including replays after a reconnect', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(0);
  const first = t.noteConversationText({ role: 'assistant', content: 'Same answer.' }, 100);
  const second = t.noteConversationText({ role: 'assistant', content: 'Same answer.' }, 120);
  const whitespace = t.noteConversationText({ role: 'assistant', content: '  Same   answer. ' }, 140);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'duplicate');
  assert.equal(whitespace.reason, 'duplicate');

  // A brand new session must still not replay old text.
  t.beginSession();
  t.noteUserStartedSpeaking(500);
  const replay = t.noteConversationText({ role: 'assistant', content: 'Same answer.' }, 600);
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, 'duplicate');
});

test('different roles with the same content are both displayed', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(0);
  assert.equal(t.noteConversationText({ role: 'user', content: 'hello' }, 100).accepted, true);
  assert.equal(t.noteConversationText({ role: 'assistant', content: 'hello' }, 200).accepted, true);
});

test('turns are associated correctly across multiple exchanges', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(0);
  const u1 = t.noteConversationText({ role: 'user', content: 'first question' }, 100);
  const a1 = t.noteConversationText({ role: 'assistant', content: 'first answer' }, 200);
  t.noteAgentAudioDone(300);

  t.noteUserStartedSpeaking(1000);
  const u2 = t.noteConversationText({ role: 'user', content: 'second question' }, 1100);
  const a2 = t.noteConversationText({ role: 'assistant', content: 'second answer' }, 1200);

  assert.equal(u1.turnId, 1);
  assert.equal(a1.turnId, 1);
  assert.equal(u2.turnId, 2);
  assert.equal(a2.turnId, 2);
  assert.equal(a2.isFirstAssistantText, true);
});

test('an assistant greeting before any user turn still gets its own turn', () => {
  const t = new ConversationTracker();
  const greeting = t.noteConversationText({ role: 'assistant', content: 'Hi, how can I help?' }, 50);
  assert.equal(greeting.accepted, true);
  assert.equal(greeting.turnId, 1);
  assert.equal(t.current.userStartedAt, null);
});

test('EagerEndOfTurn then TurnResumed cancels the speculative turn', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(1000);
  t.noteEagerEndOfTurn(1500, 'partial');
  assert.equal(t.current.status, 'speculative');
  assert.equal(t.current.eagerAt, 1500);

  t.noteTurnResumed(1700);
  assert.equal(t.current.status, 'user_speaking');
  assert.equal(t.current.eagerAt, null);
  assert.equal(t.current.turnResumedCount, 1);
  assert.equal(t.current.speculativeDiscarded, 1);

  // A resume must not produce any assistant message on its own.
  assert.equal(t.current.firstAssistantTextAt, null);
});

test('EagerEndOfTurn then EndOfTurn finalizes once and measures the speculative window', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(1000);
  t.noteEagerEndOfTurn(1400);
  t.noteEndOfTurn(1900);
  const first = t.noteConversationText({ role: 'assistant', content: 'Answer.' }, 1700);
  const duplicate = t.noteConversationText({ role: 'assistant', content: 'Answer.' }, 1800);

  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(t.latency().speculativeWindowMs, 500);
  assert.equal(t.latency().speculativeGainMs, 500);
});

test('barge-in during the speculative window discards the draft', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(1000);
  t.noteEagerEndOfTurn(1300);
  t.noteUserStartedSpeaking(1500); // user talks again
  assert.equal(t.current.speculativeDiscarded, 1);
  assert.equal(t.current.eagerAt, null);
});

test('AgentThinking implies a confirmed end of turn when no EndOfTurn is sent', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(100);
  t.noteAgentThinking(400);
  assert.equal(t.current.endOfTurnAt, 400);
  assert.equal(t.current.status, 'end_of_turn');
});

test('latency timeline is computed from the real event timestamps', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(1000);
  t.noteConversationText({ role: 'user', content: 'hi' }, 1400);
  t.noteEndOfTurn(1600);
  t.noteConversationText({ role: 'assistant', content: 'hello' }, 2200);
  t.noteAudioFrame(2400);
  t.noteAgentAudioDone(5000);

  const l = t.latency();
  assert.equal(l.speechStartToFirstTextMs, 1200);
  assert.equal(l.speechStartToFirstAudioMs, 1400);
  assert.equal(l.eotToFirstTextMs, 600);
  assert.equal(l.eotToFirstAudioMs, 800);
  assert.equal(l.speechStartToAudioDoneMs, 4000);
});

test('empty / malformed ConversationText is rejected without breaking state', () => {
  const t = new ConversationTracker();
  assert.equal(t.noteConversationText({ role: 'assistant', content: '   ' }, 1).reason, 'empty');
  assert.equal(t.noteConversationText({ role: 'narrator', content: 'x' }, 2).reason, 'invalid-role');
  assert.equal(t.noteConversationText(null, 3).accepted, false);
  assert.equal(t.current.turnId, 0);
});

test('scaffolding behaviours are preserved on the message for the UI', () => {
  const t = new ConversationTracker();
  t.noteUserStartedSpeaking(0);
  const res = t.noteConversationText({ role: 'assistant', content: 'mm-hm', conversational_behavior: 'backchannel' }, 100);
  assert.equal(res.message?.behavior, 'backchannel');
  const normal = t.noteConversationText({ role: 'assistant', content: 'okay' }, 200);
  assert.equal(normal.message?.behavior, 'default');
});
