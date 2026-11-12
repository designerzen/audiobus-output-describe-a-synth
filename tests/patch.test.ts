import { describe, expect, it } from "vitest";
// Worker-side pure DSP is intentionally shipped as a native JavaScript module.
// @ts-expect-error Browser worker module has no generated declaration.
import { applyPitchEmphasis, estimatePitch, interpret, preparePatch } from "../public/describe-synth/patch.js";
import { restorePatch, savePatch } from "../src/output/patch-storage";

const tone = (frequency: number) => Float32Array.from({ length: 44100 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * frequency * i / 44100));

describe("patch preparation", () => {
  it("estimates musical pitch within ten cents and does not label a sample as a fixed C", () => {
    for (const frequency of [110, 220, 261.6256, 440, 523.251]) {
      const pitch = estimatePitch(tone(frequency), 44100);
      expect(Math.abs(1200 * Math.log2(pitch.frequency / frequency))).toBeLessThan(10);
      expect(pitch.confidence).toBeGreaterThan(0.82);
    }
  });
  it("retains free-form descriptions and extracts playing characteristics", () => {
    const spec = interpret("A flute made of ice, with a slow attack and short release");
    expect(spec.prompt).toContain("flute made of ice");
    expect(spec.attack).toBe(0.15); expect(spec.release).toBe(0.08);
    expect(interpret("A glass impact").oneShot).toBe(true);
  });
  it("preserves unpitched source identity and saves/restores original and playable audio", () => {
    let state = 12;
    const noise = Float32Array.from({ length: 44100 }, () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return state / 2147483648; });
    const patch = preparePatch(noise, 44100, "Ocean waves", 123);
    expect(patch.mode).toBe("source-texture"); expect(patch.rootFrequency).toBeCloseTo(261.625565, 5);
    expect(estimatePitch(patch.pcm, 44100).confidence).toBe(0);
    expect(patch.originalPcm).toEqual(noise);
    expect(applyPitchEmphasis(patch.pcm, 44100, 110, 0)).toEqual(patch.pcm);
    const restored = restorePatch(savePatch(patch));
    expect(restored.description).toBe("Ocean waves"); expect(restored.seed).toBe(123);
    expect(restored.pcm.length).toBe(patch.pcm.length);
    expect(Math.abs(restored.pcm[1000] - patch.pcm[1000])).toBeLessThan(0.00004);
    expect(Math.abs(restored.originalPcm![1000] - noise[1000])).toBeLessThan(0.00004);
  });
  it("uses animal/event descriptions without imposing a sustained instrument", () => {
    for (const text of ["woof", "A dog barking", "Make it sound like a dinosaur"]) {
      const spec = interpret(text);
      expect(spec.oneShot).toBe(true);
      expect(spec.prompt).not.toContain("sustained instrument");
    }
    expect(interpret("woof").prompt).toContain("dog bark");
    expect(interpret("A continuous dinosaur roar").oneShot).toBe(false);
    expect(interpret("A flute made of ice").semanticPrompt).toBe("A flute made of ice");
  });
  it("adds source-driven resonance without inventing audio from silence", () => {
    const silent = new Float32Array(4410);
    expect(applyPitchEmphasis(silent, 44100, 110, 1)).toEqual(silent);
    const impulse = new Float32Array(44100); impulse[0] = 0.5;
    const resonant = applyPitchEmphasis(impulse, 44100, 110, 1);
    expect(Math.abs(resonant[401])).toBeGreaterThan(0.1);
    expect(resonant.every(Number.isFinite)).toBe(true);
    expect(() => applyPitchEmphasis(impulse, 44100, 110, 2)).toThrow();
  });
  it("rejects silence, invalid output and corrupt imported patch metadata", () => {
    expect(() => preparePatch(new Float32Array(44100), 44100, "silence", 1)).toThrow("silent");
    expect(() => restorePatch({ version: 1, pcm16: "garbage" })).toThrow();
    const patch = savePatch(preparePatch(tone(220), 44100, "cello", 1));
    expect(() => restorePatch({ ...patch, rootFrequency: 0 })).toThrow();
    expect(() => restorePatch({ ...patch, loopEnd: 999 })).toThrow();
  });
});
