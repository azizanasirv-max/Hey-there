import React from 'react';
import { Clock, MessageSquare, VolumeX, Radio, AlertOctagon, Activity } from 'lucide-react';
import { SessionTelemetry } from '../types/deepgram';

interface TelemetryPanelProps {
  telemetry: SessionTelemetry;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ telemetry }) => {
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${(mins % 60).toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          Session Usage & Telemetry Metrics
        </h2>
        <span className="text-xs text-slate-400 font-mono">Live Telemetry</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        
        {/* Session Duration */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span>Session Duration</span>
          </div>
          <div className="text-xl font-extrabold text-slate-100 font-mono tracking-tight">
            {formatDuration(telemetry.durationSeconds)}
          </div>
        </div>

        {/* Text Events Received */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
            <span>Text Events</span>
          </div>
          <div className="text-xl font-extrabold text-slate-100 font-mono tracking-tight">
            {telemetry.receivedTextEvents}
          </div>
        </div>

        {/* Discarded Audio Frames */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <VolumeX className="w-3.5 h-3.5 text-indigo-400" />
            <span>Discarded Audio</span>
          </div>
          <div className="text-xl font-extrabold text-indigo-300 font-mono tracking-tight">
            {telemetry.discardedAudioFrames}
            <span className="text-xs font-normal text-slate-500 ml-1">frames</span>
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            {formatBytes(telemetry.discardedAudioBytes)}
          </div>
        </div>

        {/* Sent Audio Chunks */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Sent PCM Chunks</span>
          </div>
          <div className="text-xl font-extrabold text-slate-100 font-mono tracking-tight">
            {telemetry.sentAudioChunks}
          </div>
        </div>

        {/* Connection Failures */}
        <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            <span>Failures</span>
          </div>
          <div className="text-xl font-extrabold text-rose-400 font-mono tracking-tight">
            {telemetry.connectionFailures}
          </div>
        </div>

      </div>
    </div>
  );
};
