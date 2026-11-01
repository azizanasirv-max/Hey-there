/**
 * Conversation + turn state machine for Voice Agent server events.
 *
 * Responsibilities:
 *  - turn `ConversationText` into messages **immediately** (no dependency on
 *    audio, `AgentAudioDone`, or playback finishing), de-duplicated and attached
 *    to the correct turn;
 *  - track the Flux turn lifecycle (`EagerEndOfTurn` → `TurnResumed` →
 *    `EndOfTurn`) so speculative work can be shown/cancelled without producing
 *    duplicate responses;
 *  - produce the per-turn latency timeline that the UI reports.
 *
 * Pure (no React, no DOM) so the whole matrix — text before/after audio,
 * duplicates, out-of-order events, resumes — is unit tested in `tests/`.
 */

export type ConversationRole = 'user' | 'assistant';

export type ConversationalBehavior = 'default' | 'backchannel' | 'presence_check' | 'filler';

export type TurnStatus =
  | 'idle'
  | 'user_speaking'
  | 'speculative'
  | 'end_of_turn'
  | 'speaking'
  | 'done';

export interface ConversationMessage {
  id: string;
  role: ConversationRole | 'system';
  content: string;
  timestamp: string;
  isFinal?: boolean;
  /** Conversation turn this message belongs to (1-based). */
  turnId?: number;
  /** `conversational_behavior` from Deepgram (scaffolding vs. real turn). */
  behavior?: ConversationalBehavior;
}

export interface TurnMetrics {
  turnId: number;
  status: TurnStatus;
  userStartedAt: number | null;
  eagerAt: number | null;
  endOfTurnAt: number | null;
  firstUserTextAt: number | null;
  firstAssistantTextAt: number | null;
  firstAudioAt: number | null;
  audioDoneAt: number | null;
  turnResumedCount: number;
  speculativeDiscarded: number;
}

export interface TurnLatency {
  /** user speech start → first assistant text */
  speechStartToFirstTextMs: number | null;
  /** user speech start → first assistant audio frame */
  speechStartToFirstAudioMs: number | null;
  /** confirmed end-of-turn (or AgentThinking) → first assistant text */
  eotToFirstTextMs: number | null;
  /** confirmed end-of-turn → first assistant audio frame */
  eotToFirstAudioMs: number | null;
  /** first assistant text -> first assistant audio frame (positive = text first) */
  firstTextToFirstAudioMs: number | null;
  /** eager end-of-turn → confirmed end of turn (speculative window) */
  speculativeWindowMs: number | null;
  /** speculative gain: how much earlier the draft started vs. confirmation */
  speculativeGainMs: number | null;
  /** user speech start → final agent audio done */
  speechStartToAudioDoneMs: number | null;
}

export interface ConversationTextResult {
  accepted: boolean;
  reason?: 'empty' | 'duplicate' | 'invalid-role';
  message?: ConversationMessage;
  turnId: number;
  isFirstAssistantText: boolean;
}

const MAX_DEDUPE_ENTRIES = 200;

function emptyTurn(turnId: number): TurnMetrics {
  return {
    turnId,
    status: 'idle',
    userStartedAt: null,
    eagerAt: null,
    endOfTurnAt: null,
    firstUserTextAt: null,
    firstAssistantTextAt: null,
    firstAudioAt: null,
    audioDoneAt: null,
    turnResumedCount: 0,
    speculativeDiscarded: 0,
  };
}

export class ConversationTracker {
  private turn: TurnMetrics = emptyTurn(0);
  private turnCount = 0;
  private readonly seen = new Map<string, true>();
  private readonly history: TurnMetrics[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Reset transient turn state for a new session; keeps the de-dupe memory. */
  beginSession(): void {
    this.turn = emptyTurn(this.turnCount);
  }

  endSession(): void {
    this.turn = { ...this.turn, status: 'done' };
  }

  get current(): TurnMetrics {
    return { ...this.turn };
  }

  get recentTurns(): TurnMetrics[] {
    return this.history.map((t) => ({ ...t }));
  }

  private startTurn(at: number): void {
    if (this.turn.turnId > 0 && (this.turn.status !== 'idle' || this.turn.firstAssistantTextAt)) {
      this.history.push({ ...this.turn });
    }
    this.turnCount += 1;
    this.turn = emptyTurn(this.turnCount);
    this.turn.userStartedAt = at;
    this.turn.status = 'user_speaking';
  }

  /** `UserStartedSpeaking` — also the barge-in signal. */
  noteUserStartedSpeaking(at: number): void {
    const t = this.turn;
    const userAlreadySpoke = t.status === 'user_speaking' && t.firstUserTextAt !== null;
    const assistantAnswered = t.firstAssistantTextAt !== null;
    if (t.turnId === 0 || t.status === 'done' || userAlreadySpoke || assistantAnswered) {
      this.startTurn(at);
      return;
    }
    t.status = 'user_speaking';
    t.userStartedAt = t.userStartedAt ?? at;
    // A barge-in after a speculative start cancels the draft.
    if (t.eagerAt !== null) {
      t.speculativeDiscarded += 1;
      t.eagerAt = null;
    }
    t.endOfTurnAt = null;
  }

  /** `EagerEndOfTurn` (Flux speculative window opened). */
  noteEagerEndOfTurn(at: number, transcript?: string): void {
    void transcript;
    if (this.turn.turnId === 0) this.startTurn(at);
    const t = this.turn;
    if (t.eagerAt === null) t.eagerAt = at;
    t.status = 'speculative';
  }

  /** `TurnResumed` — the user kept talking: cancel the speculative draft. */
  noteTurnResumed(at: number): void {
    const t = this.turn;
    if (t.eagerAt !== null) {
      t.speculativeDiscarded += 1;
      t.eagerAt = null;
    }
    t.turnResumedCount += 1;
    t.status = 'user_speaking';
    t.endOfTurnAt = null;
    t.userStartedAt = t.userStartedAt ?? at;
  }

  /** `EndOfTurn` — the turn is confirmed; finalize whatever was prepared. */
  noteEndOfTurn(at: number): void {
    if (this.turn.turnId === 0) this.startTurn(at);
    const t = this.turn;
    t.endOfTurnAt = t.endOfTurnAt ?? at;
    if (t.status === 'user_speaking' || t.status === 'speculative' || t.status === 'idle') {
      t.status = 'end_of_turn';
    }
  }

  /** `AgentThinking` — an implicit end-of-turn if none was reported. */
  noteAgentThinking(at: number): void {
    if (this.turn.turnId === 0) this.startTurn(at);
    const t = this.turn;
    t.endOfTurnAt = t.endOfTurnAt ?? at;
    if (t.status !== 'speaking') t.status = 'end_of_turn';
  }

  /**
   * `ConversationText` — displayed immediately, never gated on audio.
   * De-duplicates exact repeats (replays / repeated events).
   */
  noteConversationText(payload: any, at: number): ConversationTextResult {
    const role = payload?.role;
    if (role !== 'user' && role !== 'assistant') {
      return { accepted: false, reason: 'invalid-role', turnId: this.turn.turnId, isFirstAssistantText: false };
    }
    const content = typeof payload?.content === 'string' ? payload.content : payload?.text;
    if (typeof content !== 'string' || content.trim().length === 0) {
      return { accepted: false, reason: 'empty', turnId: this.turn.turnId, isFirstAssistantText: false };
    }

    const normalized = content.trim().replace(/\s+/g, ' ');
    const key = `${role}:${normalized}`;
    if (this.seen.has(key)) {
      return { accepted: false, reason: 'duplicate', turnId: this.turn.turnId, isFirstAssistantText: false };
    }
    this.remember(key);

    // Turn association: a user transcript opens a turn if none is open; an
    // assistant transcript belongs to the turn that produced it.
    if (role === 'user') {
      const t = this.turn;
      const needsNewTurn = t.turnId === 0 || t.status === 'done' || t.firstAssistantTextAt !== null;
      if (needsNewTurn) this.startTurn(at);
      const cur = this.turn;
      cur.firstUserTextAt = cur.firstUserTextAt ?? at;
      if (cur.userStartedAt === null) cur.userStartedAt = at;
      if (cur.status === 'idle') cur.status = 'user_speaking';
    } else if (this.turn.turnId === 0) {
      // Assistant spoke first (e.g. a greeting) — still a real turn.
      this.startTurn(at);
      this.turn.firstUserTextAt = null;
      this.turn.userStartedAt = null;
    }

    const t = this.turn;
    const isFirstAssistantText = role === 'assistant' && t.firstAssistantTextAt === null;
    if (role === 'assistant') {
      t.firstAssistantTextAt = t.firstAssistantTextAt ?? at;
      t.status = 'speaking';
    }

    const behavior: ConversationalBehavior =
      payload?.conversational_behavior === 'backchannel' ||
      payload?.conversational_behavior === 'presence_check' ||
      payload?.conversational_behavior === 'filler'
        ? payload.conversational_behavior
        : 'default';

    return {
      accepted: true,
      turnId: t.turnId,
      isFirstAssistantText,
      message: {
        id: `${at}-${t.turnId}-${role}-${this.seen.size}`,
        role,
        content: content.trim(),
        timestamp: new Date(at).toLocaleTimeString(),
        isFinal: true,
        turnId: t.turnId,
        behavior,
      },
    };
  }

  /** First binary agent audio frame of the turn. */
  noteAudioFrame(at: number): void {
    const t = this.turn;
    if (t.turnId === 0) this.startTurn(at);
    t.firstAudioAt = t.firstAudioAt ?? at;
    t.status = 'speaking';
  }

  /** `AgentAudioDone` — the server finished sending audio for the turn. */
  noteAgentAudioDone(at: number): void {
    const t = this.turn;
    t.audioDoneAt = at;
    if (t.turnId > 0) t.status = 'done';
  }

  /** Per-turn latency breakdown (deltas of the timestamps above). */
  latency(): TurnLatency {
    const t = this.turn;
    const diff = (a: number | null, b: number | null) => (a !== null && b !== null ? Math.max(0, b - a) : null);
    // Signed: a negative value means the audio started before the text arrived.
    const signed = (a: number | null, b: number | null) => (a !== null && b !== null ? b - a : null);
    return {
      speechStartToFirstTextMs: diff(t.userStartedAt, t.firstAssistantTextAt),
      speechStartToFirstAudioMs: diff(t.userStartedAt, t.firstAudioAt),
      eotToFirstTextMs: diff(t.endOfTurnAt, t.firstAssistantTextAt),
      eotToFirstAudioMs: diff(t.endOfTurnAt, t.firstAudioAt),
      firstTextToFirstAudioMs: signed(t.firstAssistantTextAt, t.firstAudioAt),
      speculativeWindowMs: diff(t.eagerAt, t.endOfTurnAt),
      // How much earlier the draft could start thanks to the eager trigger.
      speculativeGainMs:
        diff(t.eagerAt, t.endOfTurnAt) !== null && t.firstAssistantTextAt !== null
          ? diff(t.eagerAt, t.endOfTurnAt)
          : null,
      speechStartToAudioDoneMs: diff(t.userStartedAt, t.audioDoneAt),
    };
  }

  private remember(key: string): void {
    if (this.seen.size >= MAX_DEDUPE_ENTRIES) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(key, true);
  }
}
