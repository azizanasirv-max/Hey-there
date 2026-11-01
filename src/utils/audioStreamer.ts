/**
 * Browser microphone capture + uplink streamer.
 *
 * Responsibilities (and the defects this design fixes):
 *  - exactly ONE `getUserMedia` stream for the lifetime of the page
 *    (`ensureMicrophone` is idempotent and serialised through one promise);
 *  - capture inside an `AudioWorklet` (off the main thread) with a
 *    `ScriptProcessorNode` fallback, framed into 20 ms frames;
 *  - stateful resampling to the agent's 24 kHz linear16 format
 *    (no drift / no boundary clicks);
 *  - silence frames while muted, so the agent session is never starved into a
 *    `CLIENT_MESSAGE_TIMEOUT` and the recogniser timeline stays continuous;
 *  - truthful state reporting (`onStateChange`) plus a frame watchdog so the UI
 *    can never claim "streaming" while no audio is flowing;
 *  - recovery from suspended/interrupted `AudioContext`s, tab visibility
 *    changes and microphone device loss.
 */

import { AGENT_INPUT_SAMPLE_RATE } from '../shared/voiceAgentConfig';
import { floatTo16BitPCM, int16ToArrayBuffer, PcmFramer, StreamingResampler } from './pcm';

/** Frame size for uplink. 20 ms @ 24 kHz = 480 samples = 960 bytes. */
export const UPLINK_FRAME_MS = 20;
/** Worklet batches 1024 input samples (~21 ms @ 48 kHz) before posting. */
const WORKLET_BATCH_SAMPLES = 1024;

export type MicFailureReason =
  | 'permission-denied'
  | 'no-device'
  | 'device-lost'
  | 'insecure-context'
  | 'unsupported'
  | 'context-suspended'
  | 'no-frames'
  | 'unknown';

export interface AudioStreamerState {
  /** True only when a capture graph is running and delivering frames. */
  streaming: boolean;
  /** Real AudioContext state, or null when no context exists. */
  contextState: AudioContextState | 'interrupted' | null;
  /** Real MediaStreamTrack state. */
  trackState: 'live' | 'ended' | 'muted' | null;
  /** Actual capture sample rate feeding the resampler. */
  captureSampleRate: number | null;
  /** Which capture backend is in use. */
  backend: 'worklet' | 'script-processor' | null;
  /** Frames dropped because the socket was not open. */
  droppedFrames: number;
}

export interface AudioStreamerHandlers {
  /** Live input level, 0-100. Called at frame cadence (~50 Hz) — throttle in UI. */
  onLevel?: (level: number) => void;
  /** Called whenever a frame is handed to the sink. */
  onFrameSent?: (bytes: number) => void;
  /** Called whenever a frame could not be sent (socket not open). */
  onFrameDropped?: () => void;
  onStateChange?: (state: AudioStreamerState) => void;
  onFailure?: (reason: MicFailureReason, message: string) => void;
  /** Fired when the physical device goes away while streaming. */
  onDeviceLost?: () => void;
}

/** Sends a binary frame; returns false when the transport is not ready. */
export type AudioSink = (frame: ArrayBuffer) => boolean;

/**
 * AudioWorklet source. Runs on the audio thread, batches input into
 * `batchSamples` chunks and transfers them to the main thread.
 */
const WORKLET_SOURCE = `
class PcmTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const batch = (options && options.processorOptions && options.processorOptions.batchSamples) || 1024;
    this.batch = new Float32Array(batch);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(this.batch.length - this.filled, channel.length - offset);
        this.batch.set(channel.subarray(offset, offset + take), this.filled);
        this.filled += take;
        offset += take;
        if (this.filled === this.batch.length) {
          const copy = new Float32Array(this.batch);
          this.port.postMessage(copy, [copy.buffer]);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap-processor', PcmTapProcessor);
`;

export class AudioStreamer {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private muteGain: GainNode | null = null;
  private workletUrl: string | null = null;

  private micPromise: Promise<MediaStream> | null = null;
  private resampler: StreamingResampler | null = null;
  private framer: PcmFramer | null = null;
  private sink: AudioSink | null = null;
  private handlers: AudioStreamerHandlers = {};

  private isMuted = false;
  private streaming = false;
  private backend: 'worklet' | 'script-processor' | null = null;
  private droppedFrames = 0;
  private captureSampleRate: number | null = null;
  private lastFrameAt = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private detachVisibility: (() => void) | null = null;
  private detachDeviceChange: (() => void) | null = null;

  // ---------------------------------------------------------------- microphone

  /** True when a live (not ended) audio track is held. */
  hasLiveMicrophone(): boolean {
    return Boolean(this.mediaStream && this.mediaStream.getAudioTracks().some((t) => t.readyState === 'live'));
  }

  get microphoneStream(): MediaStream | null {
    return this.mediaStream;
  }

  /**
   * Acquire the microphone once. Repeated calls return the same stream while
   * its track is live, so we never open duplicate capture devices.
   */
  async ensureMicrophone(): Promise<MediaStream> {
    if (this.hasLiveMicrophone()) return this.mediaStream!;
    if (this.micPromise) return this.micPromise;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(
        new Error('This browser does not expose the MediaDevices API (getUserMedia missing).'),
        { micReason: 'unsupported' as MicFailureReason }
      );
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw Object.assign(
        new Error('Microphone capture requires a secure context (https:// or localhost).'),
        { micReason: 'insecure-context' as MicFailureReason }
      );
    }

    this.micPromise = (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.releaseMicrophone(); // drop any ended/stale stream first
        this.mediaStream = stream;
        this.attachTrackListeners(stream);
        this.attachDeviceChangeListener();
        this.emitState();
        return stream;
      } catch (err: any) {
        const reason: MicFailureReason =
          err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || err?.name === 'PermissionDeniedError'
            ? 'permission-denied'
            : err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError' || err?.name === 'DevicesNotFoundError'
            ? 'no-device'
            : 'unknown';
        const message =
          reason === 'permission-denied'
            ? 'Microphone permission was denied. Allow mic access for this site in the browser address bar, then retry.'
            : reason === 'no-device'
            ? 'No microphone device was found. Connect a microphone and retry.'
            : `Failed to access microphone: ${err?.message || err?.name || err}`;
        throw Object.assign(new Error(message), { micReason: reason });
      } finally {
        this.micPromise = null;
      }
    })();

    return this.micPromise;
  }

  /** Backwards-compatible alias used by the UI "grant permission" button. */
  async requestMicrophone(): Promise<MediaStream> {
    return this.ensureMicrophone();
  }

  private attachTrackListeners(stream: MediaStream) {
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        this.emitState();
        this.emitFailure(
          'device-lost',
          'The microphone stopped (device disconnected or permission revoked). Reconnect it, then restart the session.'
        );
        this.handlers.onDeviceLost?.();
      };
      track.onmute = () => this.emitState();
      track.onunmute = () => {
        this.emitState();
        void this.resumeContext();
      };
    });
  }

  private attachDeviceChangeListener() {
    if (this.detachDeviceChange || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => {
      if (this.streaming && !this.hasLiveMicrophone()) {
        this.emitFailure('device-lost', 'Microphone disappeared from the system. Reconnect it and restart the session.');
        this.handlers.onDeviceLost?.();
      }
      this.emitState();
    };
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    this.detachDeviceChange = () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }

  private releaseMicrophone() {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((t) => {
        t.onended = null;
        t.onmute = null;
        t.onunmute = null;
        if (t.readyState === 'live') t.stop();
      });
      this.mediaStream = null;
    }
  }

  // ------------------------------------------------------------------ lifecycle

  /** Start (or resume) capture and pipe frames into `sink`. Idempotent. */
  async startStreaming(sink: AudioSink, handlers: AudioStreamerHandlers = {}): Promise<void> {
    this.handlers = { ...this.handlers, ...handlers };
    this.sink = sink;

    if (this.streaming) {
      // Already running: re-point the sink (used after a socket reconnect).
      return;
    }

    this.droppedFrames = 0;
    await this.ensureMicrophone();

    const ctx = await this.createContext();
    this.captureSampleRate = ctx.sampleRate;
    this.resampler = new StreamingResampler(ctx.sampleRate, AGENT_INPUT_SAMPLE_RATE);
    this.framer = new PcmFramer(
      Math.round((UPLINK_FRAME_MS / 1000) * AGENT_INPUT_SAMPLE_RATE),
      AGENT_INPUT_SAMPLE_RATE
    );

    this.sourceNode = ctx.createMediaStreamSource(this.mediaStream!);

    // Silent sink keeps the graph pulled in browsers that only render graphs
    // that reach the destination. Gain 0 => no microphone monitoring loop.
    this.muteGain = ctx.createGain();
    this.muteGain.gain.value = 0;
    this.muteGain.connect(ctx.destination);

    const onBlock = (block: Float32Array) => this.handleCapturedBlock(block);

    if (await this.trySetupWorklet(ctx, onBlock)) {
      this.backend = 'worklet';
    } else {
      this.backend = 'script-processor';
      const node = ctx.createScriptProcessor(1024, 1, 1);
      node.onaudioprocess = (event) => {
        if (!this.streaming) return;
        onBlock(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      this.sourceNode.connect(node);
      node.connect(this.muteGain);
      this.scriptNode = node;
    }

    this.streaming = true;
    this.lastFrameAt = Date.now();
    if (this.isMuted) this.startSilencePump();
    this.startTimers();
    this.attachVisibilityListener();
    this.emitState();
  }

  private async createContext(): Promise<AudioContext> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.resumeContext();
      return this.audioContext;
    }
    const Ctor: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) {
      throw Object.assign(new Error('Web Audio API is not available in this browser.'), {
        micReason: 'unsupported' as MicFailureReason,
      });
    }
    let ctx: AudioContext;
    try {
      // Requesting the agent rate avoids one resample stage when supported.
      ctx = new Ctor({ sampleRate: AGENT_INPUT_SAMPLE_RATE });
    } catch {
      ctx = new Ctor();
    }
    ctx.onstatechange = () => {
      this.emitState();
      if (this.streaming && (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted')) {
        void this.resumeContext();
      }
    };
    this.audioContext = ctx;
    await this.resumeContext();
    return ctx;
  }

  /** Resume a suspended/interrupted context (no-op when already running). */
  async resumeContext(): Promise<boolean> {
    const ctx = this.audioContext;
    if (!ctx || ctx.state === 'closed') return false;
    if (ctx.state === 'running') return true;
    try {
      await ctx.resume();
      this.emitState();
      return (ctx.state as string) === 'running';
    } catch (err) {
      console.warn('[AudioStreamer] AudioContext resume failed', err);
      this.emitState();
      return false;
    }
  }

  private async trySetupWorklet(
    ctx: AudioContext,
    onBlock: (block: Float32Array) => void
  ): Promise<boolean> {
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
    try {
      if (!this.workletUrl) {
        const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
        this.workletUrl = URL.createObjectURL(blob);
      }
      await ctx.audioWorklet.addModule(this.workletUrl);
      const node = new AudioWorkletNode(ctx, 'pcm-tap-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        processorOptions: { batchSamples: WORKLET_BATCH_SAMPLES },
      });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (!this.streaming) return;
        onBlock(event.data);
      };
      node.onprocessorerror = (err) => {
        console.error('[AudioStreamer] AudioWorklet processor error', err);
        this.emitFailure('no-frames', 'Audio processing thread failed. Restarting capture.');
        void this.restart();
      };
      this.sourceNode!.connect(node);
      node.connect(this.muteGain!);
      this.workletNode = node;
      return true;
    } catch (err) {
      console.warn('[AudioStreamer] AudioWorklet unavailable, falling back to ScriptProcessor', err);
      return false;
    }
  }

  private attachVisibilityListener() {
    if (this.detachVisibility || typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void this.resumeContext();
      if (this.streaming && Date.now() - this.lastFrameAt > 1000) {
        void this.restart();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.detachVisibility = () => document.removeEventListener('visibilitychange', onVisibility);
  }

  private startTimers() {
    this.stopTimers();
    // Watchdog: a running graph must keep producing frames. Detect silent death.
    this.watchdog = setInterval(() => {
      if (!this.streaming) return;
      if (Date.now() - this.lastFrameAt <= 3000) return;
      if (this.audioContext && this.audioContext.state !== 'running') {
        void this.resumeContext();
        return;
      }
      if (!this.hasLiveMicrophone()) {
        this.emitFailure('device-lost', 'Microphone is no longer available. Reconnect the device and restart.');
        return;
      }
      this.emitFailure('no-frames', 'Audio capture stalled (no frames for 3s). Restarting capture.');
      void this.restart();
    }, 1500);
  }

  private stopTimers() {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
    this.stopSilencePump();
  }

  /** Tear down the capture graph, keeping the microphone and AudioContext. */
  private teardownGraph() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.onprocessorerror = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      this.scriptNode.disconnect();
      this.scriptNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.muteGain) {
      this.muteGain.disconnect();
      this.muteGain = null;
    }
    this.framer = null;
    this.resampler = null;
    this.backend = null;
  }

  /** Rebuild the capture graph in place (keeps socket + microphone). */
  async restart(): Promise<void> {
    if (!this.streaming) return;
    const sink = this.sink;
    this.streaming = false;
    this.stopTimers();
    this.teardownGraph();
    if (!sink) return;
    try {
      await this.startStreaming(sink, this.handlers);
    } catch (err: any) {
      this.emitFailure((err?.micReason as MicFailureReason) || 'unknown', err?.message || 'Restart failed');
    }
  }

  private handleCapturedBlock(block: Float32Array) {
    if (!this.streaming) return;
    this.lastFrameAt = Date.now();

    // Live level from the raw capture (cheap; worklet already copied it).
    let sumSquares = 0;
    for (let i = 0; i < block.length; i++) sumSquares += block[i] * block[i];
    const rms = Math.sqrt(sumSquares / Math.max(1, block.length));
    this.handlers.onLevel?.(this.isMuted ? 0 : Math.min(100, Math.round(rms * 250)));

    if (this.isMuted) return; // silence frames are emitted by the silence pump
    this.pushAudio(block);
  }

  private pushAudio(floatBlock: Float32Array) {
    const resampler = this.resampler;
    const framer = this.framer;
    if (!resampler || !framer) return;
    const resampled = resampler.process(floatBlock);
    framer.push(resampled, (frame) => this.sendFrame(frame));
  }

  private sendFrame(frame: Float32Array) {
    const sink = this.sink;
    if (!sink) return;
    const payload = int16ToArrayBuffer(floatTo16BitPCM(frame));
    if (sink(payload)) {
      this.handlers.onFrameSent?.(payload.byteLength);
    } else {
      this.droppedFrames++;
      this.handlers.onFrameDropped?.();
    }
  }

  /**
   * While muted we still transmit silence so the agent keeps a continuous
   * audio timeline and never hits `CLIENT_MESSAGE_TIMEOUT`.
   */
  private startSilencePump() {
    if (this.silenceTimer || !this.framer) return;
    const silent = this.framer.silence();
    this.silenceTimer = setInterval(() => {
      if (!this.streaming || !this.isMuted) return;
      this.lastFrameAt = Date.now();
      this.sendFrame(silent);
    }, UPLINK_FRAME_MS);
  }

  private stopSilencePump() {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  /**
   * Mute the uplink. Audio is replaced by digital silence (not by "no frames")
   * so the recogniser sees a continuous stream.
   */
  setMute(muted: boolean): void {
    this.isMuted = muted;
    if (this.mediaStream) {
      // Keep the track enabled: disabling it produces discontinuous audio and
      // makes some browsers pause the capture graph entirely.
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    if (muted && this.streaming) {
      this.startSilencePump();
    } else {
      this.stopSilencePump();
    }
    this.emitState();
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /** Stop capture. `releaseMic` also stops the MediaStream tracks. */
  stopStreaming(releaseMic = true): void {
    this.streaming = false;
    this.stopTimers();
    this.teardownGraph();

    if (this.detachVisibility) {
      this.detachVisibility();
      this.detachVisibility = null;
    }

    if (this.audioContext) {
      const ctx = this.audioContext;
      this.audioContext = null;
      if (ctx.state !== 'closed') ctx.close().catch(() => {});
    }

    if (releaseMic) {
      this.releaseMicrophone();
      if (this.detachDeviceChange) {
        this.detachDeviceChange();
        this.detachDeviceChange = null;
      }
    }

    this.sink = null;
    this.emitState();
  }

  /** Full reset used when a session ends. */
  dispose(): void {
    this.stopStreaming(true);
    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
    this.handlers = {};
  }

  getState(): AudioStreamerState {
    const track = this.mediaStream?.getAudioTracks()[0] ?? null;
    return {
      streaming: this.streaming,
      contextState: (this.audioContext?.state as AudioStreamerState['contextState']) ?? null,
      trackState: track ? (track.readyState === 'live' ? (track.muted ? 'muted' : 'live') : 'ended') : null,
      captureSampleRate: this.captureSampleRate,
      backend: this.backend,
      droppedFrames: this.droppedFrames,
    };
  }

  private emitState() {
    this.handlers.onStateChange?.(this.getState());
  }

  private emitFailure(reason: MicFailureReason, message: string) {
    console.warn(`[AudioStreamer] ${reason}: ${message}`);
    this.handlers.onFailure?.(reason, message);
  }
}
