import { MODEL_FILES } from "./model-manifest.js";
import { ModelStore, MODEL_CACHE_NAME } from "./model-cache.js";

export async function modelStatus(base, storage = globalThis.caches) {
  const cache = await new ModelStore(base, () => {}, storage).cache();
  const missing = [];
  for (const file of MODEL_FILES) {
    const response = await cache.match(new URL(`models/${file.path}`, base).href);
    if (!response || Number(response.headers.get("content-length")) !== file.bytes) missing.push(file);
  }
  return { ready: !missing.length, missing, total: MODEL_FILES.length };
}

/** Stream setup files into the same local cache used by the workers. No multi-GB JS buffers. */
export async function installModels(base, { files, signal, report = () => {}, storage = globalThis.caches, fetcher = globalThis.fetch.bind(globalThis) } = {}) {
  const cache = await new ModelStore(base, () => {}, storage).cache();
  const status = await modelStatus(base, storage);
  const selected = files ? new Map(Array.from(files, file => {
    const parts = file.webkitRelativePath.split("/");
    const start = parts.findIndex(part => ["sound", "moonshine", "clap"].includes(part));
    return [parts.slice(start).join("/"), file];
  })) : undefined;
  // Check the entire selection first; don't leave an avoidable half-imported folder.
  if (selected) for (const file of status.missing) {
    const input = selected.get(file.path);
    if (!input || input.size !== file.bytes) throw new Error(`Missing or incorrect model file: ${file.path}. Select the models folder created by setup:models.`);
  }
  let completed = status.total - status.missing.length;
  const required = status.missing.reduce((total, file) => total + file.bytes, 0);
  if (globalThis.navigator?.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    if (estimate.quota && estimate.quota - (estimate.usage || 0) < required * 1.05) throw new Error("Not enough browser storage for the models. Free disk/browser storage and retry.");
  }
  for (const file of status.missing) {
    signal?.throwIfAborted();
    const url = new URL(`models/${file.path}`, base).href;
    const load = async () => {
      const previous = await cache.match(url);
      if (previous && Number(previous.headers.get("content-length")) === file.bytes) return;
      report({ message: `${selected ? "Importing" : "Downloading"} ${file.path} (${completed + 1}/${status.total})…`, completed, total: status.total });
      const response = selected ? new Response(selected.get(file.path)) : await fetcher(file.url, { signal, mode: "cors", credentials: "omit" });
      if (!response.ok || response.type === "opaque") throw new Error(`Could not download ${file.path}. Retry setup or import the local model folder.`);
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/html")) throw new Error(`A web page was returned instead of ${file.path}.`);
      // HF sends Content-Length; reject truncated responses before they can poison the cache.
      // Small text responses can be HTTP-compressed; measure their decoded body.
      const small = !selected && file.bytes <= 5_000_000 ? await response.arrayBuffer() : undefined;
      const size = selected ? selected.get(file.path).size : small ? small.byteLength : Number(response.headers.get("content-length"));
      if (size !== file.bytes) throw new Error(`Incorrect or unavailable file size for ${file.path}. Import the local model folder instead.`);
      const headers = new Headers({ "content-length": String(file.bytes), "content-type": file.path.endsWith(".json") ? "application/json" : "application/octet-stream" });
      await cache.put(url, new Response(small ?? response.body, { headers }));
    };
    try {
      if (globalThis.navigator?.locks) await navigator.locks.request(`${MODEL_CACHE_NAME}:${url}`, { signal }, load);
      else await load();
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`Setup stopped at ${file.path}: ${error instanceof Error ? error.message : String(error)}. Completed files are retained; retry to continue.`);
    }
    signal?.throwIfAborted();
    completed++;
    report({ message: `Cached ${completed}/${status.total} model files.`, completed, total: status.total });
  }
  report({ message: "Models ready. Hold the microphone button or type a description below. Inference runs on this device.", completed, total: status.total });
}
