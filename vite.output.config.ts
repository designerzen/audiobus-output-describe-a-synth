import { defineConfig } from "vite";
import { cp, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist/plugin",
    emptyOutDir: true,
    lib: {
      entry: { index: "src/index.ts", output: "src/output/output-describe-synth.ts" },
      formats: ["es"], fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: { output: { chunkFileNames: "[name]-[hash].js" } },
  },
  plugins: [{
    name: "local-instrument-assets",
    async closeBundle() {
      const source = resolve("public/describe-synth");
      const target = resolve("dist/plugin/assets");
      await mkdir(target, { recursive: true });
      // Weights are installed explicitly by the consumer, never shipped in the npm package.
      for (const entry of await readdir(source)) {
        if (entry !== "models") await cp(resolve(source, entry), resolve(target, entry), { recursive: true });
      }
    },
  }],
});
