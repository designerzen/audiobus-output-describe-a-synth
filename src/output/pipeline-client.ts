import type { PatchPipeline, PipelineRequest, PipelineUpdate, PreparedPatch, SpeechSession } from "./types.js";

export class LocalPipeline implements PatchPipeline {
  constructor(private baseUrl: string) {
    if (new URL(baseUrl).origin !== location.origin) {
      throw new Error("Describe a Synth assets must be served on this device's application origin.");
    }
  }

  startSpeech(update: (text: string) => void): SpeechSession {
    return new LiveSpeech(new URL("pipeline.worker.js", this.baseUrl), update);
  }

  prepare(request: PipelineRequest, signal: AbortSignal, update: (value: PipelineUpdate) => void): Promise<PreparedPatch> {
    if (signal.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("pipeline.worker.js", this.baseUrl), { type: "module" });
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        worker.terminate();
      };
      const abort = () => { finish(); reject(new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => {
        finish();
        reject(new Error("Local preparation timed out. The current instrument is still available."));
      }, 900_000);
      signal.addEventListener("abort", abort, { once: true });
      worker.addEventListener("message", event => {
        const message = event.data;
        if (message.type === "update") update(message.value);
        if (message.type === "result") {
          update({ stage: "preparing", message: message.warning || "Alternatives ready.", candidates: message.candidates });
          finish(); resolve(message.patch);
        }
        if (message.type === "error") { finish(); reject(new Error(message.message)); }
      });
      worker.addEventListener("error", event => {
        finish();
        reject(new Error(event.message || "The local audio worker stopped unexpectedly."));
      });
      worker.postMessage(request, request.audio ? [request.audio.buffer] : []);
    });
  }
}

class LiveSpeech implements SpeechSession {
  private worker: Worker;
  private failure?: Error;
  private cancelled = false;
  private final?: { resolve: (text: string) => void; reject: (error: Error) => void };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(url: URL, update: (text: string) => void) {
    this.worker = new Worker(url, { type: "module" });
    const fail = (error: Error) => {
      this.failure = error;
      this.final?.reject(error);
      this.worker.terminate();
      clearTimeout(this.timer);
    };
    this.worker.onmessage = event => {
      if (event.data.type === "transcript") {
        update(event.data.text);
        if (event.data.final) {
          this.final?.resolve(event.data.text);
          this.worker.terminate(); clearTimeout(this.timer);
        }
      }
      if (event.data.type === "error") fail(new Error(event.data.message));
    };
    this.worker.onerror = event => fail(new Error(event.message || "Local speech recognition failed."));
    this.worker.postMessage({ type: "speech-start" });
  }
  push(audio: Float32Array): void {
    if (!this.cancelled && !this.failure && !this.final) this.worker.postMessage({ type: "speech-audio", audio, final: false }, [audio.buffer]);
  }
  finish(audio: Float32Array): Promise<string> {
    if (this.cancelled) return Promise.reject(new DOMException("Cancelled", "AbortError"));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.final = { resolve, reject };
      this.timer = setTimeout(() => {
        this.worker.terminate();
        this.failure = new Error("Local speech recognition timed out.");
        reject(this.failure);
      }, 60_000);
      this.worker.postMessage({ type: "speech-audio", audio, final: true }, [audio.buffer]);
    });
  }
  cancel(): void {
    this.cancelled = true;
    this.worker.terminate(); clearTimeout(this.timer);
    this.final?.reject(new DOMException("Cancelled", "AbortError"));
  }
}
