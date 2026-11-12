import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalPipeline } from "../src/output/pipeline-client";

class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: unknown) => void;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
beforeEach(() => { WorkerStub.instances = []; vi.stubGlobal("Worker", WorkerStub); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("streaming speech client", () => {
  it("loads speech on press and emits interim transcripts before section finalisation", async () => {
    const update = vi.fn();
    const speech = new LocalPipeline(`${location.origin}/describe-synth/`).startSpeech(update);
    const worker = WorkerStub.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "speech-start" });
    speech.push(new Float32Array(16000));
    expect(worker.postMessage.mock.calls[1][0].final).toBe(false);
    worker.emit({ type: "transcript", text: "a glass", final: false });
    expect(update).toHaveBeenLastCalledWith("a glass");
    expect(worker.terminate).not.toHaveBeenCalled();
    const final = speech.finish(new Float32Array(32000));
    expect(worker.postMessage.mock.calls[2][0].final).toBe(true);
    worker.emit({ type: "transcript", text: "a glass bell", final: true });
    await expect(final).resolves.toBe("a glass bell");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("rejects finalisation after an earlier model load error", async () => {
    const speech = new LocalPipeline(`${location.origin}/describe-synth/`).startSpeech(vi.fn());
    WorkerStub.instances[0].emit({ type: "error", message: "Speech assets unavailable" });
    await expect(speech.finish(new Float32Array(16000))).rejects.toThrow("Speech assets unavailable");
  });
  it("cancels final transcription and terminates its worker", async () => {
    const speech = new LocalPipeline(`${location.origin}/describe-synth/`).startSpeech(vi.fn());
    const final = speech.finish(new Float32Array(16000));
    speech.cancel();
    await expect(final).rejects.toMatchObject({ name: "AbortError" });
    expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
