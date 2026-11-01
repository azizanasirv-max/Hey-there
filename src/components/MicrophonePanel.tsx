import React from 'react';
import { Mic, MicOff, Radio, Volume2, ShieldAlert, Check, RefreshCw, AlertTriangle, Activity } from 'lucide-react';
import { MicStatus, PlayerStatus } from '../types/deepgram';

interface MicrophonePanelProps {
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'unsupported';
  isStreaming: boolean;
  isMuted: boolean;
  volumeLevel: number; // 0 - 100
  micStatus: MicStatus;
  playerStatus: PlayerStatus;
  onToggleMute: () => void;
  onRequestPermission: () => void;
  onRetryAudio: () => void;
}

export const MicrophonePanel: React.FC<MicrophonePanelProps> = ({
  permissionStatus,
  isStreaming,
  isMuted,
  volumeLevel,
  micStatus,
  playerStatus,
  onToggleMute,
  onRequestPermission,
  onRetryAudio,
}) => {
  const contextOk = micStatus.contextState === null || micStatus.contextState === 'running';
  const trackLive = micStatus.trackState === 'live';
  const captureDegraded = isStreaming && (!contextOk || !trackLive);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Mic className={`w-4 h-4 ${isStreaming && !isMuted ? 'text-cyan-400' : 'text-slate-400'}`} aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-100">Microphone &amp; Speaker Audio</h2>
        </div>

        {/* Permission Badge */}
        <div>
          {permissionStatus === 'granted' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              <Check className="w-3 h-3" aria-hidden="true" />
              Mic Permission Granted
            </span>
          ) : permissionStatus === 'denied' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/20">
              <ShieldAlert className="w-3 h-3" aria-hidden="true" />
              Mic Permission Denied
            </span>
          ) : permissionStatus === 'unsupported' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              Mic Unavailable
            </span>
          ) : (
            <button
              type="button"
              onClick={onRequestPermission}
              className="text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 px-2.5 py-0.5 rounded-full border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors cursor-pointer"
            >
              Grant Microphone Access
            </button>
          )}
        </div>
      </div>

      {/* Mic Status & Mute Control */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-slate-950/70 p-4 rounded-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              isStreaming && !captureDegraded
                ? isMuted
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-lg shadow-cyan-500/20'
                : 'bg-slate-800 text-slate-500 border border-slate-700'
            }`}
          >
            {isStreaming && !isMuted ? <Mic className="w-5 h-5 animate-pulse" /> : <MicOff className="w-5 h-5" />}
          </div>

          <div aria-live="polite">
            <div className="text-sm font-bold text-slate-200">
              {isStreaming
                ? captureDegraded
                  ? 'Microphone Degraded (recovering)'
                  : isMuted
                  ? 'Microphone Muted (sending silence)'
                  : 'Microphone Live Streaming'
                : 'Microphone Inactive'}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              {isStreaming
                ? `${(micStatus.captureSampleRate ?? 0).toLocaleString()} Hz in → 24,000 Hz · Int16 PCM · ${micStatus.backend ?? 'n/a'}`
                : 'Format: 24,000 Hz · Int16 PCM (Linear16)'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isStreaming && (
            <button
              type="button"
              onClick={onToggleMute}
              aria-pressed={isMuted}
              aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone (keeps the session alive with silence frames)'}
              className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isMuted
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
              }`}
            >
              {isMuted ? (
                <Mic className="w-4 h-4 text-amber-400" aria-hidden="true" />
              ) : (
                <MicOff className="w-4 h-4 text-slate-400" aria-hidden="true" />
              )}
              <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
            </button>
          )}
          {captureDegraded && (
            <button
              type="button"
              onClick={onRetryAudio}
              aria-label="Restart audio capture"
              title="Restart the audio capture graph"
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Restart Audio</span>
            </button>
          )}
        </div>
      </div>

      {/* Audio Level VU Meter */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            Live Microphone Level (RMS)
          </span>
          <span className="font-mono font-bold text-slate-300">{volumeLevel}%</span>
        </div>

        <div
          role="progressbar"
          aria-label="Live microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={volumeLevel}
          aria-valuetext={`${volumeLevel}% of full scale`}
          className="w-full bg-slate-950 h-3 rounded-full overflow-hidden p-0.5 border border-slate-800"
        >
          <div
            className={`h-full rounded-full transition-all duration-75 ${
              volumeLevel > 85
                ? 'bg-rose-500'
                : volumeLevel > 60
                ? 'bg-amber-400'
                : 'bg-gradient-to-r from-cyan-500 to-emerald-400'
            }`}
            style={{ width: `${Math.max(2, volumeLevel)}%` }}
          />
        </div>
      </div>

      {/* Real audio-state read-out (never decorative) */}
      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
        <div className="p-2 bg-slate-950/60 rounded border border-slate-800">
          <div className="text-slate-500">Mic track</div>
          <div className={trackLive ? 'text-emerald-400 font-bold' : 'text-slate-400 font-bold'}>
            {micStatus.trackState ?? 'none'}
          </div>
        </div>
        <div className="p-2 bg-slate-950/60 rounded border border-slate-800">
          <div className="text-slate-500">Capture context</div>
          <div className={contextOk ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
            {micStatus.contextState ?? 'closed'}
          </div>
        </div>
        <div className="p-2 bg-slate-950/60 rounded border border-slate-800">
          <div className="text-slate-500">Uplink drops</div>
          <div className="text-slate-300 font-bold">{micStatus.droppedFrames}</div>
        </div>
        <div className="p-2 bg-slate-950/60 rounded border border-slate-800">
          <div className="text-slate-500">Playback context</div>
          <div className={playerStatus.contextState === 'running' || playerStatus.contextState === null ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
            {playerStatus.contextState ?? 'closed'}
          </div>
        </div>
      </div>

      {/* Agent voice playback status */}
      <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <Volume2 className={`w-3.5 h-3.5 ${playerStatus.playing ? 'text-emerald-400' : 'text-cyan-400'}`} />
            <span>Agent Voice Playback</span>
          </div>
          <span
            className={`inline-flex items-center gap-1 font-bold ${
              playerStatus.playing ? 'text-emerald-400' : 'text-slate-500'
            }`}
          >
            <Activity className="w-3 h-3" />
            {playerStatus.playing ? 'Speaking' : 'Idle'}
          </span>
        </div>
        <p className="leading-relaxed">
          Deepgram TTS PCM (linear16, 24 kHz) is forwarded by the proxy and played through a scheduled Web Audio
          queue. Buffered: <span className="text-slate-200 font-mono">{playerStatus.bufferedMs} ms</span> · Frames:{' '}
          <span className="text-slate-200 font-mono">{playerStatus.framesPlayed}</span> · Underruns:{' '}
          <span className={playerStatus.underruns > 0 ? 'text-amber-400 font-mono' : 'text-slate-200 font-mono'}>
            {playerStatus.underruns}
          </span>{' '}
          · Dropped: <span className="text-slate-200 font-mono">{playerStatus.framesDropped}</span>
        </p>
      </div>
    </div>
  );
};
