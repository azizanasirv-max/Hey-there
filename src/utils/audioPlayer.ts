/**
 * Streaming PCM playback for agent (TTS) audio.
 *
 * Deepgram streams raw `linear16` mono 24 kHz frames — no container — so an
 * `<audio>` element cannot play them. We decode the Int16 frames and schedule
 * them back-to-back on a single AudioContext timeline, which gives gapless
 * playback with a fixed, small lead time instead of the multi-hundred ms delay
 * of buffering a whole clip.
 *
 * Supports barge-in (`flush()`), context suspension recovery (`resume()`) and
 * reports real playback state so the UI never claims audio is playing when it
 * is not.
 */

import { AGENT_OUTPUT_SAMPLE_RATE } from '../shared/voiceAgentConfig';
import { int16ToFloat32, StreamingResampler } from './pcm';
import { PlaybackScheduler } from './playbackScheduler';

export interface PlayerStats {
  playing: boolean;
  contextState: AudioContextState | 'interrupted' | null;
  framesQueued: number;
  framesPlayed: number;
  framesDropped: number;
  underruns: number;
  /** Delay between the first frame of a turn arriving and it becoming audible. */
  lastFirstAudibleDelayMs: number | null;
  bufferedMs: number;
}

export class PcmAudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private resampler: StreamingResampler | null = null;
  private resamplerRate: number | null = null;
  private scheduler = new PlaybackScheduler(0.06);
  private active = new Set<AudioBufferSourceNode>();
  private framesQueued = 0;
  private framesPlayed = 0;
  private framesDropped = 0;
  private underruns = 0;
  private lastFirstAudibleDelayMs: number | null = null;
  private turnHasAudio = false;
  private ensurePromise: Promise<AudioContext> | null = null;
  private detachVisibility: (() => void) | null = null;

  constructor(public onStats?: (stats: PlayerStats) => void) {}

  /** Create/resume the playback AudioContext. Call from a user gesture. */
  async ensure(): Promise<AudioContext> {
    if (this.ctx && this.ctx.state !== 'closed') {
      await this.resume();
      return this.ctx;
    }
    if (this.ensurePromise) return this.ensurePromise;

    this.ensurePromise = (async () => {
      const Ctor: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio API is not available; agent audio cannot play.');
      let ctx: AudioContext;
      try {
        ctx = new Ctor({ sampleRate: AGENT_OUTPUT_SAMPLE_RATE });
      } catch {
        ctx = new Ctor();
      }
      ctx.onstatechange = () => {
        if ((ctx.state as string) === 'interrupted' || ctx.state === 'suspended') {
          void this.resume();
        }
        this.emitStats();
      };
      const gain = ctx.createGain();
      gain.gain.value = 1;
      gain.connect(ctx.destination);
      this.ctx = ctx;
      this.gain = gain;
      this.attachVisibilityListener();
      await this.resume();
      return ctx;
    })();

    try {
      return await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  private attachVisibilityListener() {
    if (this.detachVisibility || typeof document === 'undefined') return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void this.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.detachVisibility = () => document.removeEventListener('visibilitychange', onVisibility);
  }

  async resume(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return false;
    if (ctx.state === 'running') return true;
    try {
      await ctx.resume();
    } catch (err) {
      console.warn('[PcmAudioPlayer] resume failed', err);
    }
    this.emitStats();
    return (ctx.state as string) === 'running';
  }

  /**
   * Queue one binary frame of agent audio. Frames are played in order and
   * scheduled back-to-back on the context timeline.
   */
  enqueue(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 2) return;
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') {
      this.framesDropped++;
      void this.ensure().catch((err) => console.warn('[PcmAudioPlayer] cannot create context', err));
      return;
    }

    // Resample only when the device refused a 24 kHz context.
    let samples = int16ToFloat32(new Int16Array(buffer));
    const rate = ctx.sampleRate;
    if (rate !== AGENT_OUTPUT_SAMPLE_RATE) {
      if (!this.resampler || this.resamplerRate !== rate) {
        this.resampler = new StreamingResampler(AGENT_OUTPUT_SAMPLE_RATE, rate);
        this.resamplerRate = rate;
      }
      samples = this.resampler.process(samples);
    }
    if (samples.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, samples.length, rate);
    audioBuffer.getChannelData(0).set(samples);

    const now = ctx.currentTime;
    const firstOfTurn = !this.turnHasAudio;
    // A turn that ran dry before the next frame arrived is an underrun (audible gap).
    if (!firstOfTurn && now > this.scheduler.bufferedUntil) this.underruns++;

    const startAt = this.scheduler.schedule(samples.length, rate, now, !firstOfTurn);
    if (firstOfTurn) {
      // First frame of a turn: this is the real "time to first audible audio".
      this.lastFirstAudibleDelayMs = Math.round((startAt - now) * 1000);
      this.turnHasAudio = true;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gain!);
    source.onended = () => {
      this.active.delete(source);
      try {
        source.disconnect();
      } catch {
        /* already detached */
      }
      this.emitStats();
    };

    try {
      source.start(startAt);
    } catch (err) {
      console.warn('[PcmAudioPlayer] schedule failed', err);
      this.framesDropped++;
      return;
    }

    // Late frames mean the playout buffer ran dry (underrun) — count them.
    if (startAt < now) this.underruns++;
    this.active.add(source);
    this.framesQueued++;
    this.framesPlayed++;
    this.emitStats();
  }

  /** Stop everything currently queued/scheduled — used for barge-in. */
  flush(): void {
    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
    this.scheduler.reset();
    this.turnHasAudio = false;
    if (this.resampler) this.resampler.reset();
    this.emitStats();
  }

  /** How much audio is still scheduled to play (ms). */
  bufferedMs(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    return Math.max(0, Math.round((this.scheduler.bufferedUntil - ctx.currentTime) * 1000));
  }

  get playing(): boolean {
    return this.active.size > 0;
  }

  getStats(): PlayerStats {
    return {
      playing: this.active.size > 0,
      contextState: (this.ctx?.state as PlayerStats['contextState']) ?? null,
      framesQueued: this.framesQueued,
      framesPlayed: this.framesPlayed,
      framesDropped: this.framesDropped,
      underruns: this.underruns,
      lastFirstAudibleDelayMs: this.lastFirstAudibleDelayMs,
      bufferedMs: this.bufferedMs(),
    };
  }

  /** Reset per-turn counters (called when a new agent turn starts). */
  beginTurn(): void {
    this.turnHasAudio = false;
    if (this.resampler) this.resampler.reset();
  }

  private emitStats() {
    this.onStats?.(this.getStats());
  }

  async close(): Promise<void> {
    this.flush();
    if (this.detachVisibility) {
      this.detachVisibility();
      this.detachVisibility = null;
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.gain = null;
    this.resampler = null;
    this.resamplerRate = null;
    this.scheduler.reset();
    if (ctx && ctx.state !== 'closed') {
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.emitStats();
  }

  resetCounters(): void {
    this.framesQueued = 0;
    this.framesPlayed = 0;
    this.framesDropped = 0;
    this.underruns = 0;
    this.lastFirstAudibleDelayMs = null;
    this.flush();
    this.emitStats();
  }
}
