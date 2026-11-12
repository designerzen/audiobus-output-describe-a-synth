import { pickRecordingMimeType } from "../lib/audio.js";

/** One physical hold is one segment. A released permission request cannot start capture. */
export class HoldRecorder {
  private held = false;
  private revision = 0;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private tap?: { source: MediaStreamAudioSourceNode; worklet: AudioWorkletNode; silent: GainNode };

  constructor(private callbacks: {
    state: (state: "idle" | "requesting-microphone" | "recording") => void;
    segment: (blob: Blob) => void;
    error: (error: Error) => void;
    partial?: (audio: Float32Array) => void;
  }, private getStream = () => navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  }), private live?: { context: AudioContext; workletUrl: string }) {}

  async press(): Promise<void> {
    if (this.held) return;
    this.held = true;
    const revision = ++this.revision;
    this.callbacks.state("requesting-microphone");
    try {
      const stream = await this.getStream();
      if (!this.held || revision !== this.revision) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      const mimeType = pickRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      const chunks: Blob[] = [];
      recorder.addEventListener("dataavailable", event => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        stream.getTracks().forEach(track => track.stop());
        if (this.stream === stream) this.stream = undefined;
        if (this.recorder === recorder) this.recorder = undefined;
        if (revision !== this.revision) return;
        if (this.held) {
          this.cancel();
          this.callbacks.error(new Error("The microphone stopped before release. Reconnect it and try again."));
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType });
        if (blob.size) this.callbacks.segment(blob);
        else this.callbacks.state("idle");
      }, { once: true });
      recorder.addEventListener("error", () => {
        if (revision !== this.revision) return;
        this.cancel();
        this.callbacks.error(new Error("Microphone recording failed. Try again or type a description."));
      });
      recorder.start();
      this.callbacks.state("recording");
      if (this.live) void this.startTap(stream, revision).catch(error => {
        if (revision !== this.revision || !this.held) return;
        this.cancel();
        this.callbacks.error(new Error(`Live microphone transcription could not start: ${String(error)}. Try a supported browser or type a description.`));
      });
    } catch (error) {
      if (revision !== this.revision) return;
      this.cancel();
      this.callbacks.error(error instanceof Error ? error : new Error(String(error)));
    }
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    this.stopTap();
    if (this.recorder?.state === "recording") {
      // Stop synchronously at release, including final MediaRecorder dataavailable.
      this.recorder.stop();
      this.stream?.getTracks().forEach(track => track.stop());
    } else {
      ++this.revision;
      this.callbacks.state("idle");
    }
  }

  cancel(): void {
    ++this.revision;
    this.held = false;
    this.stopTap();
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getTracks().forEach(track => track.stop());
    this.recorder = undefined;
    this.stream = undefined;
    this.callbacks.state("idle");
  }

  private async startTap(stream: MediaStream, revision: number): Promise<void> {
    const { context, workletUrl } = this.live!;
    await context.audioWorklet.addModule(workletUrl);
    if (revision !== this.revision || !this.held) return;
    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, "describe-synth-capture");
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(worklet); worklet.connect(silent); silent.connect(context.destination);
    this.tap = { source, worklet, silent };
    const chunks: Float32Array[] = [];
    let length = 0, last = 0;
    worklet.port.onmessage = event => {
      if (revision !== this.revision || !this.held) return;
      const block = event.data as Float32Array;
      chunks.push(block); length += block.length;
      if (length - last < context.sampleRate) return;
      last = length;
      const all = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
      const resampled = new Float32Array(Math.floor(length * 16000 / context.sampleRate));
      for (let i = 0; i < resampled.length; i++) {
        const index = i * context.sampleRate / 16000;
        const lower = Math.floor(index), fraction = index - lower;
        resampled[i] = all[lower] * (1 - fraction) + (all[lower + 1] ?? all[lower]) * fraction;
      }
      this.callbacks.partial?.(resampled);
    };
  }

  private stopTap(): void {
    if (!this.tap) return;
    this.tap.source.disconnect(); this.tap.worklet.disconnect(); this.tap.silent.disconnect();
    this.tap.worklet.port.close(); this.tap = undefined;
  }
}
