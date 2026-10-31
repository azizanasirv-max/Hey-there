import React, { useState } from 'react';
import { KeyRound, Copy, Check, ExternalLink, ShieldAlert } from 'lucide-react';

interface ApiKeyWarningBannerProps {
  onRefreshHealth: () => void;
}

export const ApiKeyWarningBanner: React.FC<ApiKeyWarningBannerProps> = ({ onRefreshHealth }) => {
  const [copied, setCopied] = useState(false);

  const copyEnvVar = () => {
    navigator.clipboard.writeText('DEEPGRAM_API_KEY=your_actual_deepgram_api_key');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-gradient-to-r from-amber-950/80 via-slate-900 to-amber-950/80 border border-amber-800/80 rounded-xl p-5 shadow-2xl space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0">
          <KeyRound className="w-6 h-6" />
        </div>
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-amber-200">
              DEEPGRAM_API_KEY Required for Real-Time Streaming
            </h3>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded border border-amber-500/30">
              Server Key Missing
            </span>
          </div>
          <p className="text-xs text-amber-300/80 leading-relaxed">
            The Deepgram Voice Agent API requires an authentic API key. The key remains 100% server-side and is never exposed to the browser.
          </p>
        </div>
      </div>

      <div className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 font-mono text-xs">
        <div className="text-slate-300 truncate">
          <span className="text-cyan-400 font-bold">DEEPGRAM_API_KEY</span>=your_actual_deepgram_api_key
        </div>

        <button
          onClick={copyEnvVar}
          className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors shrink-0 cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied to Clipboard' : 'Copy Key Format'}</span>
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs pt-1">
        <div className="flex items-center gap-2 text-slate-400">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>Get your free key at <a href="https://console.deepgram.com" target="_blank" rel="noreferrer" className="text-cyan-400 underline hover:text-cyan-300">console.deepgram.com</a></span>
        </div>

        <button
          onClick={onRefreshHealth}
          className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors shrink-0 cursor-pointer text-center"
        >
          Re-Check Backend API Key Status
        </button>
      </div>
    </div>
  );
};
