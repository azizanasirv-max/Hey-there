import React, { useState } from 'react';
import { Play, Square, Settings, Cpu, Mic, Volume2, ShieldCheck, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import { ConnectionStatus, ModelConfig, BackendHealthResponse, BackendHealthState } from '../types/deepgram';
import { DEFAULT_TURN_DETECTION, isFluxListenModel } from '../shared/voiceAgentConfig';

interface ConnectionPanelProps {
  status: ConnectionStatus;
  health: BackendHealthResponse | null;
  modelConfig: ModelConfig;
  setModelConfig: React.Dispatch<React.SetStateAction<ModelConfig>>;
  onStartSession: () => void;
  onStopSession: () => void;
  errorMessage: string | null;
  noticeMessage?: string | null;
  healthState?: BackendHealthState;
  healthHttpStatus?: number | null;
  healthMessage?: string | null;
  onRefreshHealth?: () => void;
}

export const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  status,
  health,
  modelConfig,
  setModelConfig,
  onStartSession,
  onStopSession,
  errorMessage,
  noticeMessage,
  healthState = 'unknown',
  healthHttpStatus = null,
  healthMessage = null,
  onRefreshHealth,
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
      case 'RECONNECTING':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Reconnecting (audio kept open)
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

  const canStart = healthState === 'ready' && Boolean(health?.deepgramApiKeyConfigured);
  const isConnected =
    status === 'READY' ||
    status === 'CONNECTING' ||
    status === 'WAITING_FOR_WELCOME' ||
    status === 'SETTINGS_SENT' ||
    status === 'RECONNECTING';

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
            disabled={!canStart}
            title={
              canStart
                ? 'Start a Voice Agent session'
                : healthState === 'starting'
                ? 'Backend is starting (HTTP 202 accepted) — retrying automatically'
                : healthMessage || 'Backend is not ready'
            }
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-5 rounded-lg font-bold text-sm transition-all shadow-lg ${
              canStart
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

      {healthState !== 'ready' && (
        <div
          className={`p-3 rounded-lg text-xs font-mono border ${
            healthState === 'starting'
              ? 'bg-cyan-950/40 border-cyan-800/70 text-cyan-200'
              : healthState === 'unknown'
              ? 'bg-slate-950/60 border-slate-800 text-slate-300'
              : 'bg-rose-950/40 border-rose-800/70 text-rose-200'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <span>
              <span className="font-bold">
                {healthState === 'starting'
                  ? `Backend accepted the request asynchronously (HTTP ${healthHttpStatus ?? 202})`
                  : healthState === 'unknown'
                  ? 'Checking backend…'
                  : `Backend not ready${healthHttpStatus ? ` (HTTP ${healthHttpStatus})` : ''}`}
              </span>
              {healthMessage ? ` — ${healthMessage}` : ''}
            </span>
            {onRefreshHealth && (
              <button
                onClick={onRefreshHealth}
                className="shrink-0 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
              >
                Retry now
              </button>
            )}
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="p-3 bg-rose-950/50 border border-rose-800/80 rounded-lg text-xs text-rose-300 font-mono">
          <span className="font-bold text-rose-200">Error:</span> {errorMessage}
        </div>
      )}

      {noticeMessage && !errorMessage && (
        <div className="p-3 bg-amber-950/40 border border-amber-800/70 rounded-lg text-xs text-amber-200 font-mono">
          <span className="font-bold text-amber-100">Notice:</span> {noticeMessage}
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
                onChange={(e) => {
                  const listenModel = e.target.value;
                  // Flux (v2) is the only family with end-of-turn tuning, so it is
                  // enabled by default there and dropped for nova (v1).
                  setModelConfig({
                    ...modelConfig,
                    listenModel,
                    turnDetection: isFluxListenModel(listenModel)
                      ? modelConfig.turnDetection || { ...DEFAULT_TURN_DETECTION }
                      : undefined,
                  });
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
              >
                <option value="nova-3">nova-3 (Recommended Default)</option>
                <option value="nova-2">nova-2</option>
                <option value="nova-2-general">nova-2-general</option>
                <option value="flux-general-en">flux-general-en (Flux v2 — lowest turn latency)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-400 mb-1">Thinking Model (LLM)</label>
              <select
                value={modelConfig.thinkModel}
                onChange={(e) => setModelConfig({ ...modelConfig, thinkModel: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:border-cyan-500 outline-none"
              >
                <option value="gpt-4o-mini">gpt-4o-mini (Recommended Default — lowest latency)</option>
                <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                <option value="gpt-4.1-nano">gpt-4.1-nano</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
              </select>
              <p className="text-[10px] text-slate-500 mt-1">
                Only models the <span className="font-mono">open_ai</span> provider accepts are listed; anything
                else is rejected by Deepgram with INVALID_SETTINGS.
              </p>
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

          {isFluxListenModel(modelConfig.listenModel) ? (
            <label className="flex items-start gap-2 p-2.5 bg-slate-900/70 rounded border border-slate-800 text-[11px] text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-cyan-500"
                checked={Boolean(modelConfig.turnDetection)}
                onChange={(e) =>
                  setModelConfig({
                    ...modelConfig,
                    turnDetection: e.target.checked ? { ...DEFAULT_TURN_DETECTION } : undefined,
                  })
                }
              />
              <span>
                <span className="font-semibold text-slate-200">Low-latency turn detection</span> — eager end-of-turn{' '}
                {DEFAULT_TURN_DETECTION.eagerEotThreshold} / eot {DEFAULT_TURN_DETECTION.eotThreshold} /{' '}
                {DEFAULT_TURN_DETECTION.eotTimeoutMs} ms cap, so the agent starts thinking before the user's turn is
                fully confirmed (speculative replies).
              </span>
            </label>
          ) : (
            <p className="text-[11px] text-slate-500 leading-relaxed">
              End-of-turn tuning (<code className="text-slate-400">eot_*</code>) is only accepted by Flux (v2) listen
              models. Select <span className="font-mono text-slate-400">flux-general-en</span> to enable it.
            </p>
          )}
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
