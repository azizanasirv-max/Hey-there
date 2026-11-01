import React from 'react';
import { Radio, Server, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { BackendHealthResponse, BackendHealthState } from '../types/deepgram';

interface HeaderProps {
  health: BackendHealthResponse | null;
  activeTab: string;
  setActiveTab: (tab: 'prototype-1' | 'architecture') => void;
  onRefreshHealth: () => void;
  healthState?: BackendHealthState;
  healthHttpStatus?: number | null;
  healthMessage?: string | null;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  activeTab,
  setActiveTab,
  onRefreshHealth,
  healthState = 'unknown',
  healthHttpStatus = null,
  healthMessage = null,
}) => {
  const isKeyConfigured = health?.deepgramApiKeyConfigured ?? false;
  const standaloneUrl = typeof window !== 'undefined' ? `${window.location.origin}/prototype-1` : '/prototype-1';

  /** Full sentence for assistive tech — the visible badge itself is abbreviated. */
  const healthLabel =
    healthState === 'ready'
      ? isKeyConfigured
        ? 'Backend ready'
        : 'Backend ready, Deepgram API key missing'
      : healthState === 'starting'
      ? `Backend starting${healthHttpStatus ? `, HTTP ${healthHttpStatus}` : ''}`
      : healthState === 'unknown'
      ? 'Checking backend'
      : `Backend unavailable${healthHttpStatus ? `, HTTP ${healthHttpStatus}` : ''}`;

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 min-h-16 py-2">
          
          {/* Brand Zone */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Radio className="w-5 h-5 text-slate-950 font-bold animate-pulse" aria-hidden="true" />
            </div>
            <div>
              <div className="font-extrabold text-slate-100 text-base sm:text-lg tracking-tight whitespace-nowrap">
                Deepgram Voice Agent
              </div>
              <div className="text-[10px] text-cyan-400 font-mono hidden sm:block">
                Route: /prototype-1
              </div>
            </div>
          </div>

          {/* Navigation: full-width second row on phones, inline from sm: up */}
          <nav
            aria-label="Sections"
            className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800"
          >
            <button
              type="button"
              onClick={() => setActiveTab('prototype-1')}
              aria-current={activeTab === 'prototype-1' ? 'page' : undefined}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'prototype-1'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              Prototype 1
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('architecture')}
              aria-current={activeTab === 'architecture' ? 'page' : undefined}
              className={`flex-1 sm:flex-none px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'architecture'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              API Spec &amp; Flow
            </button>
          </nav>

          {/* Action Zone: Open in Standalone Tab + Health Badge */}
          <div className="flex items-center gap-2 shrink-0">
            
            {/* Standalone Window Launcher */}
            <a
              href={standaloneUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-bold text-xs transition-all shadow-sm shrink-0 cursor-pointer"
              title="Open this app in its own browser tab (needed for microphone access inside embedded previews)"
            >
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden md:inline">Standalone Tab</span>
              <span className="md:hidden">New Tab</span>
            </a>

            {/* Backend Health Badge */}
            <button
              type="button"
              onClick={onRefreshHealth}
              aria-label={`${healthLabel}. ${healthMessage || 'Activate to re-check backend health status.'}`}
              title={healthMessage || 'Click to re-check backend health status'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                healthState === 'ready'
                  ? isKeyConfigured
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/40'
                    : 'bg-amber-950/40 border-amber-800/60 text-amber-400 hover:bg-amber-900/40'
                  : healthState === 'starting'
                  ? 'bg-cyan-950/40 border-cyan-800/60 text-cyan-300 hover:bg-cyan-900/40'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-400 hover:bg-rose-900/40'
              }`}
            >
              <Server className="w-3.5 h-3.5" aria-hidden="true" />
              {healthState === 'ready' ? (
                isKeyConfigured ? (
                  <span className="flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" aria-hidden="true" />
                    <span className="hidden sm:inline">Backend</span> Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="w-3 h-3 text-amber-400" aria-hidden="true" />
                    Key Missing
                  </span>
                )
              ) : healthState === 'starting' ? (
                <span className="flex items-center gap-1 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse" aria-hidden="true" />
                  <span className="hidden sm:inline">Backend starting</span>
                  <span className="sm:hidden">Starting</span>
                  {healthHttpStatus ? ` (HTTP ${healthHttpStatus})` : ''}
                </span>
              ) : healthState === 'unknown' ? (
                <span className="font-semibold text-slate-300">Checking…</span>
              ) : (
                <span className="font-semibold" title={healthMessage || undefined}>
                  {healthHttpStatus ? `HTTP ${healthHttpStatus}` : 'Offline'}
                </span>
              )}
            </button>

          </div>

        </div>
      </div>
    </header>
  );
};
