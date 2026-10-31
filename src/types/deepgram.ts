import type { AgentModelConfig } from '../shared/voiceAgentConfig';

export type ConnectionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'WAITING_FOR_WELCOME'
  | 'SETTINGS_SENT'
  | 'READY'
  | 'RECONNECTING'
  | 'ERROR';

export type Role = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  isFinal?: boolean;
}

/** Model configuration — single definition shared with the proxy. */
export type ModelConfig = AgentModelConfig;

export interface DeepgramEvent {
  id: string;
  timestamp: string;
  type: string;
  rawJson: any;
  category: 'connection' | 'agent' | 'user' | 'audio' | 'error' | 'settings';
}

export interface LatencyMetrics {
  /** Client: first agent transcript after the user started speaking (ms). */
  speechStartToFirstTextMs: number | null;
  /** Client: user speech start -> first agent audio frame playable (ms). */
  speechStartToFirstAudioMs: number | null;
  /** Client: first agent audio frame -> it actually becoming audible (ms). */
  firstAudioBufferingMs: number | null;
  /** Proxy: Settings sent -> first agent audio byte from Deepgram (ms). */
  settingsToFirstAudioMs: number | null;
  /** Proxy: Settings sent -> SettingsApplied (ms). */
  settingsToAppliedMs: number | null;
  /** Deepgram LatencyReport fields, converted to ms. */
  sttMs: number | null;
  thinkMs: number | null;
  ttsMs: number | null;
  totalMs: number | null;
}

export interface MicStatus {
  streaming: boolean;
  contextState: string | null;
  trackState: string | null;
  captureSampleRate: number | null;
  backend: 'worklet' | 'script-processor' | null;
  droppedFrames: number;
}

export interface PlayerStatus {
  playing: boolean;
  contextState: string | null;
  framesPlayed: number;
  framesDropped: number;
  underruns: number;
  bufferedMs: number;
}

export interface SessionTelemetry {
  startTime: number | null;
  durationSeconds: number;
  receivedTextEvents: number;
  /** Microphone frames handed to the socket. */
  sentAudioChunks: number;
  sentAudioBytes: number;
  droppedAudioFrames: number;
  /** Agent (TTS) audio frames received and queued for playback. */
  agentAudioFrames: number;
  agentAudioBytes: number;
  connectionFailures: number;
  reconnects: number;
  latency: LatencyMetrics;
}

export const EMPTY_LATENCY: LatencyMetrics = {
  speechStartToFirstTextMs: null,
  speechStartToFirstAudioMs: null,
  firstAudioBufferingMs: null,
  settingsToFirstAudioMs: null,
  settingsToAppliedMs: null,
  sttMs: null,
  thinkMs: null,
  ttsMs: null,
  totalMs: null,
};

export interface BackendHealthResponse {
  status: string;
  deepgramApiKeyConfigured: boolean;
  maskedKey: string | null;
  agentUrl?: string;
  timestamp: string;
  uptime: number;
  environment: string;
}
