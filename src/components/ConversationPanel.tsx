import React, { useRef, useEffect, useState } from 'react';
import { MessageSquare, Trash2, User, Bot, Sparkles, Send, ArrowDown, Volume2, Mic } from 'lucide-react';
import { ConversationMessage } from '../types/deepgram';

interface ConversationPanelProps {
  messages: ConversationMessage[];
  userSpeaking: boolean;
  agentThinking: boolean;
  onClearMessages: () => void;
  onInjectText?: (text: string) => void;
  isConnected: boolean;
  /** Flux speculative window is open (eager end-of-turn received). */
  speculative?: boolean;
  /** STT model actually in use, so the live badge never lies about it. */
  listenModel?: string;
}

export const ConversationPanel: React.FC<ConversationPanelProps> = ({
  messages,
  userSpeaking,
  agentThinking,
  onClearMessages,
  onInjectText,
  isConnected,
  speculative = false,
  listenModel = 'nova-3',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, userSpeaking, agentThinking, autoScroll]);

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !onInjectText || !isConnected) return;
    onInjectText(inputText.trim());
    setInputText('');
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-xl flex flex-col h-[62vh] min-h-[380px] sm:h-[520px]">
      
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-slate-900/90 rounded-t-xl shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 className="text-sm font-bold text-slate-100 truncate">Live Conversation Feed</h2>
          <span className="text-xs font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded-full border border-slate-800 shrink-0">
            {messages.length} messages
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            aria-pressed={autoScroll}
            aria-label={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            className={`p-1.5 rounded text-xs transition-colors cursor-pointer ${
              autoScroll ? 'text-cyan-400 bg-cyan-500/10' : 'text-slate-500 hover:text-slate-300'
            }`}
            title={autoScroll ? 'Auto-scroll active' : 'Auto-scroll paused'}
          >
            <ArrowDown className="w-4 h-4" aria-hidden="true" />
          </button>
          
          <button
            type="button"
            onClick={onClearMessages}
            disabled={messages.length === 0}
            aria-label="Clear conversation"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Clear Conversation"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Live Conversation Stream Area */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation transcript"
        className="flex-1 p-4 overflow-y-auto space-y-4 bg-slate-950/50 font-sans"
      >
        {messages.length === 0 && !userSpeaking && !agentThinking ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-600">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <div className="font-semibold text-slate-300 text-sm">No Conversation Events Yet</div>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Start a session and speak into your microphone. Customer transcriptions and AI assistant responses will appear here in real-time.
              </p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                      isUser
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                    }`}
                  >
                    {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>

                  <div className={`max-w-[80%] space-y-1 ${isUser ? 'text-right' : 'text-left'}`}>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                      <span>{isUser ? 'Customer Speech' : 'Deepgram Voice AI'}</span>
                      <span>·</span>
                      <span>{msg.timestamp}</span>
                      {typeof msg.turnId === 'number' && msg.turnId > 0 && (
                        <span className="text-slate-600">turn {msg.turnId}</span>
                      )}
                      {msg.behavior && msg.behavior !== 'default' && (
                        <span className="text-[10px] text-amber-400/80 border border-amber-500/30 rounded px-1">
                          {msg.behavior}
                        </span>
                      )}
                    </div>

                    <div
                      className={`p-3.5 rounded-2xl text-sm leading-relaxed shadow-sm font-sans ${
                        isUser
                          ? 'bg-cyan-950/60 text-cyan-100 border border-cyan-800/60 rounded-tr-none'
                          : 'bg-slate-900 text-slate-100 border border-slate-800 rounded-tl-none'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* User Speaking Live Badge */}
            {userSpeaking && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/60 text-cyan-300 text-xs font-medium animate-pulse">
                <Mic className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
                <span>
                  Customer is speaking... Deepgram{' '}
                  <span className="font-mono text-cyan-200">{listenModel}</span> listening in real time.
                </span>
              </div>
            )}

            {/* Speculative (eager end-of-turn) badge */}
            {speculative && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-violet-950/40 border border-violet-800/60 text-violet-200 text-xs font-medium">
                <Sparkles className="w-4 h-4 text-violet-300 shrink-0 animate-pulse" />
                <span>
                  Eager end-of-turn — drafting a reply before the turn is confirmed. If you keep talking, the draft is
                  discarded automatically.
                </span>
              </div>
            )}

            {/* Agent Thinking Live Badge */}
            {agentThinking && (
              <div className="flex items-center gap-2.5 p-3 rounded-xl bg-indigo-950/40 border border-indigo-800/60 text-indigo-300 text-xs font-medium animate-pulse">
                <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>Deepgram Voice Agent thinking (LLM processing)...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Manual Text Injection Form */}
      <form onSubmit={handleSendText} className="p-3 border-t border-slate-800 bg-slate-900 rounded-b-xl flex gap-2">
        <label htmlFor="inject-text-input" className="sr-only">
          Text prompt to send to the voice agent
        </label>
        <input
          id="inject-text-input"
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          autoComplete="off"
          placeholder={isConnected ? "Inject text prompt to test Voice Agent response..." : "Connect session to enable text input"}
          disabled={!isConnected}
          className="flex-1 min-w-0 bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-lg px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!isConnected || !inputText.trim()}
          className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <span>Inject</span>
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </form>

    </div>
  );
};
