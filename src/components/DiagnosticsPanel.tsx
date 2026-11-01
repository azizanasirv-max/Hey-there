import React, { useState } from 'react';
import { Terminal, Trash2, Filter, ChevronRight, ChevronDown, CheckCircle2, AlertTriangle, AlertCircle, Info, VolumeX } from 'lucide-react';
import { DeepgramEvent } from '../types/deepgram';

interface DiagnosticsPanelProps {
  events: DeepgramEvent[];
  onClearEvents: () => void;
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  events,
  onClearEvents,
}) => {
  const [filter, setFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredEvents = events.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'audio') return e.category === 'audio';
    if (filter === 'agent') return e.category === 'agent' || e.category === 'user';
    if (filter === 'settings') return e.category === 'settings' || e.category === 'connection';
    if (filter === 'errors') return e.category === 'error';
    return true;
  });

  const getEventIcon = (type: string, category: string) => {
    if (category === 'error' || type === 'Error') {
      return <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
    }
    if (type === 'Warning') {
      return <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (type === 'SettingsApplied' || type === 'Welcome') {
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    if (category === 'audio' || type === 'LatencyReport' || type === 'AgentAudioStats') {
      return <VolumeX className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
    }
    return <Info className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  };

  const FILTERS = [
    { id: 'all', label: 'All', activeClass: 'bg-slate-800 text-slate-100 font-bold' },
    { id: 'settings', label: 'Handshake', activeClass: 'bg-slate-800 text-cyan-300 font-bold' },
    { id: 'agent', label: 'Agent', activeClass: 'bg-slate-800 text-indigo-300 font-bold' },
    { id: 'audio', label: 'Audio / Latency', activeClass: 'bg-slate-800 text-emerald-300 font-bold' },
    { id: 'errors', label: 'Errors', activeClass: 'bg-slate-800 text-rose-300 font-bold' },
  ] as const;

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl flex flex-col h-[62vh] min-h-[380px] sm:h-[520px]">
      
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 rounded-t-xl shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-100 truncate">Diagnostics &amp; Event Log</h2>
          <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800 shrink-0">
            {events.length} events
          </span>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {/* Category Filter Pills */}
          <div
            role="group"
            aria-label="Filter protocol events"
            className="flex items-center gap-1 flex-wrap bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px] font-medium"
          >
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer whitespace-nowrap ${
                  filter === f.id ? f.activeClass : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClearEvents}
            disabled={events.length === 0}
            aria-label="Clear event log"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer shrink-0"
            title="Clear Event Log"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Event Stream Log */}
      <div
        role="log"
        aria-label="Protocol event log"
        className="flex-1 p-3 overflow-y-auto space-y-2 bg-slate-950 font-mono text-xs"
      >
        {filteredEvents.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 text-xs text-center px-4">
            {events.length === 0
              ? 'No protocol events yet. Start a session to see the Welcome → Settings → SettingsApplied handshake.'
              : `No events match the "${FILTERS.find((f) => f.id === filter)?.label}" filter.`}
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const isExpanded = expandedId === ev.id;
            return (
              <div
                key={ev.id}
                className={`rounded-lg border transition-all ${
                  ev.type === 'Error'
                    ? 'bg-rose-950/30 border-rose-900/60 text-rose-200'
                    : ev.type === 'SettingsApplied'
                    ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-200'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                {/* A real <button> keeps the row reachable with Tab/Enter/Space. */}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : ev.id)}
                  aria-expanded={isExpanded}
                  aria-label={`${ev.type} event at ${ev.timestamp}, ${isExpanded ? 'collapse' : 'expand'} details`}
                  className="w-full p-2.5 flex items-center justify-between gap-3 cursor-pointer select-none text-left bg-transparent border-0"
                >
                  <span className="flex items-center gap-2 truncate">
                    {getEventIcon(ev.type, ev.category)}
                    <span className="font-bold text-slate-100">{ev.type}</span>
                    <span className="text-[10px] text-slate-500 font-sans">[{ev.category}]</span>
                  </span>

                  <span className="flex items-center gap-2 text-[11px] text-slate-500 shrink-0">
                    <span>{ev.timestamp}</span>
                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-1 border-t border-slate-800/80 text-[11px] text-slate-300 space-y-2">
                    <pre className="p-2.5 bg-slate-950 rounded border border-slate-800/80 overflow-x-auto text-emerald-400 leading-relaxed font-mono whitespace-pre-wrap break-words">
                      {JSON.stringify(ev.rawJson, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

    </div>
  );
};
