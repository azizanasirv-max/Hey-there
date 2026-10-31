import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { ConnectionPanel } from './components/ConnectionPanel';
import { MicrophonePanel } from './components/MicrophonePanel';
import { ConversationPanel } from './components/ConversationPanel';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { TelemetryPanel } from './components/TelemetryPanel';
import { ApiKeyWarningBanner } from './components/ApiKeyWarningBanner';
import { ArchitectureView } from './components/ArchitectureView';
import { AudioStreamer } from './utils/audioStreamer';
import {
  ConnectionStatus,
  ModelConfig,
  BackendHealthResponse,
  ConversationMessage,
  DeepgramEvent,
  SessionTelemetry,
} from './types/deepgram';
import { MonitorCheck, ExternalLink } from 'lucide-react';

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

    // Ensure URL shows /prototype-1 if on root /
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState(null, '', '/prototype-1');
    }

    const handlePopState = () => {
      setActiveTabState(getRouteFromLocation());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Backend Health
  const [health, setHealth] = useState<BackendHealthResponse | null>(null);

  // Connection State
  const [status, setStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initial Model Configuration
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    listenProvider: 'deepgram',
    listenModel: 'nova-3',
    thinkProvider: 'open_ai',
    thinkModel: 'gpt-4o-mini',
    speakProvider: 'deepgram',
    speakModel: 'flux-kit-en',
    speakVersion: 'v2',
    sampleRate: 24000,
    encoding: 'linear16',
  });

  // Audio & Microphone State
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);

  // Live Conversation & Diagnostics
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [events, setEvents] = useState<DeepgramEvent[]>([]);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [agentThinking, setAgentThinking] = useState(false);

  // Telemetry Metrics
  const [telemetry, setTelemetry] = useState<SessionTelemetry>({
    startTime: null,
    durationSeconds: 0,
    receivedTextEvents: 0,
    discardedAudioFrames: 0,
    discardedAudioBytes: 0,
    connectionFailures: 0,
    sentAudioChunks: 0,
  });

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioStreamerRef = useRef<AudioStreamer>(new AudioStreamer());
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
      if (!telemetry.startTime) {
        setTelemetry((prev) => ({ ...prev, startTime: Date.now() }));
      }
      timerIntervalRef.current = setInterval(() => {
        setTelemetry((prev) => ({
          ...prev,
          durationSeconds: prev.startTime ? Math.floor((Date.now() - prev.startTime) / 1000) : prev.durationSeconds + 1,
        }));
      }, 1000);
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [status, telemetry.startTime]);

  // Add Event to Diagnostics
  const logEvent = (type: string, category: DeepgramEvent['category'], rawJson: any) => {
    const newEvent: DeepgramEvent = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      category,
      rawJson,
    };
    setEvents((prev) => [newEvent, ...prev.slice(0, 199)]);
  };

  // Request Mic Permission
  const handleRequestMicPermission = async () => {
    try {
      await audioStreamerRef.current.requestMicrophone();
      setPermissionStatus('granted');
    } catch (err: any) {
      console.error('Mic permission error:', err);
      setPermissionStatus('denied');
      setErrorMessage(err.message || 'Microphone access denied');
    }
  };

  // 2. Start Session
  const handleStartSession = async () => {
    setErrorMessage(null);
    setStatus('CONNECTING');

    // Step A: Ensure Microphone Permission directly from browser window
    try {
      await audioStreamerRef.current.requestMicrophone();
      setPermissionStatus('granted');
    } catch (err: any) {
      setStatus('ERROR');
      setPermissionStatus('denied');
      setErrorMessage(`Microphone access required: ${err.message}`);
      setTelemetry((prev) => ({ ...prev, connectionFailures: prev.connectionFailures + 1 }));
      return;
    }

    // Reset telemetry for new clean session
    setTelemetry({
      startTime: Date.now(),
      durationSeconds: 0,
      receivedTextEvents: 0,
      discardedAudioFrames: 0,
      discardedAudioBytes: 0,
      connectionFailures: telemetry.connectionFailures,
      sentAudioChunks: 0,
    });

    // Step B: Open WebSocket Proxy Connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/agent-proxy`;

    logEvent('ClientConnecting', 'connection', { wsUrl, timestamp: new Date().toISOString() });

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('WAITING_FOR_WELCOME');
        logEvent('WebSocketProxyConnected', 'connection', { url: wsUrl });

        // Send model settings configuration to proxy backend (proxy translates to official Deepgram Settings schema)
        const customSettingsPayload = {
          type: 'ConfigureSettings',
          config: {
            listenProvider: modelConfig.listenProvider,
            listenModel: modelConfig.listenModel,
            thinkProvider: modelConfig.thinkProvider,
            thinkModel: modelConfig.thinkModel,
            speakProvider: modelConfig.speakProvider,
            speakModel: modelConfig.speakModel,
            speakVersion: modelConfig.speakVersion || 'v2',
            sampleRate: modelConfig.sampleRate,
            encoding: modelConfig.encoding,
          },
        };
        ws.send(JSON.stringify(customSettingsPayload));
      };

      ws.onmessage = async (event) => {
        if (typeof event.data !== 'string') return;

        try {
          const data = JSON.parse(event.data);

          const category: DeepgramEvent['category'] =
            data.type === 'Error'
              ? 'error'
              : data.type === 'Welcome' || data.type === 'SettingsApplied' || data.type === 'ProxyStatus'
              ? 'settings'
              : data.type === 'AudioDiscardedTelemetry'
              ? 'audio'
              : 'agent';

          logEvent(data.type || 'Message', category, data);

          if (data.type === 'ProxyStatus') {
            if (data.status === 'SettingsSent') {
              setStatus('SETTINGS_SENT');
            } else if (data.status === 'Disconnected') {
              setStatus('DISCONNECTED');
              setIsStreaming(false);
              audioStreamerRef.current.stopStreaming();
            }
          } else if (data.type === 'SessionReady' || data.type === 'SettingsApplied') {
            setStatus('READY');
            setIsStreaming(true);

            try {
              await audioStreamerRef.current.startStreaming(
                ws,
                (volume) => setVolumeLevel(volume),
                () => setTelemetry((prev) => ({ ...prev, sentAudioChunks: prev.sentAudioChunks + 1 }))
              );
            } catch (streamErr: any) {
              setErrorMessage(`Audio streaming failed: ${streamErr.message}`);
            }
          } else if (data.type === 'UserStartedSpeaking') {
            setUserSpeaking(true);
            setAgentThinking(false);
          } else if (data.type === 'AgentThinking') {
            setAgentThinking(true);
            setUserSpeaking(false);
          } else if (data.type === 'AgentAudioDone') {
            setAgentThinking(false);
          } else if (data.type === 'ConversationText') {
            setUserSpeaking(false);
            setAgentThinking(false);

            const role = data.role === 'user' ? 'user' : 'assistant';
            const content = data.content || data.text || '';

            if (content.trim().length > 0) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                  role,
                  content,
                  timestamp: new Date().toLocaleTimeString(),
                  isFinal: data.is_final ?? true,
                },
              ]);
              setTelemetry((prev) => ({ ...prev, receivedTextEvents: prev.receivedTextEvents + 1 }));
            }
          } else if (data.type === 'AudioDiscardedTelemetry') {
            setTelemetry((prev) => ({
              ...prev,
              discardedAudioFrames: data.frames,
              discardedAudioBytes: data.bytes,
            }));
          } else if (data.type === 'Error') {
            const errDescription = data.description || data.message || 'Deepgram API error';
            const errCode = data.code ? `[${data.code}] ` : '';
            setErrorMessage(`${errCode}${errDescription}`);
            setStatus('ERROR');
            // Terminate audio streaming and timer immediately on fatal protocol error to protect usage
            setIsStreaming(false);
            setVolumeLevel(0);
            audioStreamerRef.current.stopStreaming();
            if (timerIntervalRef.current) {
              clearInterval(timerIntervalRef.current);
              timerIntervalRef.current = null;
            }
          }
        } catch (jsonErr) {
          console.error('Failed to parse WebSocket message:', jsonErr);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket Error:', err);
        setStatus('ERROR');
        setErrorMessage('Proxy WebSocket connection error.');
        setTelemetry((prev) => ({ ...prev, connectionFailures: prev.connectionFailures + 1 }));
      };

      ws.onclose = (e) => {
        console.log(`WebSocket closed: code=${e.code}, reason=${e.reason}`);
        setStatus((current) => (current === 'ERROR' ? 'ERROR' : 'DISCONNECTED'));
        setIsStreaming(false);
        setVolumeLevel(0);
        audioStreamerRef.current.stopStreaming();
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
      };
    } catch (err: any) {
      setStatus('ERROR');
      setErrorMessage(`Failed to open WebSocket: ${err.message}`);
      setTelemetry((prev) => ({ ...prev, connectionFailures: prev.connectionFailures + 1 }));
    }
  };

  // 3. Stop Session
  const handleStopSession = () => {
    if (wsRef.current) {
      wsRef.current.close(1000, 'User stopped session');
      wsRef.current = null;
    }
    audioStreamerRef.current.stopStreaming();
    setIsStreaming(false);
    setStatus('DISCONNECTED');
    setVolumeLevel(0);
    setUserSpeaking(false);
    setAgentThinking(false);
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // Mute / Unmute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioStreamerRef.current.setMute(nextMuted);
  };

  // Inject manual text prompt
  const handleInjectText = (text: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'InjectUserMessage',
        content: text,
      };
      wsRef.current.send(JSON.stringify(payload));

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-user-injected`,
          role: 'user',
          content: text,
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
      setTelemetry((prev) => ({ ...prev, receivedTextEvents: prev.receivedTextEvents + 1 }));
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      
      {/* Top Header */}
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
              <strong>Standalone Browser Page Active</strong> — Running directly at <code className="text-cyan-300 font-mono">{typeof window !== 'undefined' ? window.location.pathname : '/prototype-1'}</code> outside embedded preview iframe. Direct microphone streaming enabled.
            </span>
          </div>
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-900/60 px-2 py-0.5 rounded border border-cyan-700/50 hidden sm:inline">
            Direct Routing Ready
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        
        {/* Missing API Key Banner */}
        {health && !health.deepgramApiKeyConfigured && (
          <ApiKeyWarningBanner onRefreshHealth={checkHealth} />
        )}

        {activeTab === 'prototype-1' ? (
          <div className="space-y-6">
            
            {/* Top Grid: Connection & Microphone Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <ConnectionPanel
                status={status}
                health={health}
                modelConfig={modelConfig}
                setModelConfig={setModelConfig}
                onStartSession={handleStartSession}
                onStopSession={handleStopSession}
                errorMessage={errorMessage}
              />

              <MicrophonePanel
                permissionStatus={permissionStatus}
                isStreaming={isStreaming}
                isMuted={isMuted}
                volumeLevel={volumeLevel}
                onToggleMute={handleToggleMute}
                onRequestPermission={handleRequestMicPermission}
              />
            </div>

            {/* Middle Grid: Real-Time Conversation vs Event Diagnostics */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <ConversationPanel
                messages={messages}
                userSpeaking={userSpeaking}
                agentThinking={agentThinking}
                onClearMessages={() => setMessages([])}
                onInjectText={handleInjectText}
                isConnected={status === 'READY'}
              />

              <DiagnosticsPanel
                events={events}
                onClearEvents={() => setEvents([])}
              />
            </div>

            {/* Bottom Grid: Telemetry Stats */}
            <TelemetryPanel telemetry={telemetry} />

          </div>
        ) : (
          <ArchitectureView />
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            Deepgram Voice Agent API Prototype 1 · Node.js Express WebSocket Proxy
          </div>
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
