# Local WebGPU audio probe

Standalone investigation harness, separate from the application. Uses a pinned community ONNX conversion of Stable Audio Open Small. Read the upstream model terms and notices before downloading or distributing weights. This is local inference; the download stage needs internet access, but the inference page loads its assets from loopback.

From the repository root, on Windows:

```powershell
npm ci --prefix scripts/gpu-probe
powershell -File scripts/gpu-probe/download.ps1
node scripts/gpu-probe/tokenize.mjs "A single glass bottle shattering on concrete, isolated sound effect"
py -3.13 scripts/gpu-probe/serve.py
```

Any supported Python 3 interpreter can serve the files; it does not run inference or need PyTorch. Open `http://127.0.0.1:8793/` in a WebGPU-capable browser. In its developer console, run:

```javascript
await probe()
result
```

The page reports stages through `logs` and `result`. The loopback server saves `result.wav` beside the harness. Stop the server with Ctrl+C. Run only one probe at a time. Model loading and inference use significant memory; the adapter is logged explicitly, since a high-performance request does not guarantee the discrete GPU.

The test uses WASM for conditioning and WebGPU for the denoiser and decoder. It serialises model stages, releases each session, performs eight denoising evaluations on a full fixed latent, and decodes an approximately two-second excerpt. It tests execution, not audible fidelity, tuning, PyTorch parity, full offline browser restart, or optimised generation latency. Re-run with a different typed prompt by stopping the server, invoking `tokenize.mjs` with new text, restarting, and reloading the page. This probe intentionally remains separate from the HarmonEasy Output implementation.

The download script resumes interrupted downloads and checks pinned graph/tokenizer hashes. Cache files, model notices, and generated test output are ignored here; committed investigation evidence lives in `docs/gpu-investigation/`.
