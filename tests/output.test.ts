import { afterEach, describe, expect, it, vi } from "vitest";
import OutputDescribeSynth from "../src/output/output-describe-synth";
import type { PatchPipeline, PreparedPatch } from "../src/output/types";

function context() {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelAndHoldAtTime: vi.fn() });
  return {
    currentTime: 5, destination: {}, resume: vi.fn(async () => {}),
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createBuffer: vi.fn(() => ({ copyToChannel: vi.fn() })),
    createBufferSource: vi.fn(() => ({ playbackRate: param(), detune: param(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), addEventListener: vi.fn() })),
  };
}
const patch = (description = "cello"): PreparedPatch => ({
  version: 1, description, pcm: new Float32Array(44100).fill(0.1), sampleRate: 44100,
  rootFrequency: 220, confidence: 0.99, mode: "sample", seed: 1, model: "test",
  spec: { prompt: description, attack: 0.01, release: 0.2, oneShot: false }, loopStart: 0.2, loopEnd: 0.8,
});
const outputs: OutputDescribeSynth[] = [];
afterEach(() => { outputs.splice(0).forEach(output => output.destroy()); vi.unstubAllGlobals(); });
function setup(pipeline: PatchPipeline = { prepare: vi.fn(async () => patch()) }) {
  const audio = context();
  const output = new OutputDescribeSynth({ audioContext: audio as unknown as AudioContext, pipeline });
  outputs.push(output); return { output, audio, pipeline };
}

describe("HarmonEasy Output", () => {
  it("plays polyphonic, independently pitched notes on different channels without inference in note handlers", async () => {
    const { output, audio, pipeline } = setup();
    await output.describe("cello");
    output.sendCommand({ type: "noteOn", number: 69, velocity: 100, channel: 2 });
    output.sendCommand({ type: "noteOn", number: 60, velocity: 80, channel: 3 });
    const sources = audio.createBufferSource.mock.results.map(result => result.value);
    expect(sources).toHaveLength(2); expect(sources[0].playbackRate.value).toBe(2);
    output.sendCommand({ type: "noteOff", number: 69, channel: 2 });
    expect(sources[0].stop).toHaveBeenCalledOnce(); expect(sources[1].stop).not.toHaveBeenCalled();
    expect(pipeline.prepare).toHaveBeenCalledOnce();
    output.allNotesOff(); expect(sources[1].stop).toHaveBeenCalledOnce();
  });
  it("keeps held voices across replacement and does not wait for generation to release notes", async () => {
    let resolve!: (value: PreparedPatch) => void;
    const { output, audio } = setup({ prepare: vi.fn().mockResolvedValueOnce(patch()).mockImplementationOnce(() => new Promise(accept => { resolve = accept; })) });
    await output.describe("cello"); output.noteOn(60);
    const first = audio.createBufferSource.mock.results[0].value;
    const pending = output.describe("bell"); await Promise.resolve();
    output.noteOff(60); expect(first.stop).toHaveBeenCalledOnce();
    resolve(patch("bell")); await pending;
    expect(output.options.patch?.description).toBe("bell");
  });
  it("plays unpitched source textures at original speed on the middle-C key", async () => {
    const texture: PreparedPatch = { ...patch("dog bark"), mode: "source-texture", confidence: 0,
      rootFrequency: 261.6255653005986, spec: { ...patch().spec, oneShot: true } };
    const { output, audio } = setup({ prepare: vi.fn(async () => texture) });
    await output.describe("dog bark"); output.noteOn(60);
    const source = audio.createBufferSource.mock.results[0].value;
    expect(source.playbackRate.value).toBeCloseTo(1, 10); expect(source.loop).toBe(false);
  });
  it("cancels stale results and preserves the previously prepared patch after failure", async () => {
    let resolve!: (value: PreparedPatch) => void;
    const pipeline = { prepare: vi.fn().mockResolvedValueOnce(patch()).mockImplementationOnce(() => new Promise(accept => { resolve = accept; })).mockRejectedValueOnce(new Error("GPU unavailable")) };
    const { output } = setup(pipeline);
    await output.describe("cello");
    const pending = output.describe("old request"); await Promise.resolve();
    output.cancelPreparation(); resolve(patch("stale")); await pending;
    expect(output.options.patch?.description).toBe("cello");
    await output.describe("new request");
    expect(output.state.message).toBe("GPU unavailable");
    expect(output.options.patch?.description).toBe("cello");
  });
  it("honours sustain, velocity-zero NoteOff and panic including release tails", async () => {
    const { output, audio } = setup(); await output.describe("cello"); output.noteOn(60);
    const source = audio.createBufferSource.mock.results[0].value;
    output.sendCommand({ type: "controlChange", number: 64, value: 127 }); output.noteOn(60, 0);
    expect(source.stop).not.toHaveBeenCalled();
    output.sendCommand({ type: "controlChange", number: 64, value: 0 }); expect(source.stop).toHaveBeenCalledOnce();
    output.allNotesOff(); expect(source.stop).toHaveBeenLastCalledWith(5.015);
  });
  it("restores without inference and ignores notes after disconnect", async () => {
    const { output, audio, pipeline } = setup(); await output.describe("cello");
    const restored = new OutputDescribeSynth({ audioContext: audio as unknown as AudioContext, pipeline, patch: output.options.patch }); outputs.push(restored);
    restored.noteOn(60); expect(audio.createBufferSource).toHaveBeenCalledOnce();
    await restored.disconnect(); restored.noteOn(64);
    expect(audio.createBufferSource).toHaveBeenCalledOnce(); expect(pipeline.prepare).toHaveBeenCalledOnce();
  });
  it("starts speech recognition on press and remains recording while partial text arrives", async () => {
    let interim!: (text: string) => void;
    const speech = { push: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    const startSpeech = vi.fn(update => { interim = update; return speech; });
    const { output } = setup({ prepare: vi.fn(), startSpeech });
    // Permission deliberately remains pending while the GUI hold is active.
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise(() => {}) } });
    const gui = await output.createGui(); document.body.append(gui);
    const button = gui.querySelector("button")!;
    button.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true }));
    expect(startSpeech).toHaveBeenCalledOnce();
    interim("a flute made of ice");
    expect(gui.querySelector("textarea")!.value).toBe("a flute made of ice");
    expect(output.state.stage).toBe("requesting-microphone");
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
    expect(speech.cancel).toHaveBeenCalled();
  });
  it("exposes ranked alternatives and preserves source previews without further inference", async () => {
    const first = { ...patch("dog bark"), seed: 11, similarity: 0.4, originalPcm: new Float32Array(44100).fill(0.2), spec: { ...patch().spec, oneShot: true } };
    const second = { ...first, seed: 22, similarity: 0.3 };
    const prepare = vi.fn(async (_request, _signal, update) => {
      update({ stage: "preparing", message: "Alternatives ready.", candidates: [first, second] });
      return first;
    });
    const { output, audio } = setup({ prepare });
    const gui = await output.createGui();
    await output.describe("dog bark");
    expect(prepare.mock.calls[0][0].candidateCount).toBe(3);
    const alternatives = gui.querySelector<HTMLSelectElement>("[data-alternatives]")!;
    expect(alternatives.options).toHaveLength(2);
    alternatives.value = "1"; alternatives.dispatchEvent(new Event("change"));
    expect(output.options.patch!.seed).toBe(22);
    output.setPitchEmphasis(0.5);
    expect(output.options.patch!.pitchEmphasis).toBe(0.5);
    expect(output.options.patch!.originalPcm16).toBeDefined();
    await output.preview("original");
    const original = audio.createBufferSource.mock.results.at(-1)!.value;
    expect(original.playbackRate.value).toBe(1);
    await output.preview("playable", 69);
    expect(original.stop).toHaveBeenCalledOnce();
    const playable = audio.createBufferSource.mock.results.at(-1)!.value;
    expect(playable.playbackRate.value).toBe(2); expect(playable.loop).toBe(false);
    await output.disconnect(); expect(playable.stop).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
  });
});
