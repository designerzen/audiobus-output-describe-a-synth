import { interpret, preparePatch } from "./patch.js";
import { rankCandidates, resample, loopbackEndpoint } from "./candidates.js";
import { ModelStore } from "./model-cache.js";

const base = new URL("./", import.meta.url);
const update = (stage, message, progress, transcript) => self.postMessage({
  type: "update", value: { stage, message, progress, transcript },
});
const models = new ModelStore(base, event => update("generating", event.message));
const localJson = path => models.json(path);

let libraryPromise, speechPromise, pendingSpeech, speechRunning = false;
async function library() {
  libraryPromise ??= import("./runtime/transformers/transformers.min.js").then(async lib => {
    lib.env.allowRemoteModels = false;
    lib.env.allowLocalModels = true;
    lib.env.useBrowserCache = false;
    lib.env.useCustomCache = true;
    lib.env.customCache = await models.cache();
    lib.env.localModelPath = new URL("models/", base).href;
    lib.env.backends.onnx.wasm.wasmPaths = new URL("runtime/transformers/", base).href;
    lib.env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;
    return lib;
  });
  return libraryPromise;
}
async function speech() {
  speechPromise ??= library().then(lib => lib.pipeline("automatic-speech-recognition", "moonshine", {
    device: "wasm", dtype: { encoder_model: "fp32", decoder_model_merged: "q8" },
  }));
  return speechPromise;
}
async function pumpSpeech() {
  if (speechRunning) return;
  speechRunning = true;
  try {
    const transcriber = await speech();
    while (pendingSpeech) {
      const request = pendingSpeech; pendingSpeech = undefined;
      const result = await transcriber(request.audio);
      self.postMessage({ type: "transcript", text: String(result.text || "").trim(), final: request.final });
      if (request.final) { await transcriber.dispose(); break; }
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  } finally { speechRunning = false; }
}

async function generateBrowser(spec, text, seeds) {
  let session, conditioning;
  const latents = [], candidates = [];
  try {
    if (!self.navigator.gpu || !await self.navigator.gpu.requestAdapter({ powerPreference: "high-performance" })) {
      throw new Error("Local sound generation needs WebGPU. Use a WebGPU-capable desktop browser.");
    }
    const { T5Tokenizer } = await library();
    const ort = await import("./runtime/ort/ort.webgpu.bundle.min.mjs");
    ort.env.wasm.wasmPaths = new URL("runtime/ort/", base).href;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? 4 : 1;
    const tokenizer = new T5Tokenizer(await localJson("models/sound/tokenizer.json"), {
      model_max_length: 64, pad_token: "<pad>", eos_token: "</s>", unk_token: "<unk>",
    });
    const tokens = tokenizer(spec.prompt, { padding: "max_length", truncation: true, max_length: 64 });
    update("generating", "Loading local text conditioning…", 0.1);
    session = await ort.InferenceSession.create(await models.model("models/sound/cond.onnx"), { executionProviders: ["wasm"] });
    conditioning = await session.run({
      input_ids: new ort.Tensor("int64", tokens.input_ids.data, [1, 64]),
      attention_mask: new ort.Tensor("int64", tokens.attention_mask.data, [1, 64]),
      seconds_total: new ort.Tensor("float32", Float32Array.of(3), [1]),
    });
    await session.release(); session = undefined;
    update("generating", "Loading the local WebGPU sound model…", 0.15);
    session = await ort.InferenceSession.create(await models.model("models/sound/dit.onnx"), { executionProviders: ["webgpu"] });
    const schedule = Array.from({ length: 9 }, (_, i) => i === 0 ? 1 : i === 8 ? 0 : 1 / (1 + Math.exp(-(8.2 * (1 - i / 8) - 2))));
    for (let candidate = 0; candidate < seeds.length; candidate++) {
      let randomState = seeds[candidate] || 1;
      const random = () => {
        randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
        return ((randomState >>> 0) + 1) / 4294967297;
      };
      const noise = () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
      const x = Float32Array.from({ length: 64 * 256 }, noise);
      for (let step = 0; step < 8; step++) {
        update("generating", `Alternative ${candidate + 1} of ${seeds.length}: step ${step + 1} of 8…`, 0.2 + (candidate * 8 + step) / (seeds.length * 8) * 0.5);
        const feeds = {
          x: new ort.Tensor("float32", x, [1, 64, 256]),
          t: new ort.Tensor("float32", Float32Array.of(schedule[step]), [1]),
          cross: conditioning.cross, global: conditioning.global,
        };
        const result = await session.run(feeds);
        try {
          const v = result.v.data;
          for (let i = 0; i < x.length; i++) x[i] = (1 - schedule[step + 1]) * (x[i] - schedule[step] * v[i]) + schedule[step + 1] * noise();
        } finally {
          Object.values(result).forEach(tensor => tensor.dispose());
          feeds.x.dispose(); feeds.t.dispose();
        }
      }
      latents.push(x);
    }
    await session.release(); session = undefined;
    Object.values(conditioning).forEach(tensor => tensor.dispose()); conditioning = undefined;
    update("generating", "Decoding the sound alternatives locally…", 0.75);
    session = await ort.InferenceSession.create(await models.model("models/sound/dec.onnx"), { executionProviders: ["webgpu"] });
    for (let candidate = 0; candidate < seeds.length; candidate++) {
      const count = 66, z = new Float32Array(64 * count), x = latents[candidate];
      for (let channel = 0; channel < 64; channel++) z.set(x.subarray(channel * 256, channel * 256 + count), channel * count);
      const input = new ort.Tensor("float32", z, [1, 64, count]);
      const decoded = await session.run({ z: input });
      try {
        const frames = decoded.audio.dims[2], stereo = decoded.audio.data;
        const mono = Float32Array.from({ length: frames }, (_, i) => (stereo[i] + stereo[frames + i]) * 0.5);
        const patch = preparePatch(mono, 44100, text, seeds[candidate]);
        patch.generation = { steps: 8, backend: "WebGPU" };
        candidates.push(patch);
      } finally { input.dispose(); Object.values(decoded).forEach(tensor => tensor.dispose()); }
    }
    return candidates;
  } finally {
    if (session) await session.release().catch(() => {});
    if (conditioning) Object.values(conditioning).forEach(tensor => tensor.dispose());
  }
}

async function generateCompanion(url, spec, text, seeds) {
  update("generating", "Generating alternatives on the local CUDA companion…", 0.15);
  const response = await fetch(loopbackEndpoint(url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: spec.prompt, seeds }),
  });
  if (!response.ok) throw new Error(`Local GPU companion failed: ${(await response.text()).slice(0, 250)}`);
  const result = await response.json();
  if (!Array.isArray(result.candidates) || result.candidates.length !== seeds.length) throw new Error("Invalid local companion response.");
  return result.candidates.map((item, i) => {
    if (!Number.isFinite(item.sampleRate) || item.sampleRate < 8000 || item.sampleRate > 192000 ||
        !Array.isArray(item.pcm) || item.pcm.length > item.sampleRate * 15 || item.pcm.length < item.sampleRate * 0.1) throw new Error("Invalid local companion audio.");
    const pcm = resample(Float32Array.from(item.pcm), item.sampleRate, 44100);
    const patch = preparePatch(pcm, 44100, text, seeds[i]);
    patch.model = String(result.model).slice(0, 300);
    patch.generation = { steps: result.steps, backend: "local CUDA", offload: result.offload };
    return patch;
  });
}

async function prepare(data) {
  try {
    let text = data.text?.trim() || "";
    if (data.audio) {
      update("transcribing", "Transcribing your description on this device…", 0);
      const transcriber = await speech();
      try { text = String((await transcriber(data.audio)).text || "").trim(); }
      finally { await transcriber.dispose(); }
    }
    if (!text) throw new Error("No speech was detected. Hold the button and try again, or type a description.");
    const spec = interpret(text);
    update("interpreting", `Sound prompt: ${spec.prompt}`, 0.05, text);
    const count = Math.max(1, Math.min(4, Math.floor(data.candidateCount || 3)));
    const seeds = Array.from({ length: count }, (_, i) => Number.isInteger(data.seeds?.[i]) ? data.seeds[i] >>> 0 : self.crypto.getRandomValues(new Uint32Array(1))[0]);
    const candidates = data.backendUrl ? await generateCompanion(data.backendUrl, spec, text, seeds) : await generateBrowser(spec, text, seeds);
    let warning = "";
    if (candidates.length > 1) {
      try {
        await rankCandidates(candidates, spec.semanticPrompt, await library(), message => update("matching", message, 0.9));
      } catch (error) {
        warning = ` Automatic matching unavailable: ${error instanceof Error ? error.message : error}. Audition the alternatives; no ranking was applied.`;
        candidates.forEach(candidate => { delete candidate.similarity; candidate.ranking = "Unranked"; });
      }
    }
    self.postMessage({ type: "result", patch: candidates[0], candidates, warning },
      candidates.flatMap(candidate => [candidate.pcm.buffer, candidate.originalPcm.buffer]));
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

self.onmessage = event => {
  if (event.data.type === "speech-start") {
    void speech().catch(error => self.postMessage({ type: "error", message: String(error) }));
  } else if (event.data.type === "speech-audio") {
    // Keep only the newest cumulative audio while inference runs, never build a backlog.
    pendingSpeech = event.data;
    void pumpSpeech();
  } else void prepare(event.data);
};
