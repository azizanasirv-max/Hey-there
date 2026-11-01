import React from 'react';
import { CheckCircle2, Zap, Volume2, Cpu, Code2 } from 'lucide-react';

export const ArchitectureView: React.FC = () => {
  return (
    <div className="space-y-6 max-w-5xl mx-auto py-2">
      
      {/* Overview Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Zap className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Deepgram Voice Agent API Architecture & Protocol Flow
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Official Connection Sequence & Handshake Contract Specification
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed pt-2">
          This standalone prototype connects browser microphone audio continuously through a dedicated Node.js Express WebSocket proxy to Deepgram's Voice Agent endpoint (<code className="text-cyan-300">wss://agent.deepgram.com/v1/agent/converse</code>).
        </p>
      </div>

      {/* Connection Protocol Sequence Diagram */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
          <Code2 className="w-4 h-4 text-cyan-400" />
          Strict 7-Step Connection Sequence
        </h3>

        <div className="space-y-3 font-mono text-xs">
          {[
            { step: '1', title: 'Browser Requests Session', desc: 'Browser opens WebSocket connection to local Express proxy (/api/agent-proxy).' },
            { step: '2', title: 'Backend Authenticates with Deepgram', desc: 'Proxy reads DEEPGRAM_API_KEY from process.env and opens WS to wss://agent.deepgram.com/v1/agent/converse with header "Authorization: Token <key>".' },
            { step: '3', title: 'Wait for "Welcome"', desc: 'Proxy awaits Deepgram {"type": "Welcome", "session_id": "..."} message.' },
            { step: '4', title: 'Send "Settings"', desc: 'Proxy sends exactly one valid official Settings JSON payload matching the documented schema (type: "Settings", audio, agent.listen, agent.think, agent.speak).' },
            { step: '5', title: 'Wait for "SettingsApplied"', desc: 'Proxy awaits Deepgram {"type": "SettingsApplied"} message confirming settings acceptance.' },
            { step: '6', title: 'Notify Browser SessionReady', desc: 'Proxy notifies browser with {"type": "SessionReady"}. Microphone streaming is unlocked.' },
            { step: '7', title: 'Continuous Binary PCM Audio Streaming', desc: 'Browser resamples microphone input to 24kHz 16-bit linear PCM (AudioWorklet, 20 ms frames) and streams binary frames continuously — including silence frames while muted.' },
            { step: '8', title: 'Agent Voice Playback', desc: 'Binary linear16 frames from the agent are forwarded to the browser and scheduled back-to-back on a 24 kHz AudioContext for gapless playback; UserStartedSpeaking flushes the queue (barge-in).' },
            { step: '9', title: 'Keep-alive & Auto-Reconnect', desc: 'The proxy relays {"type":"KeepAlive"} after 8 s of uplink silence and the client reconnects with exponential backoff (0.5→8 s, 5 attempts), re-sending Settings so audio resumes without a page reload.' },
          ].map((item) => (
            <div key={item.step} className="p-3.5 bg-slate-950 rounded-lg border border-slate-800 flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 flex items-center justify-center font-bold text-xs shrink-0">
                {item.step}
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-slate-200">{item.title}</div>
                <div className="text-slate-400 font-sans text-xs">{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Model Spec Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        
        {/* Deepgram Settings Payload */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-blue-400" />
            Default Model Configuration
          </h3>
          <ul className="space-y-2 text-xs font-mono text-slate-300">
            <li className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
              <span className="text-slate-400">Listening STT:</span>
              <span className="text-cyan-300 font-bold">deepgram / nova-3</span>
            </li>
            <li className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
              <span className="text-slate-400">Thinking LLM:</span>
              <span className="text-blue-300 font-bold">open_ai / gpt-4o-mini</span>
            </li>
            <li className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
              <span className="text-slate-400">Speaking TTS:</span>
              <span className="text-indigo-300 font-bold">deepgram / flux-kit-en (v2)</span>
            </li>
            <li className="p-2 bg-slate-950 rounded border border-slate-800 flex justify-between">
              <span className="text-slate-400">Audio Format:</span>
              <span className="text-emerald-300 font-bold">linear16 @ 24,000 Hz</span>
            </li>
          </ul>
        </div>

        {/* Agent voice playback path */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-indigo-400" />
            Full-duplex audio contract
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            The agent's binary linear16 (24 kHz, mono, container-less) frames are relayed to the browser and played
            through a scheduled Web Audio queue. No HTML media element is used and no container header is required.
          </p>
          <ul className="space-y-1.5 text-xs text-slate-400">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Agent audio forwarded as binary frames (not discarded).</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Gapless scheduling with a 60 ms lead; barge-in flushes the queue.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Microphone keeps streaming silence while muted so the session never times out.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Transcripts, latency reports and audio stats are streamed as they arrive.</span>
            </li>
          </ul>
        </div>

      </div>

    </div>
  );
};
