import React from 'react';
import { Radio, Server, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { BackendHealthResponse } from '../types/deepgram';

interface HeaderProps {
  health: BackendHealthResponse | null;
  activeTab: string;
  setActiveTab: (tab: 'prototype-1' | 'architecture') => void;
  onRefreshHealth: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  health,
  activeTab,
  setActiveTab,
  onRefreshHealth,
}) => {
  const isKeyConfigured = health?.deepgramApiKeyConfigured ?? false;
  const standaloneUrl = typeof window !== 'undefined' ? `${window.location.origin}/prototype-1` : '/prototype-1';

  return (
    <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Brand Zone */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Radio className="w-5 h-5 text-slate-950 font-bold animate-pulse" />
            </div>
            <div>
              <div className="font-extrabold text-slate-100 text-lg tracking-tight whitespace-nowrap">
                Deepgram Voice Agent
              </div>
              <div className="text-[10px] text-cyan-400 font-mono hidden sm:block">
                Route: /prototype-1
              </div>
            </div>
          </div>

          {/* Navigation Links & Standalone Tab Switcher */}
          <nav className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => setActiveTab('prototype-1')}
              className={`px-3.5 py-1.5 text-xs sm:text-sm font-bold rounded-md transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'prototype-1'
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              Prototype 1
            </button>
            <button
              onClick={() => setActiveTab('architecture')}
              className={`px-3.5 py-1.5 text-xs sm:text-sm font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'architecture'
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              API Spec & Flow
            </button>
          </nav>

          {/* Action Zone: Open in Standalone Tab + Health Badge */}
          <div className="flex items-center gap-2.5 shrink-0">
            
            {/* Standalone Window Launcher */}
            <a
              href={standaloneUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-bold text-xs transition-all shadow-sm shrink-0 cursor-pointer"
              title="Open the actual application directly in its own standalone browser page outside iframe"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Standalone Tab</span>
              <span className="md:hidden">New Tab</span>
            </a>

            {/* Backend Health Badge */}
            <button
              onClick={onRefreshHealth}
              title="Click to re-check backend health status"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                health?.status === 'ok'
                  ? isKeyConfigured
                    ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/40'
                    : 'bg-amber-950/40 border-amber-800/60 text-amber-400 hover:bg-amber-900/40'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-400 hover:bg-rose-900/40'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              {health?.status === 'ok' ? (
                isKeyConfigured ? (
                  <span className="flex items-center gap-1 font-semibold">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span className="hidden sm:inline">Backend</span> Ready
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    Key Missing
                  </span>
                )
              ) : (
                <span className="font-semibold">Backend Offline</span>
              )}
            </button>

          </div>

        </div>
      </div>
    </header>
  );
};
