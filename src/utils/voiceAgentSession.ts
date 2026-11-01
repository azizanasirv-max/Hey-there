/**
 * Browser side of the Voice Agent session: one WebSocket to the local proxy,
 * with the protocol handshake, idle keep-alive and bounded auto-reconnect.
 *
 * The audio uplink is a *sink* (see `sendAudio`) and not a captured socket
 * reference, so a reconnect transparently restores the whole audio pipeline
 * without restarting the microphone or reloading the page.
 */

import { AgentModelConfig } from '../shared/voiceAgentConfig';

export type SessionStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'WAITING_FOR_WELCOME'
  | 'SETTINGS_SENT'
  | 'READY'
  | 'RECONNECTING'
  | 'ERROR';

export interface SessionStatusInfo {
  /** 1-based reconnect attempt, when applicable. */
  attempt?: number;
  nextRetryMs?: number;
  reason?: string;
}

export interface SessionHandlers {
  onStatus?: (status: SessionStatus, info?: SessionStatusInfo) => void;
  /** Every protocol JSON event the proxy forwards (ConversationText, ...). */
  onEvent?: (type: string, payload: any, receivedAt: number) => void;
  /** Binary agent (TTS) audio — already PCM linear16 24 kHz. */
  onAudio?: (frame: ArrayBuffer, receivedAt: number) => void;
  onReady?: (info: { reconnected: boolean; attempt: number }) => void;
  /** Fatal error (Deepgram `Error` or transport failure). */
  onFatal?: (error: { code?: string; message: string }) => void;
  /** Non-fatal Deepgram `Warning`. */
  onWarning?: (code: string, message: string) => void;
  onClose?: (info: { code: number; reason: string; willReconnect: boolean }) => void;
}

export interface SessionOptions {
  url?: string;
  config: AgentModelConfig;
  handlers: SessionHandlers;
  /** Total reconnect attempts before giving up. */
  maxReconnectAttempts?: number;
  /** How long to wait for Welcome+SettingsApplied before declaring failure. */
  handshakeTimeoutMs?: number;
}

const HANDSHAKE_TIMEOUT_MS = 15000;
const KEEPALIVE_INTERVAL_MS = 4000;
/** Send KeepAlive once the uplink has been silent this long (docs: every 8 s). */
const KEEPALIVE_IDLE_MS = 8000;
/** Refuse to queue more than this on a back-pressured socket. */
const MAX_BUFFERED_BYTES = 512 * 1024;

/**
 * Exponential backoff with ±20% jitter: ~500, 1000, 2000, 4000, 8000 ms.
 * The result is always clamped to MAX_RECONNECT_DELAY_MS so a reconnect burst
 * can never grow unbounded.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(8000, 500 * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = 0.8 + random() * 0.4;
  return Math.min(8000, Math.round(base * jitter));
}

/** Default proxy URL for the current page origin. */
export function defaultProxyUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/agent-proxy`;
}

export class VoiceAgentSession {
  private ws: WebSocket | null = null;
  private status: SessionStatus = 'DISCONNECTED';
  private config: AgentModelConfig;
  private readonly url: string;
  private readonly handlers: SessionHandlers;
  private readonly maxAttempts: number;
  private readonly handshakeTimeoutMs: number;

  private attempt = 0;
  private reconnectedOnce = false;
  private stoppedByUser = false;
  private ready = false;
  private fatalError: { code?: string; message: string } | null = null;
  private consecutiveFatal = 0;

  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastAudioAt = 0;

  constructor(options: SessionOptions) {
    this.config = options.config;
    this.url = options.url || defaultProxyUrl();
    this.handlers = options.handlers;
    this.maxAttempts = options.maxReconnectAttempts ?? 5;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  get currentStatus(): SessionStatus {
    return this.status;
  }

  get attemptsUsed(): number {
    return this.attempt;
  }

  /** Open (or re-open) the session. Safe to call repeatedly. */
  connect(): void {
    if (this.isOpen || this.ws) return;
    this.stoppedByUser = false;
    this.fatalError = null;
    this.ready = false;
    this.setStatus(this.attempt === 0 ? 'CONNECTING' : 'RECONNECTING', {
      attempt: this.attempt,
      reason: this.attempt > 0 ? 'restoring session' : undefined,
    });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err: any) {
      this.handleTransportFailure(`Failed to open WebSocket: ${err?.message || err}`);
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      this.lastAudioAt = Date.now();
      this.setStatus('WAITING_FOR_WELCOME');
      // Client-side configuration; the proxy converts it to the official
      // `Settings` message and never forwards this to Deepgram.
      this.sendJson({ type: 'ConfigureSettings', config: this.config });
      this.startHandshakeWatchdog();
      this.startKeepAlive();
    };

    ws.onmessage = (event) => {
      const receivedAt = Date.now();
      if (typeof event.data !== 'string') {
        if (event.data instanceof ArrayBuffer) this.handlers.onAudio?.(event.data, receivedAt);
        return;
      }
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch (err) {
        console.warn('[Session] Dropping unparsable proxy message', err);
        return;
      }
      this.handleMessage(data, receivedAt);
    };

    ws.onerror = () => {
      // `onclose` always follows; reconnect decisions live there.
      console.warn('[Session] WebSocket error');
    };

    ws.onclose = (event) => {
      const code = event.code;
      const reason = event.reason || '';
      this.clearTimers();
      this.ws = null;
      this.ready = false;

      if (this.stoppedByUser) {
        this.setStatus('DISCONNECTED');
        this.handlers.onClose?.({ code, reason, willReconnect: false });
        return;
      }

      const willReconnect = this.attempt < this.maxAttempts && this.consecutiveFatal < 2;
      this.handlers.onClose?.({ code, reason, willReconnect });

      if (!willReconnect) {
        const message =
          this.fatalError?.message ||
          `Session closed unexpectedly (code ${code}${reason ? `: ${reason}` : ''}). Reconnection attempts exhausted.`;
        this.handlers.onFatal?.({ code: this.fatalError?.code, message });
        this.setStatus('ERROR', { reason: message });
        return;
      }

      this.attempt += 1;
      const delay = reconnectDelay(this.attempt);
      this.setStatus('RECONNECTING', {
        attempt: this.attempt,
        nextRetryMs: delay,
        reason: this.fatalError?.message || 'connection lost',
      });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.ws = null; // allow connect() to run again
        this.connect();
      }, delay);
    };
  }

  private handleMessage(data: any, receivedAt: number) {
    const type: string = data?.type || 'Unknown';

    if (type === 'ProxyStatus') {
      if (data.status === 'SettingsSent') this.setStatus('SETTINGS_SENT');
      if (data.status === 'Disconnected') {
        // Upstream closed; the proxy closes us next, but surface the reason now.
        this.handlers.onEvent?.(type, data, receivedAt);
      }
      return;
    }

    if (type === 'SessionReady' || type === 'SettingsApplied') {
      this.handlers.onEvent?.(type, data, receivedAt);
      this.ready = true;
      this.consecutiveFatal = 0;
      this.clearHandshakeWatchdog();
      this.setStatus('READY');
      this.handlers.onReady?.({ reconnected: this.attempt > 0 || this.reconnectedOnce, attempt: this.attempt });
      if (this.attempt > 0) this.reconnectedOnce = true;
      // Reset the attempt budget once a session is genuinely healthy.
      setTimeout(() => {
        if (this.ready) this.attempt = 0;
      }, 5000);
      return;
    }

    if (type === 'Error') {
      this.consecutiveFatal += 1;
      this.fatalError = {
        code: data.code,
        message: `${data.code ? `[${data.code}] ` : ''}${data.description || data.message || 'Voice Agent error'}`,
      };
      this.handlers.onFatal?.(this.fatalError);
      this.handlers.onEvent?.(type, data, receivedAt);
      return;
    }

    if (type === 'Warning') {
      this.handlers.onWarning?.(data.code || 'WARNING', data.description || data.message || '');
      this.handlers.onEvent?.(type, data, receivedAt);
      return;
    }

    this.handlers.onEvent?.(type, data, receivedAt);
  }

  /** Send one microphone frame. Returns false when the socket cannot take it. */
  sendAudio(frame: ArrayBuffer): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || !this.ready) return false;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    try {
      ws.send(frame);
      this.lastAudioAt = Date.now();
      return true;
    } catch (err) {
      console.warn('[Session] audio send failed', err);
      return false;
    }
  }

  injectUserMessage(content: string): boolean {
    return this.sendJson({ type: 'InjectUserMessage', content });
  }

  /** Update the config applied on the next (re)connect. */
  updateConfig(config: AgentModelConfig): void {
    this.config = config;
  }

  private sendJson(payload: Record<string, unknown>): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.warn('[Session] JSON send failed', err);
      return false;
    }
  }

  private startHandshakeWatchdog() {
    this.clearHandshakeWatchdog();
    this.handshakeTimer = setTimeout(() => {
      if (this.ready) return;
      console.warn('[Session] Handshake timed out');
      this.fatalError = {
        message: `Handshake timed out after ${Math.round(this.handshakeTimeoutMs / 1000)}s (no SettingsApplied from the proxy).`,
      };
      this.handlers.onFatal?.(this.fatalError);
      try {
        this.ws?.close(4000, 'handshake timeout');
      } catch {
        /* ignore */
      }
    }, this.handshakeTimeoutMs);
  }

  private clearHandshakeWatchdog() {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  /**
   * The Voice Agent server closes sockets that go silent
   * (`CLIENT_MESSAGE_TIMEOUT`), so keep the uplink alive when it is idle.
   */
  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (!this.isOpen || !this.ready) return;
      if (Date.now() - this.lastAudioAt >= KEEPALIVE_IDLE_MS) {
        if (this.sendJson({ type: 'KeepAlive' })) this.lastAudioAt = Date.now();
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private clearTimers() {
    this.clearHandshakeWatchdog();
    this.stopKeepAlive();
  }

  private handleTransportFailure(message: string) {
    this.fatalError = { message };
    this.handlers.onFatal?.({ message });
    this.setStatus('ERROR', { reason: message });
  }

  private setStatus(status: SessionStatus, info?: SessionStatusInfo) {
    this.status = status;
    this.handlers.onStatus?.(status, info);
  }

  /** Close intentionally: no reconnect, timers cleared. */
  stop(code = 1000, reason = 'User stopped session'): void {
    this.stoppedByUser = true;
    this.clearTimers();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close(code, reason);
      } catch {
        /* ignore */
      }
    }
    this.ready = false;
    this.attempt = 0;
    this.setStatus('DISCONNECTED');
  }
}
