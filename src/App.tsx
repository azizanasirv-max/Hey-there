import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { ConnectionPanel } from './components/ConnectionPanel';
import { MicrophonePanel } from './components/MicrophonePanel';
import { ConversationPanel } from './components/ConversationPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { ApiKeyWarningBanner } from './components/ApiKeyWarningBanner';
import { ArchitectureView } from './components/ArchitectureView';
import { AudioStreamer, AudioStreamerState, MicFailureReason } from './utils/audioStreamer';
import { PcmAudioPlayer, PlayerStats } from './utils/audioPlayer';
import { VoiceAgentSession } from './utils/voiceAgentSession';
import {
  ConnectionStatus,
  ModelConfig,
  BackendHealthResponse,
  ConversationMessage,
  DeepgramEvent,
  SessionTelemetry,
  LatencyMetrics,
  MicStatus,
  EMPTY_LATENCY,
} from './types/deepgram';
import { DEFAULT_AGENT_CONFIG } from './shared/voiceAgentConfig';
import { MonitorCheck } from 'lucide-react';


const EMPTY_TELEMETRY: SessionTelemetry = {
  startTime: null,
  durationSeconds: 0,
  receivedTextEvents: 0,
  sentAudioChunks: 0,
  sentAudioBytes: 0,
  droppedAudioFrames: 0,
  agentAudioFrames: 0,
  agentAudioBytes: 0,
  connectionFailures: 0,
  reconnects: 0,
  latency: EMPTY_LATENCY,
};

const EMPTY_MIC_STATUS: MicStatus = {
  streaming: false,
  contextState: null,
  trackState: null,
  captureSampleRate: null,
  backend: null,
  droppedFrames: 0,
};

const EMPTY_PLAYER_STATUS: PlayerStats = {
  playing: false,
  contextState: null,
  framesQueued: 0,
  framesPlayed: 0,
  framesDropped: 0,
  underruns: 0,
  lastFirstAudibleDelayMs: null,
  bufferedMs: 0,
};

export default function App() {
  // Client-side URL route management for /prototype-1
  const getRouteFromLocation = (): 'prototype-1' | 'architecture' => {
    if (typeof window === 'undefined') return 'prototype-1';
    const path = window.location.pathname;
    if (path.startsWith('/architecture')) return 'architecture';
    return 'prototype-1';
  };

  const [activeTab, setActiveTabState] = useState<'prototype-1' | 'architecture'>(getRouteFromLocation);
  const [isIframe, setIsIframe] = useState(false);

  const setActiveTab = (tab: 'prototype-1' | 'architecture') => {
    setActiveTabState(tab);
    const targetPath = tab === 'prototype-1' ? '/prototype-1' : `/${tab}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState(null, '', targetPath);
    }
  };

  useEffect(() => {
    setIsIframe(window.self !== window.top);

    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState(null, '', '/prototype-1');
    }

    const handlePopState = () => setActiveTabState(getRouteFromLocation());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Backend Health
  const [health, setHealth] = useState<BackendHealthResponse | null>(null);

  // Connection State
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Model Configuration (single source of truth, shared with the proxy)
  const [modelConfig, setModelConfig] = useState<ModelConfig>({ ...DEFAULT_AGENT_CONFIG });

  // Audio & Microphone State
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [micStatus, setMicStatus] = useState(EMPTY_MIC_STATUS);
  const [playerStatus, setPlayerStatus] = useState<PlayerStats>(EMPTY_PLAYER_STATUS);

  // Live Conversation & Diagnostics
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<DeepgramEvent[]>([]);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);

  // Telemetry Metrics
  const [telemetry, setTelemetry] = useState<SessionTelemetry>(EMPTY_TELEMETRY);

  // Refs
  const sessionRef = useRef<VoiceAgentSession | null>(null);
  const streamerRef = useRef<AudioStreamer>(new AudioStreamer());
  const playerRef = useRef<PcmAudioPlayer>(new PcmAudioPlayer());
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const volumeRef = useRef(0);
  const lastVolumeCommitRef = useRef(0);
  const statsDirtyRef = useRef(false);
  const pendingStatsRef = useRef({
    sentAudioChunks: 0,
    sentAudioBytes: 0,
    droppedAudioFrames: 0,
    agentAudioFrames: 0,
    agentAudioBytes: 0,
    receivedTextEvents: 0,
  });
  const turnRef = useRef<{
    userStartedAt: number | null;
    firstTextAt: number | null;
    firstAudioAt: number | null;
  }>({ userStartedAt: null, firstTextAt: null, firstAudioAt: null });
  const micRecoveryRef = useRef<{ lastAttemptAt: number; attempts: number }>({ lastAttemptAt: 0, attempts: 0 });
  const playerStatsRef = useRef<PlayerStats>(EMPTY_PLAYER_STATUS);
  const sessionStartedRef = useRef(false);

  // 1. Fetch Backend Health
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data: BackendHealthResponse = await res.json();
        setHealth(data);
      } else {
        setHealth(null);
      }
    } catch (e) {
      console.error('Health check failed:', e);
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  // Session Duration Timer
  useEffect(() => {
    if (status === 'READY') {
      if (!telemetry.startTime) setTelemetry((prev) => ({ ...prev, startTime: Date.now() }));
      timerIntervalRef.current = setInterval(() => {
        setTelemetry((prev) => ({
          ...prev,
          durationSeconds: prev.startTime
            ? Math.floor((Date.now() - prev.startTime) / 1000)
            : prev.durationSeconds + 1,
        }));
      }, 1000);
    } else if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [status, telemetry.startTime]);

  /**
   * Telemetry is batched: audio callbacks only mutate refs; React state is
   * committed at most once per second. This is what removes ~100 renders/s.
   */
  const flushStats = useCallback(() => {
    if (!statsDirtyRef.current) return;
    statsDirtyRef.current = false;
    const pending = pendingStatsRef.current;
    setTelemetry((prev) => ({
      ...prev,
      sentAudioChunks: pending.sentAudioChunks,
      sentAudioBytes: pending.sentAudioBytes,
      droppedAudioFrames: pending.droppedAudioFrames,
      agentAudioFrames: pending.agentAudioFrames,
      agentAudioBytes: pending.agentAudioBytes,
      receivedTextEvents: pending.receivedTextEvents,
      latency: {
        ...prev.latency,
        firstAudioBufferingMs: playerRef.current.getStats().lastFirstAudibleDelayMs,
        settingsToFirstAudioMs: prev.latency.settingsToFirstAudioMs,
      },
    }));
  }, []);

  // Playback stats arrive per frame (~50/s) — buffer them in a ref and publish
  // them once per second so audio never drives React render cadence.
  useEffect(() => {
    playerRef.current.onStats = (stats: PlayerStats) => {
      playerStatsRef.current = stats;
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      flushStats();
      setPlayerStatus({ ...playerStatsRef.current });
    }, 1000);
    return () => clearInterval(interval);
  }, [flushStats]);

  // Add Event to Diagnostics
  const logEvent = useCallback((type: string, category: DeepgramEvent['category'], rawJson: any) => {
    const newEvent: DeepgramEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      category,
      rawJson,
    };
    setEvents((prev) => [newEvent, ...prev.slice(0, 199)]);
  }, []);

  // ------------------------------------------------------------ audio plumbing
  const streamerHandlers = useCallback(
    () => ({
      onLevel: (level: number) => {
        volumeRef.current = level;
      },
      onFrameSent: (bytes: number) => {
        pendingStatsRef.current.sentAudioChunks += 1;
        pendingStatsRef.current.sentAudioBytes += bytes;
        statsDirtyRef.current = true;
      },
      onFrameDropped: () => {
        pendingStatsRef.current.droppedAudioFrames += 1;
        statsDirtyRef.current = true;
      },
      onStateChange: (state: AudioStreamerState) => {
        setMicStatus({
          streaming: state.streaming,
          contextState: state.contextState,
          trackState: state.trackState,
          captureSampleRate: state.captureSampleRate,
          backend: state.backend,
          droppedFrames: state.droppedFrames,
        });
      },
      onFailure: (reason: MicFailureReason, message: string) => {
        void handleMicFailure(reason, message);
      },
      onDeviceLost: () => {
        setUserSpeaking(false);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Start (or re-point) the microphone stream into the live session. */
  const ensureAudioRunning = useCallback(async () => {
    try {
      await streamerRef.current.startStreaming(
        (frame) => sessionRef.current?.sendAudio(frame) ?? false,
        streamerHandlers()
      );
      setErrorMessage((prev) => (prev && prev.toLowerCase().includes('audio') ? null : prev));
    } catch (err: any) {
      const message = err?.message || 'Audio streaming failed';
      setErrorMessage(message);
      if (err?.micReason === 'permission-denied') setPermissionStatus('denied');
    }
  }, [streamerHandlers]);

  /** Bounded microphone recovery: never loops, never leaves audio silently dead. */
  const handleMicFailure = useCallback(
    async (reason: MicFailureReason, message: string) => {
      if (reason === 'permission-denied') {
        setPermissionStatus('denied');
        setErrorMessage(message);
        return;
      }
      if (reason === 'unsupported' || reason === 'insecure-context') {
        setPermissionStatus('unsupported');
        setErrorMessage(message);
        return;
      }

      setErrorMessage(message);
      const now = Date.now();
      const rec = micRecoveryRef.current;
      if (now - rec.lastAttemptAt < 4000 || rec.attempts >= 3) {
        setNoticeMessage('Microphone recovery gave up. Reconnect the device, then restart the session.');
        return;
      }
      micRecoveryRef.current = { lastAttemptAt: now, attempts: rec.attempts + 1 };
      setNoticeMessage(`Audio interrupted (${reason}). Re-acquiring microphone (attempt ${rec.attempts + 1}/3)…`);

      try {
        await streamerRef.current.ensureMicrophone();
        setPermissionStatus('granted');
        await ensureAudioRunning();
        setErrorMessage(null);
        setNoticeMessage('Microphone recovered.');
        micRecoveryRef.current.attempts = 0;
      } catch (err: any) {
        setErrorMessage(err?.message || 'Microphone could not be recovered.');
      }
    },
    [ensureAudioRunning]
  );

  // Live VU meter throttled to ~15 fps (was: a state commit per audio chunk).
  useEffect(() => {
    if (!micStatus.streaming) {
      setVolumeLevel(0);
      return;
    }
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      if (now - lastVolumeCommitRef.current >= 66) {
        lastVolumeCommitRef.current = now;
        setVolumeLevel(volumeRef.current);
      }
      levelRafRef.current = requestAnimationFrame(tick);
    };
    levelRafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (levelRafRef.current !== null) cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    };
  }, [micStatus.streaming]);

  // ------------------------------------------------------- session event pump
  const handleSessionEvent = useCallback(
    (type: string, data: any, receivedAt: number) => {
      const category: DeepgramEvent['category'] =
        type === 'Error'
          ? 'error'
          : type === 'Warning'
          ? 'error'
          : type === 'Welcome' || type === 'SettingsApplied' || type === 'ProxyStatus' || type === 'SessionReady'
          ? 'settings'
          : type === 'AgentAudioStats' || type === 'LatencyReport'
          ? 'audio'
          : type === 'ConversationText' && data?.role === 'user'
          ? 'user'
          : 'agent';

      // Audio-stat frames are already aggregated server-side (1/s); do not log them.
      if (type !== 'AgentAudioStats') logEvent(type, category, data);

      switch (type) {
        case 'UserStartedSpeaking': {
          // Barge-in: the user talks over the agent -> stop playback instantly.
          playerRef.current.flush();
          turnRef.current = { userStartedAt: receivedAt, firstTextAt: null, firstAudioAt: null };
          setUserSpeaking(true);
          setAgentThinking(false);
          break;
        }
        case 'AgentStartedSpeaking': {
          playerRef.current.beginTurn();
          setAgentThinking(false);
          break;
        }
        case 'AgentThinking': {
          setAgentThinking(true);
          setUserSpeaking(false);
          break;
        }
        case 'AgentAudioDone': {
          setAgentThinking(false);
          playerRef.current.beginTurn();
          break;
        }
        case 'ConversationText': {
          const role: 'user' | 'assistant' = data?.role === 'user' ? 'user' : 'assistant';
          const content: string = data?.content || data?.text || '';
          if (role === 'user') setUserSpeaking(false);

          if (content.trim().length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                id: `${receivedAt}-${Math.random().toString(36).substring(2, 6)}`,
                role,
                content,
                timestamp: new Date(receivedAt).toLocaleTimeString(),
                isFinal: data?.is_final ?? true,
              },
            ]);
            pendingStatsRef.current.receivedTextEvents += 1;
            statsDirtyRef.current = true;
          }

          const turn = turnRef.current;
          if (role === 'assistant' && turn.userStartedAt && !turn.firstTextAt) {
            turn.firstTextAt = receivedAt;
            const delta = receivedAt - turn.userStartedAt;
            setTelemetry((prev) => ({
              ...prev,
              latency: { ...prev.latency, speechStartToFirstTextMs: delta },
            }));
          }
          break;
        }
        case 'LatencyReport': {
          const toMs = (v: unknown) => {
            const n = typeof v === 'number' ? v : parseFloat(String(v));
            return Number.isFinite(n) ? Math.round(n * 1000) : null;
          };
          setTelemetry((prev) => ({
            ...prev,
            latency: {
              ...prev.latency,
              sttMs: toMs(data?.stt_latency),
              thinkMs: toMs(data?.ttt_text_latency ?? data?.ttt_token_latency),
              ttsMs: toMs(data?.tts_latency),
              totalMs: toMs(data?.total_latency),
            },
          }));
          break;
        }
        case 'AgentAudioStats': {
          pendingStatsRef.current.agentAudioFrames = data?.frames ?? 0;
          pendingStatsRef.current.agentAudioBytes = data?.bytes ?? 0;
          pendingStatsRef.current.droppedAudioFrames =
            (data?.inputDroppedFrames ?? 0) + (data?.droppedFrames ?? 0);
          statsDirtyRef.current = true;
          if (typeof data?.firstAudioDelayMs === 'number') {
            setTelemetry((prev) => ({
              ...prev,
              latency: { ...prev.latency, settingsToFirstAudioMs: data.firstAudioDelayMs },
            }));
          }
          break;
        }
        case 'ProxyStatus': {
          if (data?.status === 'SettingsSent') setStatus('SETTINGS_SENT');
          if (data?.status === 'Disconnected') {
            setUserSpeaking(false);
            setAgentThinking(false);
            playerRef.current.flush();
          }
          break;
        }
        case 'Warning': {
          setNoticeMessage(`${data?.code ? `[${data.code}] ` : ''}${data?.description || data?.message || ''}`);
          break;
        }
        default:
          break;
      }
    },
    [logEvent]
  );

  const handleAgentAudio = useCallback((frame: ArrayBuffer, receivedAt: number) => {
    const turn = turnRef.current;
    if (!turn.firstAudioAt) {
      turn.firstAudioAt = receivedAt;
      if (turn.userStartedAt) {
        const delta = receivedAt - turn.userStartedAt;
        setTelemetry((prev) => ({
          ...prev,
          latency: { ...prev.latency, speechStartToFirstAudioMs: delta },
        }));
      }
    }
    pendingStatsRef.current.agentAudioFrames += 1;
    pendingStatsRef.current.agentAudioBytes += frame.byteLength;
    statsDirtyRef.current = true;
    playerRef.current.enqueue(frame);
  }, []);

  // ------------------------------------------------------------------ session
  const handleStartSession = async () => {
    // Guard: rapid double clicks must not open two sockets or two mic streams.
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;

    setErrorMessage(null);
    setNoticeMessage(null);
    setStatus('CONNECTING');

    // Step A: microphone permission straight from the browser window.
    try {
      await streamerRef.current.ensureMicrophone();
      setPermissionStatus('granted');
    } catch (err: any) {
      sessionStartedRef.current = false;
      setStatus('ERROR');
      setPermissionStatus(err?.micReason === 'permission-denied' ? 'denied' : 'prompt');
      setErrorMessage(`Microphone access required: ${err?.message || err}`);
      setTelemetry((prev) => ({ ...prev, connectionFailures: prev.connectionFailures + 1 }));
      return;
    }

    // Step B: unlock playback inside the user gesture (autoplay policy).
    try {
      await playerRef.current.ensure();
    } catch (err) {
      console.warn('[App] playback AudioContext unavailable', err);
    }

    // Reset per-session counters (cumulative failure counts are kept).
    pendingStatsRef.current = {
      sentAudioChunks: 0,
      sentAudioBytes: 0,
      droppedAudioFrames: 0,
      agentAudioFrames: 0,
      agentAudioBytes: 0,
      receivedTextEvents: 0,
    };
    statsDirtyRef.current = false;
    turnRef.current = { userStartedAt: null, firstTextAt: null, firstAudioAt: null };
    micRecoveryRef.current = { lastAttemptAt: 0, attempts: 0 };
    playerRef.current.resetCounters();
    setTelemetry((prev) => ({
      ...EMPTY_TELEMETRY,
      startTime: Date.now(),
      connectionFailures: prev.connectionFailures,
    }));

    const session = new VoiceAgentSession({
      config: modelConfig,
      handlers: {
        onStatus: (next, info) => {
          setStatus(next as ConnectionStatus);
          if (next === 'RECONNECTING') {
            setNoticeMessage(
              `Connection lost (${info?.reason || 'transport'}). Reconnecting in ${info?.nextRetryMs ?? 0} ms ` +
                `(attempt ${info?.attempt ?? 1}). The microphone stays open.`
            );
          }
        },
        onEvent: handleSessionEvent,
        onAudio: handleAgentAudio,
        onReady: ({ reconnected, attempt }) => {
          setNoticeMessage(reconnected ? `Session restored (attempt ${attempt}). Audio pipeline is live.` : null);
          setErrorMessage(null);
          if (reconnected) setTelemetry((prev) => ({ ...prev, reconnects: prev.reconnects + 1 }));
          void ensureAudioRunning();
        },
        onFatal: (error) => {
          setErrorMessage(error.message);
          setStatus('ERROR');
          setUserSpeaking(false);
          setAgentThinking(false);
          playerRef.current.flush();
        },
        onWarning: (code, message) => {
          setNoticeMessage(`${code ? `[${code}] ` : ''}${message}`);
        },
        onClose: ({ code, reason, willReconnect }) => {
          setUserSpeaking(false);
          setAgentThinking(false);
          playerRef.current.flush();
          if (!willReconnect) {
            streamerRef.current.stopStreaming(true);
            sessionStartedRef.current = false;
            if (code !== 1000) {
              setNoticeMessage(
                `Session ended (code ${code}${reason ? `: ${reason}` : ''}). Press Start to open a new session.`
              );
            }
          }
        },
      },
    });

    sessionRef.current = session;
    session.connect();
  };

  // 3. Stop Session
  const handleStopSession = () => {
    sessionStartedRef.current = false;
    sessionRef.current?.stop();
    sessionRef.current = null;
    streamerRef.current.stopStreaming(true);
    void playerRef.current.close();
    setStatus('DISCONNECTED');
    setVolumeLevel(0);
    setUserSpeaking(false);
    setAgentThinking(false);
    setMicStatus(EMPTY_MIC_STATUS);
    setPlayerStatus(EMPTY_PLAYER_STATUS);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // Keep the session's config in sync with the UI (applied on next connect).
  useEffect(() => {
    sessionRef.current?.updateConfig(modelConfig);
  }, [modelConfig]);

  // Mute / Unmute (silence frames keep the session alive — see AudioStreamer)
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    streamerRef.current.setMute(nextMuted);
  };

  // Request Mic Permission (idempotent — never opens a second stream)
  const handleRequestMicPermission = async () => {
    try {
      await streamerRef.current.ensureMicrophone();
      setPermissionStatus('granted');
      setErrorMessage(null);
      if (sessionStartedRef.current) await ensureAudioRunning();
    } catch (err: any) {
      console.error('Mic permission error:', err);
      setPermissionStatus(err?.micReason === 'permission-denied' ? 'denied' : 'prompt');
      setErrorMessage(err?.message || 'Microphone access denied');
    }
  };

  // Inject manual text prompt
  const handleInjectText = (text: string) => {
    const sent = sessionRef.current?.injectUserMessage(text) ?? false;
    if (!sent) {
      setNoticeMessage('Text injection ignored: the session is not ready yet.');
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user-injected`, role: 'user', content: text, timestamp: new Date().toLocaleTimeString() },
    ]);
    pendingStatsRef.current.receivedTextEvents += 1;
    statsDirtyRef.current = true;
  };

  // Cleanup on unmount: never leave a socket or a microphone track behind.
  useEffect(() => {
    return () => {
      sessionRef.current?.stop();
      streamerRef.current.dispose();
      void playerRef.current.close();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      <Header
        health={health}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onRefreshHealth={checkHealth}
      />

      {/* Standalone Window Banner Notification */}
      {!isIframe && (
        <div className="bg-cyan-950/60 border-b border-cyan-800/80 px-4 py-2 text-xs text-cyan-200 flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <MonitorCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Standalone Browser Page Active</strong> — Running directly at{' '}
              <code className="text-cyan-300 font-mono">
                {typeof window !== 'undefined' ? window.location.pathname : '/prototype-1'}
              </code>{' '}
              outside embedded preview iframe. Live microphone streaming and agent voice playback enabled.
            </span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-700/50 hidden sm:inline">
            Full duplex audio
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {health && !health.deepgramApiKeyConfigured && <ApiKeyWarningBanner onRefreshHealth={checkHealth} />}

        {activeTab === 'prototype-1' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <ConnectionPanel
                status={status}
                health={health}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                onStartSession={handleStartSession}
                onStopSession={handleStopSession}
                errorMessage={errorMessage}
                noticeMessage={noticeMessage}
              />

              <MicrophonePanel
                permissionStatus={permissionStatus}
                isStreaming={micStatus.streaming}
                isMuted={isMuted}
                volumeLevel={volumeLevel}
                micStatus={micStatus}
                playerStatus={playerStatus}
                onToggleMute={handleToggleMute}
                onRequestPermission={handleRequestMicPermission}
                onRetryAudio={() => void handleMicFailure('no-frames', 'Manual audio restart requested.')}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <ConversationPanel
                messages={messages}
                userSpeaking={userSpeaking}
                agentThinking={agentThinking}
                onClearMessages={() => setMessages([])}
                onInjectText={handleInjectText}
                isConnected={status === 'READY'}
              />

              <DiagnosticsPanel events={events} onClearEvents={() => setEvents([])} />
            </div>

            <TelemetryPanel telemetry={telemetry} playerStatus={playerStatus} />
          </div>
        ) : (
          <ArchitectureView />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>Deepgram Voice Agent API Prototype 1 · Node.js Express WebSocket Proxy</div>
          <div className="font-mono text-[11px] text-slate-600 flex items-center gap-3">
            <span>Route: /prototype-1</span>
            <span>·</span>
            <span>wss://agent.deepgram.com/v1/agent/converse</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
