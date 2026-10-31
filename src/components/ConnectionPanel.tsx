import React, { useState } from 'react';
import { Play, Square, Settings, Cpu, Mic, Volume2, ShieldCheck, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { ConnectionStatus, ModelConfig, BackendHealthResponse } from '../types/deepgram';

interface ConnectionPanelProps {
  status: ConnectionStatus;
  health: BackendHealthResponse | null;
  modelConfig: ModelConfig;
  setModelConfig: React.Dispatch<React.SetStateAction<ModelConfig>>;
  onStartSession: () => void;
  onStopSession: () => void;
  errorMessage: string | null;
}

export const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  status,
  health,
  modelConfig,
  setModelConfig,
  onStartSession,
  onStopSession,
  errorMessage,
}) => {
  const [showConfigOptions, setShowConfigOptions] = useState(false);

  const getStatusBadge = () => {
    switch (status) {
      case 'READY':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Session Ready (Streaming Active)
          </span>
        );
      case 'CONNECTING':
      case 'WAITING_FOR_WELCOME':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            Connecting Proxy...
          </span>
        );
      case 'SETTINGS_SENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/30">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            Applying Settings...
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Connection Error
          </span>
        );
      case 'DISCONNECTED':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            <span className="w-2 h-2 rounded-full bg-slate-500" />
            Idle (Disconnected)
          </span>
        );
    }
  };

  const isConnected = status === 'READY' || status === 'CONNECTING' || status === 'WAITING_FOR_WELCOME' || status === 'SETTINGS_SENT';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-5">
      
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-400" />
            Voice Agent Connection
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Backend Proxy & Deepgram WebSocket Protocol Handshake
          </p>
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      {/* Primary Actions */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {!isConnected ? (
          <button
            onClick={onStartSession}
            disabled={!health?.deepgramApiKeyConfigured}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-lg font-bold text-sm transition-all shadow-lg ${
              health?.deepgramApiKeyConfigured
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 shadow-cyan-500/20 active:scale-[0.99] cursor-pointer'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
            }`}
          >
            <Play className="w-4 h-4 fill-current" />
            Start Voice Agent Session
          </button>
        ) : (
          <button
            onClick={onStopSession}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-lg font-bold text-sm bg-rose-600/90 hover:bg-rose-500 text-white transition-all shadow-lg shadow-rose-600/20 active:scale-[0.99] cursor-pointer"
          >
            <Square className="w-4 h-4 fill-current" />
            Stop Session & Clean Up
          </button>
        )}

        <button
          onClick={() => setShowConfigOptions(!showConfigOptions)}
          disabled={isConnected}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-50"
        >
          <Settings className="w-4 h-4" />
          <span>Config Models</span>
          {showConfigOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {errorMessage && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-lg text-xs text-rose-300 font-mono">
          <span className="font-bold text-rose-200">Error:</span> {errorMessage}
        </div>
      )}

      {/* Selected Model Architecture Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Mic className="w-3.5 h-3.5 text-cyan-400" />
            <span>Listening STT</span>
          </div>
          <div className="text-sm font-bold text-slate-200 font-mono">
            {modelConfig.listenModel}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Provider: {modelConfig.listenProvider}
          </div>
        </div>

        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span>Thinking LLM</span>
          </div>
          <div className="text-sm font-bold text-slate-200 font-mono">
            {modelConfig.thinkModel}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Provider: {modelConfig.thinkProvider}
          </div>
        </div>

        <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 mb-1">
            <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Speaking TTS</span>
          </div>
          <div className="text-sm font-bold text-slate-200 font-mono">
            {modelConfig.speakModel}
          </div>
          <div className="text-[11px] text-slate-500 font-mono">
            Provider: {modelConfig.speakProvider} ({modelConfig.speakVersion || 'v2'})
          </div>
        </div>
      </div>

      {/* Collapsible Config Options */}
      {showConfigOptions && !isConnected && (
        <div className="p-4 bg-slate-950/80 rounded-lg border border-slate-800 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Deepgram Settings Configuration
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Listening Model (STT)</label>
              <select
                value={modelConfig.listenModel}
                onChange={(e) => setModelConfig({ ...modelConfig, listenModel: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
              >
                <option value="nova-3">nova-3 (Recommended Default)</option>
                <option value="nova-2">nova-2</option>
                <option value="nova-2-general">nova-2-general</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Thinking Model (LLM)</label>
              <select
                value={modelConfig.thinkModel}
                onChange={(e) => setModelConfig({ ...modelConfig, thinkModel: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
              >
                <option value="gpt-4o-mini">gpt-4o-mini (Recommended Default)</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                <option value="llama-3.3-70b-instruct">llama-3.3-70b-instruct</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Speaking Model (TTS)</label>
              <select
                value={modelConfig.speakModel}
                onChange={(e) => setModelConfig({ ...modelConfig, speakModel: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
              >
                <option value="flux-kit-en">flux-kit-en (Recommended Default)</option>
                <option value="aura-asteria-en">aura-asteria-en</option>
                <option value="aura-luna-en">aura-luna-en</option>
                <option value="aura-stella-en">aura-stella-en</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Protocol Guarantee Note */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-950/40 px-3 py-2 rounded-lg border border-slate-800/60">
        <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
        <span>
          Strict Sequence Enforced: <strong className="text-slate-200">Welcome</strong> → <strong className="text-slate-200">Settings</strong> → <strong className="text-slate-200">SettingsApplied</strong> → Microphone Unlocked.
        </span>
      </div>

    </div>
  );
};
