/**
 * Pure timing math for gapless PCM playback scheduling.
 *
 * Kept separate from `PcmAudioPlayer` (which needs Web Audio) so the scheduling
 * behaviour can be unit tested in Node — see `tests/playbackScheduler.test.ts`.
 */
export class PlaybackScheduler {
  private nextStart = 0;

  constructor(
    /** Extra lead time added in front of the very first chunk of a turn. */
    public leadSeconds = 0.06
  ) {}

  /**
   * Returns the AudioContext timestamp at which the next chunk should start.
   * Consecutive chunks butt up against each other (no gaps, no overlap).
   *
   * @param samples   number of output samples in the chunk
   * @param rate      output sample rate (Hz)
   * @param now       AudioContext.currentTime
   * @param scheduled whether a chunk is already queued (false => turn start)
   */
  schedule(samples: number, rate: number, now: number, scheduled = true): number {
    const duration = samples / rate;
    const earliest = now + this.leadSeconds;
    const start = scheduled && this.nextStart > now ? Math.max(earliest, this.nextStart) : earliest;
    this.nextStart = start + duration;
    return start;
  }

  /** Seconds of audio already committed to the future timeline. */
  get bufferedUntil(): number {
    return this.nextStart;
  }

  reset(): void {
    this.nextStart = 0;
  }
}
