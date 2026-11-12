export function cosineSimilarity(a, b) {
  if (!a.length || a.length !== b.length) throw new Error("Invalid semantic embeddings.");
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  const value = dot / Math.sqrt(aa * bb);
  if (!Number.isFinite(value)) throw new Error("Invalid semantic similarity.");
  return Math.max(-1, Math.min(1, value));
}

export function resample(source, from, to) {
  if (from === to) return new Float32Array(source);
  const result = new Float32Array(Math.round(source.length * to / from));
  for (let i = 0; i < result.length; i++) {
    const position = i * from / to, index = Math.floor(position), fraction = position - index;
    result[i] = source[index] * (1 - fraction) + source[Math.min(index + 1, source.length - 1)] * fraction;
  }
  return result;
}

/** Models run in sequence, after generator sessions are released, to limit peak memory. */
export async function rankCandidates(candidates, text, lib, report = () => {}) {
  let textModel, audioModel;
  try {
    report("Loading local CLAP text matching…");
    const tokenizer = await lib.AutoTokenizer.from_pretrained("clap");
    textModel = await lib.ClapTextModelWithProjection.from_pretrained("clap", { device: "wasm", dtype: "q8" });
    const textInputs = tokenizer(text, { padding: true, truncation: true });
    const textResult = await textModel(textInputs);
    const embedding = new Float32Array(textResult.text_embeds.data);
    Object.values(textResult).forEach(tensor => tensor.dispose?.());
    Object.values(textInputs).forEach(tensor => tensor.dispose?.());
    await textModel.dispose(); textModel = undefined;
    report("Matching the generated sounds to your description locally…");
    const processor = await lib.AutoProcessor.from_pretrained("clap");
    audioModel = await lib.ClapAudioModelWithProjection.from_pretrained("clap", { device: "wasm", dtype: "q8" });
    const rate = processor.feature_extractor.config.sampling_rate;
    for (const candidate of candidates) {
      const inputs = await processor(resample(candidate.originalPcm ?? candidate.pcm, candidate.sampleRate, rate));
      const result = await audioModel(inputs);
      candidate.similarity = cosineSimilarity(embedding, result.audio_embeds.data);
      candidate.ranking = "CLAP cosine similarity (not a probability)";
      Object.values(result).forEach(tensor => tensor.dispose?.());
      Object.values(inputs).forEach(tensor => tensor.dispose?.());
    }
    return candidates.sort((a, b) => b.similarity - a.similarity);
  } finally {
    if (textModel) await textModel.dispose();
    if (audioModel) await audioModel.dispose();
  }
}

export function loopbackEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error("The optional GPU companion must run on this device's HTTP loopback address.");
  }
  return new URL("generate", url.href.endsWith("/") ? url : new URL(url.href + "/")).href;
}
