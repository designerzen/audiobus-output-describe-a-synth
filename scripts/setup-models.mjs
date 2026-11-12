#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, rename, cp, access } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const directory = args[args.indexOf("--directory") + 1];
if (!args.includes("--directory") || !directory || directory.startsWith("--")) {
  throw new Error("Specify a model cache: describe-synth-models --directory ./model-cache");
}
const destination = resolve(directory);
let manifest = resolve(import.meta.dirname, "../public/describe-synth/model-manifest.js");
try { await access(manifest); } catch { manifest = resolve(import.meta.dirname, "../dist/plugin/assets/model-manifest.js"); }
const { MODEL_FILES } = await import(pathToFileURL(manifest).href);
const hash = async path => {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
};
const exists = async path => { try { return (await stat(path)).size > 0; } catch { return false; } };
const curl = (url, path) => new Promise((accept, reject) => {
  const child = spawn(process.platform === "win32" ? "curl.exe" : "curl", [
    "--fail", "--location", "--show-error", "--max-time", "600", "--continue-at", "-", "--output", path, url,
  ], { stdio: "inherit", windowsHide: true });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? accept() : reject(new Error(`Model download failed (${code}). Run setup:models again to resume.`)));
});

async function download({ path, url, bytes, sha256: expected }) {
  const name = basename(path);
  const target = resolve(destination, path);
  await mkdir(dirname(target), { recursive: true });
  if (await exists(target) && (await stat(target)).size === bytes && (!expected || await hash(target) === expected)) return;
  const probeCache = resolve(tmpdir(), "describe-synth-gpu-probe", basename(name));
  if (expected && await exists(probeCache) && await hash(probeCache) === expected) {
    await cp(probeCache, target);
    console.log(`Reused verified local ${name}`);
    return;
  }
  const partial = `${target}.partial`;
  await curl(url, partial);
  if ((await stat(partial)).size !== bytes) throw new Error(`Incomplete model asset: ${path}. Run setup:models again to resume.`);
  if (expected && await hash(partial) !== expected) throw new Error(`Checksum mismatch for ${name}; remove its .partial file and retry.`);
  await rename(partial, target);
}

console.log("Installing model assets for on-device inference. Review the model terms linked in README.md.");
for (const file of MODEL_FILES) await download(file);
console.log("Local models installed. Inference uses these local assets; no hosted inference is used.");
