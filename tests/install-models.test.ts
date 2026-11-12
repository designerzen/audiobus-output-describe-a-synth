import { describe, expect, it, vi } from "vitest";
vi.mock("../public/describe-synth/model-manifest.js", () => ({ MODEL_FILES: [
  { path: "sound/test.onnx", bytes: 4, url: "https://weights.test/pinned/test.onnx" },
  { path: "clap/config.json", bytes: 2, url: "https://weights.test/pinned/config.json" },
] }));
// @ts-expect-error Browser-native module.
import { installModels, modelStatus } from "../public/describe-synth/install-models.js";

function storage() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (url: string) => entries.get(url)?.clone()),
    put: vi.fn(async (url: string, response: Response) => { entries.set(url, new Response(await response.arrayBuffer(), { headers: response.headers })); }),
  };
  return { open: vi.fn(async () => cache), cache };
}
const base = "https://example.test/repo/describe-synth/";
describe("hosted demo model setup", () => {
  it("caches pinned setup downloads under repository-local worker URLs and reuses them", async () => {
    const disk = storage();
    const fetcher = vi.fn(async (url: string) => new Response(url.endsWith("json") ? "{}" : "onnx", { headers: { "content-length": "1" } }));
    await installModels(base, { storage: disk, fetcher });
    expect((await modelStatus(base, disk)).ready).toBe(true);
    expect(disk.cache.put.mock.calls.map(call => call[0])).toEqual([
      `${base}models/sound/test.onnx`, `${base}models/clap/config.json`,
    ]);
    await installModels(base, { storage: disk, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects incorrect bodies and HTML without poisoning the cache", async () => {
    const disk = storage();
    await expect(installModels(base, { storage: disk, fetcher: async () => new Response("bad") })).rejects.toThrow("file size");
    await expect(installModels(base, { storage: disk, fetcher: async () => new Response("<html>", { headers: { "content-type": "text/html" } }) })).rejects.toThrow("web page");
    expect(disk.cache.put).not.toHaveBeenCalled();
  });
  it("retains completed files when cancelled, then resumes only missing files", async () => {
    const disk = storage(), controller = new AbortController();
    const fetcher = vi.fn(async (url: string) => new Response(url.endsWith("json") ? "{}" : "onnx"));
    await expect(installModels(base, { storage: disk, signal: controller.signal, fetcher,
      report: (event: { completed: number }) => { if (event.completed === 1) controller.abort(); },
    })).rejects.toThrow();
    expect((await modelStatus(base, disk)).missing).toHaveLength(1);
    await installModels(base, { storage: disk, fetcher });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("validates the complete imported folder before writing any model", async () => {
    const disk = storage();
    await expect(installModels(base, { storage: disk, files: [] })).rejects.toThrow("Missing or incorrect");
    expect(disk.cache.put).not.toHaveBeenCalled();
  });
});
