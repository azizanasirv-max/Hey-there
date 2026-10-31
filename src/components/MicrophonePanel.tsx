import React from 'react';
import { Mic, MicOff, Radio, VolumeX, ShieldAlert, Check } from 'lucide-react';

interface MicrophonePanelProps {
  permissionStatus: 'granted' | 'denied' | 'prompt' | 'unsupported';
  isStreaming: boolean;
  isMuted: boolean;
  volumeLevel: number; // 0 - 100
  onToggleMute: () => void;
  onRequestPermission: () => void;
}

export const MicrophonePanel: React.FC<MicrophonePanelProps> = ({
  permissionStatus,
  isStreaming,
  isMuted,
  volumeLevel,
  onToggleMute,
  onRequestPermission,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-4">
      
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Mic className={`w-4 h-4 ${isStreaming && !isMuted ? 'text-cyan-400' : 'text-slate-400'}`} />
          <h2 className="text-sm font-bold text-slate-100">Microphone Input & Stream</h2>
        </div>
        
        {/* Permission Badge */}
        <div>
          {permissionStatus === 'granted' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
              <Check className="w-3 h-3" />
              Mic Permission Granted
            </span>
          ) : permissionStatus === 'denied' ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 px-2.5 py-0.5 rounded-full border border-rose-500/20">
              <ShieldAlert className="w-3 h-3" />
              Mic Permission Denied
            </span>
          ) : (
            <button
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
        
        {/* Status indicator */}
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
            isStreaming
              ? isMuted
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 shadow-lg shadow-cyan-500/20'
              : 'bg-slate-800 text-slate-500 border border-slate-700'
          }`}>
            {isStreaming ? (
              isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 animate-pulse" />
            ) : (
              <MicOff className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="text-sm font-bold text-slate-200">
              {isStreaming ? (isMuted ? 'Microphone Muted' : 'Microphone Live Streaming') : 'Microphone Inactive'}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Format: 24,000 Hz · Int16 PCM (Linear16)
            </div>
          </div>
        </div>

        {/* Mute Button */}
        {isStreaming && (
          <button
            onClick={onToggleMute}
            className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              isMuted
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700'
            }`}
          >
            {isMuted ? <Mic className="w-4 h-4 text-amber-400" /> : <MicOff className="w-4 h-4 text-slate-400" />}
            <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
          </button>
        )}

      </div>

      {/* Audio Level VU Meter */}
      <div className="space-y-1.5">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            Live Audio Level (RMS)
          </span>
          <span className="font-mono font-bold text-slate-300">{volumeLevel}%</span>
        </div>

        {/* Level Bar */}
        <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden p-0.5 border border-slate-800">
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

      {/* Discarded Binary Audio Notice */}
      <div className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
          <VolumeX className="w-3.5 h-3.5 text-cyan-400" />
          <span>Browser Text-Only Mode Active</span>
        </div>
        <p className="leading-relaxed">
          Deepgram TTS binary audio output is received by the proxy and discarded immediately before reaching the browser. No audio playback elements are instantiated.
        </p>
      </div>

    </div>
  );
};
