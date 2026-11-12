export const MODEL_CACHE_NAME = "describe-synth-models-v1-sound-8f9544df-speech-a6da1241";
const SIZES = { "cond.onnx": 439547211, "dit.onnx": 1364171978, "dec.onnx": 312575029 };

/** Persistent storage shared by fresh workers; inference sessions remain disposable. */
export class ModelStore {
  constructor(base, report = () => {}, storage = globalThis.caches, fetcher = globalThis.fetch.bind(globalThis)) {
    this.base = base;
    this.report = report;
    this.storage = storage;
    this.fetcher = fetcher;
  }
  async cache() {
    if (!this.storage) throw new Error("Persistent model caching is unavailable. Use a supported localhost/HTTPS browser.");
    return this.storage.open(MODEL_CACHE_NAME);
  }
  async response(path) {
    const url = new URL(path, this.base).href;
    const cache = await this.cache();
    const load = async () => {
      const cached = await cache.match(url);
      if (cached) {
        this.report({ source: "cache", path, message: `Using cached ${path.split("/").pop()} — no download.` });
        return cached;
      }
      this.report({ source: "network", path, message: `Caching ${path.split("/").pop()} for future requests…` });
      const response = await this.fetcher(url);
      if (!response.ok) throw new Error("Local model assets are missing. Run the model setup command before using this plugin.");
      if ((response.headers.get("content-type") || "").includes("text/html")) {
        throw new Error("Local model assets are missing; the server returned an application page instead of model data.");
      }
      const expected = SIZES[path.split("/").pop()];
      const length = Number(response.headers.get("content-length"));
      if (expected && length && length !== expected) throw new Error(`Incomplete model asset: ${path}`);
      try {
        // Consume directly into disk-backed CacheStorage; don't tee a multi-GB response.
        await cache.put(url, response);
      } catch (error) {
        throw new Error(`The model could not be cached (${error?.name || "storage error"}). Check free disk/browser storage and retry; the current instrument is unchanged.`);
      }
      const stored = await cache.match(url);
      if (!stored) throw new Error("The model cache write did not complete. Please retry.");
      return stored;
    };
    if (globalThis.navigator?.locks) return globalThis.navigator.locks.request(`${MODEL_CACHE_NAME}:${url}`, load);
    return load();
  }
  async model(path) { return new Uint8Array(await (await this.response(path)).arrayBuffer()); }
  async json(path) { return (await this.response(path)).json(); }
}
