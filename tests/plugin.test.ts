import { afterEach, describe, expect, it, vi } from "vitest";
import OutputDescribeSynth, { describeSynthPlugin } from "../src/index";
import type { IAudioOutput } from "../src/index";

afterEach(() => vi.unstubAllGlobals());
describe("independent plugin factory", () => {
  it("exposes stable OutputFactory-compatible metadata without registering itself", () => {
    expect(describeSynthPlugin).toMatchObject({ id: "describe-synth", type: "engine", subtype: "instrument", category: "Synthesis" });
    expect(typeof OutputDescribeSynth).toBe("function");
    expect(() => describeSynthPlugin.create()).toThrow("audioContext");
  });
  it("creates an explicit IAudioOutput from host-supplied resources", () => {
    const gain = { gain: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
    const context = { createGain: () => gain, destination: {}, resume: async () => {} };
    const output: IAudioOutput = describeSynthPlugin.create({
      audioContext: context, assetBaseUrl: `${location.origin}/plugin/`, pipeline: { prepare: vi.fn() },
    });
    expect(output.name).toBe("Describe a Synth");
    expect(output.hasAudioOutput?.()).toBe(true);
    expect(gain.connect).toHaveBeenCalledWith(context.destination);
    void output.disconnect?.();
  });
});
