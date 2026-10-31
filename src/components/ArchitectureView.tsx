import React from 'react';
import { ArrowRight, CheckCircle2, ShieldCheck, Zap, Radio, VolumeX, Cpu, Server, Code2 } from 'lucide-react';

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
            { step: '7', title: 'Continuous Binary PCM Audio Streaming', desc: 'Browser resamples microphone input to 24kHz 16-bit linear PCM and streams binary frames continuously.' },
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

        {/* Audio Discard Technical Requirement */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl space-y-3">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <VolumeX className="w-4 h-4 text-indigo-400" />
            Binary TTS Discard Rule
          </h3>
          <p className="text-xs text-slate-300 leading-relaxed">
            Per prototype design requirements, generated binary audio frames from Deepgram are discarded server-side immediately upon arrival.
          </p>
          <ul className="space-y-1.5 text-xs text-slate-400">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Zero binary audio data forwarded to browser.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>No audio playback or HTML Audio elements.</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Text-only display of customer speech and AI responses.</span>
            </li>
          </ul>
        </div>

      </div>

    </div>
  );
};
