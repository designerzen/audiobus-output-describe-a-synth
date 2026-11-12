import { cp, mkdir, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const destination = resolve(root, "public/describe-synth/runtime");
const ort = resolve(dirname(require.resolve("onnxruntime-web")), "..");
await mkdir(resolve(destination, "ort"), { recursive: true });
for (const name of (await readdir(resolve(ort, "dist"))).filter(name => name === "ort.webgpu.bundle.min.mjs" || /^ort-wasm-.*\.(mjs|wasm)$/.test(name))) {
  await cp(resolve(ort, "dist", name), resolve(destination, "ort", name));
}
await cp(resolve(root, "public/describe-synth/ORT-LICENSE.txt"), resolve(destination, "ort/LICENSE"));
await cp(resolve(root, "public/vendor/transformers"), resolve(destination, "transformers"), { recursive: true });
console.log("Staged local speech and WebGPU runtimes.");
