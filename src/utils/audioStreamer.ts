/**
 * Live Browser Microphone Audio Streamer
 * Captures user microphone input, resamples to 24kHz Int16 linear PCM,
 * computes live RMS volume, and streams binary audio frames over WebSocket.
 */

export class AudioStreamer {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isMuted: boolean = false;
  private isStreaming: boolean = false;

  public async requestMicrophone(): Promise<MediaStream> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Your browser does not support microphone media recording (MediaDevices API missing).');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.mediaStream = stream;
      return stream;
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone permission denied by user or browser security policy.');
      }
      throw new Error(`Failed to access microphone: ${err.message || err.name}`);
    }
  }

  public async startStreaming(
    ws: WebSocket,
    onVolume: (rmsLevel: number) => void,
    onChunkSent: () => void
  ): Promise<void> {
    if (this.isStreaming) return;

    if (!this.mediaStream) {
      await this.requestMicrophone();
    }

    if (!this.mediaStream) {
      throw new Error('No active audio stream available.');
    }

    // Audio Context - 24000 Hz target preferred, fallback to system sample rate
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    try {
      this.audioContext = new AudioContextClass({ sampleRate: 24000 });
    } catch (e) {
      this.audioContext = new AudioContextClass();
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const nativeSampleRate = this.audioContext.sampleRate;
    const targetSampleRate = 24000;

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    // ScriptProcessor with 2048 buffer size
    this.scriptNode = this.audioContext.createScriptProcessor(2048, 1, 1);

    this.scriptNode.onaudioprocess = (event) => {
      if (!this.isStreaming || this.isMuted) {
        onVolume(0);
        return;
      }

      const inputBuffer = event.inputBuffer.getChannelData(0);

      // Compute RMS volume for live VU meter (0 - 100%)
      let sumSquares = 0;
      for (let i = 0; i < inputBuffer.length; i++) {
        sumSquares += inputBuffer[i] * inputBuffer[i];
      }
      const rms = Math.sqrt(sumSquares / inputBuffer.length);
      // Map RMS to percentage curve
      const volumePct = Math.min(100, Math.round(rms * 250));
      onVolume(volumePct);

      // Resample to 24000 Hz if needed
      const resampled = this.resampleFloat32(inputBuffer, nativeSampleRate, targetSampleRate);

      // Convert Float32 to 16-bit Int PCM
      const pcm16Buffer = this.convertFloatTo16BitPCM(resampled);

      // Stream binary frame over WebSocket if connected
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(pcm16Buffer);
          onChunkSent();
        } catch (err) {
          console.error('[AudioStreamer] Error sending audio chunk:', err);
        }
      }
    };

    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.audioContext.destination);
    this.isStreaming = true;
  }

  public setMute(muted: boolean): void {
    this.isMuted = muted;
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
    }
  }

  public stopStreaming(): void {
    this.isStreaming = false;

    if (this.scriptNode) {
      this.scriptNode.disconnect();
      this.scriptNode.onaudioprocess = null;
      this.scriptNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }
  }

  private resampleFloat32(
    inputData: Float32Array,
    inSampleRate: number,
    outSampleRate: number
  ): Float32Array {
    if (inSampleRate === outSampleRate) return inputData;
    const ratio = inSampleRate / outSampleRate;
    const newLength = Math.round(inputData.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const originIndex = i * ratio;
      const index1 = Math.floor(originIndex);
      const index2 = Math.min(index1 + 1, inputData.length - 1);
      const fraction = originIndex - index1;
      result[i] = inputData[index1] * (1 - fraction) + inputData[index2] * fraction;
    }
    return result;
  }

  private convertFloatTo16BitPCM(float32Array: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
  }
}
