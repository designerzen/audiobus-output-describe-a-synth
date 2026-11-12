# Optional local CUDA companion

AudioLDM2 is an experimental alternative to the default browser generator, not a demonstrated fidelity upgrade. It runs on the same computer. The plugin still provides hold-to-record, local transcription, CLAP ranking, preparation and playback. No HarmonEasy checkout or cloud service is involved.

The pinned `cvssp/audioldm2` checkpoint is **CC-BY-NC-SA-4.0**, not suitable as an unrestricted commercial default. Review its [model terms](https://huggingface.co/cvssp/audioldm2) before use. Weights are not shipped in the npm package.

Use Python 3.11–3.13 and a CUDA-enabled PyTorch installation from [PyTorch](https://pytorch.org/get-started/locally/). Create a virtual environment on a drive with sufficient free space, install PyTorch there, then:

```sh
python -m pip install -r companion/requirements.txt
python companion/server.py download --model .local-models/audioldm2
python companion/server.py serve --model .local-models/audioldm2 --origin http://127.0.0.1:5173
```

The requirements pin Transformers 4.49.0 because this checkpoint uses GPT2Model generation helpers removed in 4.50. Download is an explicit setup operation, pinned to revision `c8e7e189d324425c05c4c2f81214041ef4107983`. Serve uses only local files with Hugging Face offline mode enabled. The process keeps its model loaded between requests, listens on `127.0.0.1:8794`, and allows only the configured application Origin. Use the exact browser origin (e.g. `http://localhost:5173` if that is the URL you opened). It runs requests serially. An aborted browser request discards its result but does not interrupt an already-running native GPU operation.

Select **Local CUDA companion · AudioLDM2** in the Output GUI. The address must be an HTTP loopback URL. Browser local-network access policy may require a browser permission. No cloud fallback exists. HTTPS deployments may need host-controlled same-origin routing; the bundled test app uses localhost HTTP.

Default inference uses 100 steps and model CPU offload, the configuration verified on the RTX 3050 Ti Laptop GPU with 4 GB VRAM. `--offload sequential` reduces peak VRAM further at the cost of extra transfers; `--offload none` keeps the complete model on CUDA. `--steps 200` increases inference work. These choices need measurement on the actual GPU; a 4 GB GPU is not a guarantee that every setting fits. Higher step counts apply to AudioLDM2, not the distilled eight-step browser model.

## Listening benchmark

Export browser patches for the same descriptions into a directory, then compare them with native candidates:

```sh
node scripts/benchmark.mjs --out benchmark-results --patches ./exported-instruments --endpoint http://127.0.0.1:8794/
```

The default descriptions cover dog bark, creature roar, flute and breaking glass, using seeds 11, 22 and 33. Use `--prompt "A dog barking, a deep short woof"` for one description. Without `--endpoint`, the tool prepares a listening report from existing exports without inference. Without `--patches`, it records only the companion's results.

Open the generated `listen.html` file for original/playable WAVs, initially hidden model details, and downloadable human ratings. `manifest.json` records descriptions, actual prompts, model identifiers, seeds and native generation duration. Cosine scores compare semantic similarity, not calibrated recognition accuracy. Human listening remains necessary; no automatic claim of model superiority is made.

Protocol tests require no PyTorch or weights:

```sh
python -m unittest discover -s companion -p "test_*.py"
```

Validated locally with Python 3.13, PyTorch 2.7.1+cu128, Transformers 4.49.0 and the pinned requirements. Three 100-step bark alternatives completed through the GUI, followed by browser CLAP ranking and export, with no hosted inference. See `docs/gpu-investigation/native-companion-validation.json` in the source repository. This verifies operation, not superiority over the browser generator.
