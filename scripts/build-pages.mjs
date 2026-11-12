import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const base = `/${(process.env.PAGES_BASE_PATH || "").replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
const built = spawnSync(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "build", "--mode", "pages", "--base", base], { cwd: root, stdio: "inherit" });
if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);
const target = resolve(root, "dist/pages");
await mkdir(resolve(target, "describe-synth"), { recursive: true });
for (const entry of await readdir(resolve(root, "public/describe-synth"))) {
  if (entry !== "models") await cp(resolve(root, "public/describe-synth", entry), resolve(target, "describe-synth", entry), { recursive: true });
}
await cp(resolve(root, "public/icon.svg"), resolve(target, "icon.svg"));
await writeFile(resolve(target, ".nojekyll"), "");
async function size(path) {
  const info = await stat(path);
  if (!info.isDirectory()) return info.size;
  return (await Promise.all((await readdir(path)).map(name => size(resolve(path, name))))).reduce((sum, bytes) => sum + bytes, 0);
}
const bytes = await size(target);
if (bytes > 900_000_000) throw new Error("Pages build exceeds the 900 MB deployment budget. Do not include model weights.");
console.log(`Pages build: ${target} · base ${base} · ${(bytes / 1e6).toFixed(1)} MB · weights excluded`);
