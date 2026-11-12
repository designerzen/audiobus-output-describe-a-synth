import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Native worker JavaScript.
import { cosineSimilarity, rankCandidates, resample, loopbackEndpoint } from "../public/describe-synth/candidates.js";

describe("local candidate selection", () => {
  it("ranks cosine similarity across candidates, rather than softmax over one label", async () => {
    const disposeText = vi.fn(), disposeAudio = vi.fn();
    const text = Object.assign(vi.fn(async () => ({ text_embeds: { data: [1, 0] } })), { dispose: disposeText });
    const audio = Object.assign(vi.fn()
      .mockResolvedValueOnce({ audio_embeds: { data: [0, 1] } })
      .mockResolvedValueOnce({ audio_embeds: { data: [1, 0] } }), { dispose: disposeAudio });
    const processor = Object.assign(vi.fn(async (pcm: Float32Array) => ({ pcm })), { feature_extractor: { config: { sampling_rate: 48000 } } });
    const lib = {
      AutoTokenizer: { from_pretrained: vi.fn(async () => vi.fn(() => ({}))) },
      AutoProcessor: { from_pretrained: vi.fn(async () => processor) },
      ClapTextModelWithProjection: { from_pretrained: vi.fn(async () => text) },
      ClapAudioModelWithProjection: { from_pretrained: vi.fn(async () => audio) },
    };
    const originals = [Float32Array.of(1, 0), Float32Array.of(0, 1)];
    const candidates = originals.map((pcm, seed) => ({ pcm, originalPcm: pcm, sampleRate: 48000, seed }));
    const ranked = await rankCandidates(candidates, "dog bark", lib);
    expect(ranked[0].seed).toBe(1); expect(ranked[0].similarity).toBe(1);
    expect(disposeText).toHaveBeenCalledOnce(); expect(disposeAudio).toHaveBeenCalledOnce();
    expect(processor).toHaveBeenCalledWith(originals[0]);
  });
  it("rejects invalid embeddings and restricts companions to this device", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(() => cosineSimilarity([0, 0], [1, 0])).toThrow();
    expect(() => cosineSimilarity([1], [1, 0])).toThrow();
    expect(loopbackEndpoint("http://127.0.0.1:8794/")).toBe("http://127.0.0.1:8794/generate");
    for (const url of ["https://example.com", "http://127.0.0.1.evil.test", "http://user@localhost"]) expect(() => loopbackEndpoint(url)).toThrow();
  });
  it("resamples using the model's required rate without changing duration", () => {
    const input = Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 44100));
    const output = resample(input, 44100, 48000);
    expect(output.length).toBe(48000);
    expect(Math.abs(output[60] - Math.sin(2 * Math.PI * 220 * 60 / 48000))).toBeLessThan(0.001);
  });
});
