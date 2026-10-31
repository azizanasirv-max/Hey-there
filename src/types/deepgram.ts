export type ConnectionStatus = 
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'WAITING_FOR_WELCOME'
  | 'SETTINGS_SENT'
  | 'READY'
  | 'ERROR';

export type Role = 'user' | 'assistant' | 'system';

export interface ConversationMessage {
  id: string;
  role: Role;
  content: string;
  timestamp: string;
  isFinal?: boolean;
}

export interface ModelConfig {
  listenProvider: string;
  listenModel: string;
  thinkProvider: string;
  thinkModel: string;
  speakProvider: string;
  speakModel: string;
  speakVersion?: string;
  sampleRate: number;
  encoding: string;
}

export interface DeepgramEvent {
  id: string;
  timestamp: string;
  type: string;
  rawJson: any;
  category: 'connection' | 'agent' | 'user' | 'audio' | 'error' | 'settings';
}

export interface SessionTelemetry {
  startTime: number | null;
  durationSeconds: number;
  receivedTextEvents: number;
  discardedAudioFrames: number;
  discardedAudioBytes: number;
  connectionFailures: number;
  sentAudioChunks: number;
}

export interface BackendHealthResponse {
  status: string;
  deepgramApiKeyConfigured: boolean;
  maskedKey: string | null;
  timestamp: string;
  uptime: number;
  environment: string;
}
