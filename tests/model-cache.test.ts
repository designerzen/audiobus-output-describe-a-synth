import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Native worker JavaScript module.
import { ModelStore } from "../public/describe-synth/model-cache.js";

function storage() {
  const entries = new Map<string, Response>();
  const cache = {
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => { entries.set(key, new Response(await response.arrayBuffer(), { headers: response.headers })); }),
  };
  return { open: vi.fn(async () => cache), cache };
}

describe("persistent model cache", () => {
  it("fetches once and reuses the weights across fresh worker/store instances", async () => {
    const disk = storage();
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const first = new ModelStore("https://local.test/", vi.fn(), disk, fetcher);
    expect(await first.model("weights.onnx")).toEqual(new Uint8Array([1, 2, 3]));
    const offline = vi.fn(async () => { throw new Error("Network disabled"); });
    const report = vi.fn();
    const second = new ModelStore("https://local.test/", report, disk, offline);
    expect(await second.model("weights.onnx")).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetcher).toHaveBeenCalledOnce(); expect(offline).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ source: "cache" }));
  });
  it("does not cache missing or incomplete model responses", async () => {
    const disk = storage();
    const missing = new ModelStore("https://local.test/", vi.fn(), disk, async () => new Response("missing", { status: 404 }));
    await expect(missing.model("missing.onnx")).rejects.toThrow("missing");
    const partial = new ModelStore("https://local.test/", vi.fn(), disk, async () => new Response("bad", { headers: { "content-length": "3" } }));
    await expect(partial.model("cond.onnx")).rejects.toThrow("Incomplete");
    expect(disk.cache.put).not.toHaveBeenCalled();
  });
  it("reports quota errors instead of silently re-fetching on every request", async () => {
    const disk = storage(); disk.cache.put.mockRejectedValue(new Error("Quota"));
    const model = new ModelStore("https://local.test/", vi.fn(), disk, async () => new Response("weights"));
    await expect(model.model("weights.onnx")).rejects.toThrow("could not be cached");
  });
  it("does not poison the cache with a development server's HTML fallback", async () => {
    const disk = storage();
    const model = new ModelStore("https://local.test/", vi.fn(), disk, async () => new Response("<html>app</html>", { headers: { "content-type": "text/html" } }));
    await expect(model.json("tokenizer.json")).rejects.toThrow("application page");
    expect(disk.cache.put).not.toHaveBeenCalled();
  });
});
