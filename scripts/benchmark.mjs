#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (args.includes("--help") || (!value("--endpoint") && !value("--patches"))) {
  console.log("describe-synth-benchmark --out ./benchmark-results [--endpoint http://127.0.0.1:8794/] [--patches ./exported-instruments] [--prompt 'A dog barking']");
  process.exit(args.includes("--help") ? 0 : 1);
}
if (!value("--out")) throw new Error("Specify an explicit --out directory.");
let assets = resolve(import.meta.dirname, "../dist/plugin/assets");
try { await access(resolve(assets, "patch.js")); } catch { assets = resolve(import.meta.dirname, "../public/describe-synth"); }
const { interpret, preparePatch, applyPitchEmphasis } = await import(pathToFileURL(resolve(assets, "patch.js")));
const { loopbackEndpoint, resample } = await import(pathToFileURL(resolve(assets, "candidates.js")));
const out = resolve(value("--out"));
await mkdir(out, { recursive: true });
const records = [], seeds = [11, 22, 33];
const prompts = value("--prompt") ? [value("--prompt")] : [
  "A dog barking, a deep short woof", "A dinosaur making a deep rough chesty roar",
  "A wooden flute playing a clear sustained note", "A single glass bottle shattering",
];
function wav(pcm) {
  const buffer = Buffer.alloc(44 + pcm.length * 2);
  buffer.write("RIFF"); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24); buffer.writeUInt32LE(88200, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(pcm.length * 2, 40);
  let peak = 0; for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
  for (let i = 0; i < pcm.length; i++) buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i] * (peak ? 0.65 / peak : 0))) * 32767), 44 + i * 2);
  return buffer;
}
async function record(patch, seconds, origin) {
  const id = `sound-${String(records.length + 1).padStart(3, "0")}`;
  await writeFile(resolve(out, `${id}-original.wav`), wav(patch.originalPcm ?? patch.pcm));
  await writeFile(resolve(out, `${id}-playable.wav`), wav(applyPitchEmphasis(patch.pcm, 44100, patch.rootFrequency, patch.pitchEmphasis ?? 0)));
  records.push({ id, description: patch.description, prompt: patch.spec.prompt, model: patch.model, seed: patch.seed,
    similarity: patch.similarity, generation: patch.generation, seconds, origin, referenceFrequency: patch.rootFrequency, mode: patch.mode });
}
if (value("--patches")) {
  const folder = resolve(value("--patches"));
  for (const file of (await readdir(folder)).filter(name => name.endsWith(".json"))) {
    const saved = JSON.parse(await readFile(resolve(folder, file), "utf8"));
    const decode = pcm16 => {
      const bytes = Buffer.from(pcm16, "base64");
      return Float32Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2) / 32767);
    };
    if (saved.version !== 1 || saved.sampleRate !== 44100 || !saved.pcm16 || saved.pcm16.length > 2_000_000) throw new Error(`Invalid patch: ${file}`);
    await record({ ...saved, pcm: decode(saved.pcm16), originalPcm: saved.originalPcm16 ? decode(saved.originalPcm16) : undefined }, null, file);
  }
}
if (value("--endpoint")) {
  const endpoint = loopbackEndpoint(value("--endpoint"));
  for (const description of prompts) {
    const started = performance.now();
    console.log(`Generating benchmark: ${description}`);
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: interpret(description).prompt, seeds }), signal: AbortSignal.timeout(1_800_000) });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json(), seconds = (performance.now() - started) / 1000;
    for (let i = 0; i < result.candidates.length; i++) {
      const candidate = result.candidates[i];
      const patch = preparePatch(resample(Float32Array.from(candidate.pcm), candidate.sampleRate, 44100), 44100, description, seeds[i]);
      patch.model = result.model;
      patch.generation = { steps: result.steps, backend: "local CUDA", offload: result.offload };
      await record(patch, seconds, endpoint);
    }
  }
}
await writeFile(resolve(out, "manifest.json"), JSON.stringify({ created: new Date().toISOString(), seeds, records }, null, 2));
const escape = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
await writeFile(resolve(out, "listen.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Sound identity listening test</title>
<style>body{font:16px system-ui;max-width:880px;margin:40px auto;padding:16px}article{border:1px solid #aaa;padding:16px;margin:16px 0}label{display:inline-grid;margin:8px}audio{display:block;max-width:100%}</style>
<h1>Sound identity listening test</h1><p>Rate identity, pitch usefulness and absence of artifacts from 1 (poor) to 5 (good). Playable samples are at their source reference pitch. Use the plugin keyboard to judge transposition across notes. Reveal model details after listening.</p>
${records.map(r => `<article data-id="${r.id}"><h2>${r.id}: ${escape(r.description)}</h2><p>Original</p><audio controls src="${r.id}-original.wav"></audio><p>Playable at reference pitch</p><audio controls src="${r.id}-playable.wav"></audio>
${["identity", "pitch", "cleanliness"].map(key => `<label>${key}<input type="number" min="1" max="5" data-rating="${key}"></label>`).join("")}
<details><summary>Reveal model and seed</summary><p>${escape(r.model)} · seed ${r.seed} · ${r.seconds === null ? "imported patch" : `${r.seconds.toFixed(1)} seconds per candidate set`}</p><p>${escape(r.prompt)}</p></details></article>`).join("")}
<button id="export">Download ratings</button><script>document.querySelector('#export').onclick=()=>{const rows=[['id','identity','pitch','cleanliness'],...Array.from(document.querySelectorAll('article'),a=>[a.dataset.id,...Array.from(a.querySelectorAll('input'),i=>i.value)])];const link=document.createElement('a');const url=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\\n')],{type:'text/csv'}));link.href=url;link.download='ratings.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script></html>`);
console.log(`Wrote ${records.length} samples, manifest.json and listen.html into ${out}`);
