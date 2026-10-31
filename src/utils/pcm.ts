/**
 * PCM helpers shared by the microphone upload path and the agent-audio
 * playback path.
 *
 * The resampler is *streaming*: state (fractional read position + last sample
 * of the previous chunk) is carried between calls, so chunk boundaries do not
 * introduce clicks and the output sample count never drifts, even for
 * fractional ratios such as 44100 -> 24000 (1.8375).
 */

/** Convert Float32 [-1, 1] samples to signed 16-bit little-endian PCM. */
export function floatTo16BitPCM(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    const clamped = s < -1 ? -1 : s > 1 ? 1 : Number.isFinite(s) ? s : 0;
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/** Convert signed 16-bit PCM (little-endian view) to Float32 [-1, 1]. */
export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] / 0x8000;
  }
  return out;
}

/** Wrap Int16 samples into a little-endian ArrayBuffer ready for `ws.send`. */
export function int16ToArrayBuffer(pcm: Int16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(pcm.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(i * 2, pcm[i], true);
  }
  return buffer;
}

/** Interpret an incoming binary frame as little-endian Int16 samples. */
export function arrayBufferToInt16(buffer: ArrayBuffer): Int16Array {
  return new Int16Array(buffer);
}

/**
 * Stateful linear-interpolation resampler.
 *
 * `process()` may be called with arbitrary chunk sizes; concatenating all
 * outputs yields the same result as resampling the whole signal at once, and
 * `samplesOut` grows as `samplesIn / ratio` (no drift).
 */
export class StreamingResampler {
  private readonly ratio: number;
  private nextAbs = 0;
  private samplesSeen = 0;
  private prevLast: number | null = null;

  constructor(
    private readonly inRate: number,
    private readonly outRate: number
  ) {
    if (!(inRate > 0) || !(outRate > 0)) {
      throw new Error(`Invalid sample rates: ${inRate} -> ${outRate}`);
    }
    this.ratio = inRate / outRate;
  }

  get passthrough(): boolean {
    return this.inRate === this.outRate;
  }

  reset(): void {
    this.nextAbs = 0;
    this.samplesSeen = 0;
    this.prevLast = null;
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) return new Float32Array(0);
    if (this.passthrough) {
      this.samplesSeen += input.length;
      this.prevLast = input[input.length - 1];
      return input;
    }

    const base = this.samplesSeen;
    const end = base + input.length;
    this.samplesSeen = end;

    // Upper bound on output length for this chunk (plus slack for carry-over).
    const maxOut = Math.ceil(input.length / this.ratio) + 2;
    const out = new Float32Array(maxOut);
    let written = 0;
    let abs = this.nextAbs;

    while (written < maxOut) {
      const i0 = Math.floor(abs);
      const i1 = i0 + 1;
      // Need sample i1 to exist before emitting; otherwise wait for the next chunk.
      if (i1 >= end) break;
      const s0 = i0 < base ? (this.prevLast ?? input[0]) : input[i0 - base];
      const s1 = input[i1 - base];
      const frac = abs - i0;
      out[written++] = s0 + (s1 - s0) * frac;
      abs += this.ratio;
    }

    // Do not lose the fractional position: subtract the consumed input.
    this.nextAbs = abs;
    this.prevLast = input[input.length - 1];
    return written === out.length ? out : out.subarray(0, written).slice();
  }
}

/** Number of samples in `ms` milliseconds at `sampleRate`. */
export function samplesForMs(ms: number, sampleRate: number): number {
  return Math.round((ms / 1000) * sampleRate);
}

/**
 * Accumulates arbitrary-sized Float32 chunks into fixed-size PCM frames.
 * Used to turn AudioWorklet blocks (128 samples) into 20 ms uplink frames.
 */
export class PcmFramer {
  private readonly buffer: Float32Array;
  private filled = 0;

  constructor(
    public readonly frameSamples: number,
    public readonly sampleRate: number
  ) {
    this.buffer = new Float32Array(frameSamples);
  }

  get frameDurationMs(): number {
    return (this.frameSamples / this.sampleRate) * 1000;
  }

  /** Push samples, invoking `emit` once per completed frame. */
  push(samples: Float32Array, emit: (frame: Float32Array) => void): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.frameSamples - this.filled, samples.length - offset);
      this.buffer.set(samples.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSamples) {
        emit(this.buffer);
        this.filled = 0;
      }
    }
  }

  /** Emit the partially filled frame (if any) — used on stop/flush. */
  flush(emit: (frame: Float32Array) => void): void {
    if (this.filled > 0) {
      emit(this.buffer.subarray(0, this.filled));
      this.filled = 0;
    }
  }

  reset(): void {
    this.filled = 0;
  }

  /** Build a silent frame (same shape as a real one). */
  silence(): Float32Array {
    return new Float32Array(this.frameSamples);
  }
}
