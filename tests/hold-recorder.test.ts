import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoldRecorder } from "../src/output/hold-recorder";

class Recorder extends EventTarget {
  static instances: Recorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  constructor() { super(); Recorder.instances.push(this); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob(["final audio"]) }));
      this.dispatchEvent(new Event("stop"));
    });
  }
}
beforeEach(() => { Recorder.instances = []; vi.stubGlobal("MediaRecorder", Recorder); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const callbacks = () => ({ state: vi.fn(), segment: vi.fn(), error: vi.fn() });
const stream = () => { const stop = vi.fn(); return { value: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop }; };

describe("hold-to-record boundaries", () => {
  it("does not record when permission resolves after release", async () => {
    let grant!: (value: MediaStream) => void;
    const microphone = stream(), callback = callbacks();
    const hold = new HoldRecorder(callback, () => new Promise(resolve => { grant = resolve; }));
    const pending = hold.press(); hold.release(); grant(microphone.value); await pending;
    expect(Recorder.instances).toHaveLength(0);
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(callback.segment).not.toHaveBeenCalled();
  });

  it("release stops capture immediately and submits exactly one final segment", async () => {
    const microphone = stream(), callback = callbacks();
    const hold = new HoldRecorder(callback, async () => microphone.value);
    await hold.press();
    expect(callback.segment).not.toHaveBeenCalled();
    hold.release(); hold.release();
    expect(Recorder.instances[0].state).toBe("inactive");
    expect(microphone.stop).toHaveBeenCalled();
    await Promise.resolve();
    expect(callback.segment).toHaveBeenCalledOnce();
    expect(callback.segment.mock.calls[0][0].size).toBeGreaterThan(0);
  });

  it("cancel discards recording and invalidates late permission requests", async () => {
    const microphone = stream(), callback = callbacks();
    const hold = new HoldRecorder(callback, async () => microphone.value);
    await hold.press(); hold.cancel(); await Promise.resolve();
    expect(callback.segment).not.toHaveBeenCalled();
    expect(microphone.stop).toHaveBeenCalled();
  });

  it("ignores repeat presses and never submits a section while the hold continues", async () => {
    vi.useFakeTimers();
    const callback = callbacks(), getStream = vi.fn(async () => stream().value);
    const hold = new HoldRecorder(callback, getStream);
    await hold.press(); await hold.press();
    expect(getStream).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(callback.segment).not.toHaveBeenCalled();
    expect(Recorder.instances[0].state).toBe("recording");
    hold.release(); await Promise.resolve();
    expect(callback.segment).toHaveBeenCalledOnce();
  });

  it("reports a permission failure without emitting a section", async () => {
    const callback = callbacks();
    const hold = new HoldRecorder(callback, async () => { throw new DOMException("Denied", "NotAllowedError"); });
    await hold.press();
    expect(callback.error).toHaveBeenCalledOnce();
    expect(callback.segment).not.toHaveBeenCalled();
  });
});
