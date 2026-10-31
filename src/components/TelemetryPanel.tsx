import React from 'react';
import { Clock, MessageSquare, Volume2, Radio, AlertOctagon, Activity, Timer, ArrowRightLeft, Gauge } from 'lucide-react';
import { SessionTelemetry, PlayerStatus } from '../types/deepgram';

interface TelemetryPanelProps {
  telemetry: SessionTelemetry;
  playerStatus: PlayerStatus;
}

const formatMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? '—' : `${ms} ms`);

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ telemetry, playerStatus }) => {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}:${secs
        .toString()
        .padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const latency = telemetry.latency;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Session Usage, Latency & Audio Telemetry
        </h2>
        <span className="text-xs text-slate-400 font-mono">Live Telemetry</span>
      </div>

      {/* Latency breakdown (measured, not estimated) */}
      <div className="space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <Timer className="w-3.5 h-3.5 text-cyan-400" />
          Measured turn latency
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-0.5">
            <div className="text-[10px] text-slate-400">Speech → first text</div>
            <div className="text-lg font-extrabold text-cyan-300 font-mono">{formatMs(latency.speechStartToFirstTextMs)}</div>
          </div>
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-0.5">
            <div className="text-[10px] text-slate-400">Speech → first audio</div>
            <div className="text-lg font-extrabold text-emerald-300 font-mono">{formatMs(latency.speechStartToFirstAudioMs)}</div>
          </div>
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-0.5">
            <div className="text-[10px] text-slate-400">Playback buffering</div>
            <div className="text-lg font-extrabold text-indigo-300 font-mono">{formatMs(latency.firstAudioBufferingMs)}</div>
          </div>
          <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-0.5">
            <div className="text-[10px] text-slate-400">Settings → audio (proxy)</div>
            <div className="text-lg font-extrabold text-blue-300 font-mono">{formatMs(latency.settingsToFirstAudioMs)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">STT</span>
            <span className="text-xs font-bold text-slate-200 font-mono">{formatMs(latency.sttMs)}</span>
          </div>
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">LLM first token</span>
            <span className="text-xs font-bold text-slate-200 font-mono">{formatMs(latency.thinkMs)}</span>
          </div>
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">TTS first byte</span>
            <span className="text-xs font-bold text-slate-200 font-mono">{formatMs(latency.ttsMs)}</span>
          </div>
          <div className="bg-slate-950/70 p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Gauge className="w-3 h-3 text-cyan-400" /> Total (Deepgram)
            </span>
            <span className="text-xs font-bold text-cyan-300 font-mono">{formatMs(latency.totalMs)}</span>
          </div>
        </div>
        <p className="text-[10px] text-slate-500">
          STT / LLM / TTS / total come from Deepgram's per-turn <code className="text-slate-400">LatencyReport</code>{' '}
          event; the other four are measured in this browser and the local proxy.
        </p>
      </div>

      {/* Session counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Session Duration</span>
          </div>
          <div className="text-xl font-extrabold text-slate-100 font-mono tracking-tight">
            {formatDuration(telemetry.durationSeconds)}
          </div>
        </div>

        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
            <span>Text Events</span>
          </div>
          <div className="text-xl font-extrabold text-slate-100 font-mono tracking-tight">
            {telemetry.receivedTextEvents}
          </div>
        </div>

        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Agent Audio</span>
          </div>
          <div className="text-xl font-extrabold text-indigo-300 font-mono tracking-tight">
            {telemetry.agentAudioFrames}
            <span className="text-xs font-normal text-slate-500 ml-1">frames</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">{formatBytes(telemetry.agentAudioBytes)}</div>
        </div>

        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mic PCM Frames</span>
          </div>
          <div className="text-xl font-extrabold text-slate-100 font-mono tracking-tight">
            {telemetry.sentAudioChunks}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            {formatBytes(telemetry.sentAudioBytes)} · {telemetry.droppedAudioFrames} dropped
          </div>
        </div>

        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            <span>Failures / Reconnects</span>
          </div>
          <div className="text-xl font-extrabold text-rose-400 font-mono tracking-tight">
            {telemetry.connectionFailures}
            <span className="text-sm text-slate-400 font-normal"> / {telemetry.reconnects}</span>
          </div>
        </div>
      </div>

      {/* Playback health */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 bg-slate-950/50 px-3 py-2 rounded-lg border border-slate-800/60 font-mono">
        <span className="flex items-center gap-1.5">
          <ArrowRightLeft className="w-3.5 h-3.5 text-cyan-400" />
          Playback queue: <strong className={playerStatus.bufferedMs > 1500 ? 'text-amber-400' : 'text-slate-200'}>{playerStatus.bufferedMs} ms</strong>
        </span>
        <span>·</span>
        <span>frames played: <strong className="text-slate-200">{playerStatus.framesPlayed}</strong></span>
        <span>·</span>
        <span>underruns: <strong className={playerStatus.underruns > 0 ? 'text-amber-400' : 'text-slate-200'}>{playerStatus.underruns}</strong></span>
        <span>·</span>
        <span>dropped: <strong className="text-slate-200">{playerStatus.framesDropped}</strong></span>
      </div>
    </div>
  );
};
