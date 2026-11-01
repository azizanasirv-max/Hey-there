import React from 'react';
import { AlertTriangle, Loader2, RotateCcw, Square, WifiOff } from 'lucide-react';
import { ConnectionStatus } from '../types/deepgram';

interface StatusStripProps {
  status: ConnectionStatus;
  /** Human-readable reason attached to the current status (proxy/transport). */
  message?: string | null;
  /** Latest retry attempt, when reconnecting. */
  attempt?: number | null;
  onStopSession: () => void;
  onRetry?: () => void;
}

/**
 * Sticky incident strip.
 *
 * The detailed status lives in the Connection panel, which can be scrolled
 * far out of view while the user is watching the transcript on a phone. This
 * strip only appears for transient/failed connection states so the user always
 * knows *why* audio stopped and what will happen next (auto-reconnect vs. a
 * manual retry), and it is announced through `role="status"`.
 */
export const StatusStrip: React.FC<StatusStripProps> = ({ status, message, attempt, onStopSession, onRetry }) => {
  const isReconnecting = status === 'RECONNECTING';
  const isError = status === 'ERROR';
  const isConnecting = status === 'CONNECTING' || status === 'WAITING_FOR_WELCOME' || status === 'SETTINGS_SENT';

  if (!isReconnecting && !isError && !isConnecting) return null;

  const tone = isError
    ? 'bg-rose-950/80 border-rose-800/80 text-rose-100'
    : isReconnecting
    ? 'bg-amber-950/80 border-amber-800/80 text-amber-100'
    : 'bg-cyan-950/80 border-cyan-800/80 text-cyan-100';

  const label = isError
    ? 'Session failed'
    : isReconnecting
    ? `Reconnecting${attempt ? ` · attempt ${attempt}` : ''}`
    : status === 'SETTINGS_SENT'
    ? 'Applying Deepgram settings…'
    : 'Connecting to the proxy…';

  const detail = isError
    ? message || 'The session stopped unexpectedly.'
    : isReconnecting
    ? message || 'The microphone stays open; audio resumes automatically once the socket is back.'
    : 'Waiting for Welcome → Settings → SettingsApplied before the microphone is unlocked.';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`border-b ${tone}`}
    >
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className="flex items-center gap-1.5 font-bold shrink-0">
          {isError ? (
            <WifiOff className="w-4 h-4" aria-hidden="true" />
          ) : isReconnecting ? (
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          )}
          {label}
        </span>
        <span className="flex-1 min-w-[12rem] opacity-90">{detail}</span>
        <span className="flex items-center gap-2 shrink-0">
          {isError && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900/70 hover:bg-slate-900 text-slate-100 font-bold border border-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Start again
            </button>
          )}
          {!isError && (
            <button
              type="button"
              onClick={onStopSession}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900/70 hover:bg-slate-900 text-slate-100 font-bold border border-slate-700 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" aria-hidden="true" />
              Stop
            </button>
          )}
        </span>
      </div>
    </div>
  );
};
