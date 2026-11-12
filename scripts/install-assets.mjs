#!/usr/bin/env node
import { cp, mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const option = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
const to = option("--to");
if (!to || to.startsWith("--")) throw new Error("Specify the host-managed destination: describe-synth-assets --to ./public/describe-synth [--models-from ./model-cache]");
const source = resolve(import.meta.dirname, "../dist/plugin/assets");
const target = resolve(to);
if (!(await stat(source)).isDirectory()) throw new Error("Plugin assets are not built. Run pnpm build:plugin in the source repository.");
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
const models = option("--models-from");
if (models) {
  const modelSource = resolve(models);
  if (!(await stat(resolve(modelSource, "sound/dit.onnx"))).isFile()) throw new Error("Expected a downloaded model directory containing sound/ and moonshine/.");
  await cp(modelSource, resolve(target, "models"), { recursive: true });
}
console.log(`Plugin assets copied to ${target}`);
