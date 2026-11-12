# Describe a Synth — independent Output plugin

Hold the microphone button, describe any instrument or sound, and release. English transcription starts while you are speaking. Release marks the end of that spoken section; the final transcript then drives local GPU sound generation and patch preparation. Incoming host notes play the resulting instrument polyphonically at their requested pitches.

Descriptions are open-ended: a cello, breaking glass, ocean waves, a machine, an animal, or an imagined hybrid. There is no fixed list of supported sound names. Generated resemblance varies. Unpitched sounds retain their original texture by default and use a relative transposition reference; optional source-driven resonance emphasizes pitch without replacing the source with an oscillator.

**Implemented:** a native DOM Output GUI, hold-to-record capture with live partial transcription, local WebGPU generation, source-preserving preparation, adjustable pitch resonance, multiple candidates with local CLAP matching, original/playable previews, polyphonic playback, workspace persistence, instrument export/import, and an independently installable, typed OutputFactory-compatible plugin. All inference runs on the device. Cloud inference is not used.

## Try the test page

```sh
pnpm install --frozen-lockfile
pnpm setup:models
pnpm dev
```

Open the localhost URL printed by Vite, normally **http://127.0.0.1:5173/**. Use a desktop browser with WebGPU, Web Audio, AudioWorklet, and microphone support. Localhost or HTTPS is required for capture. Node.js 24+ and the pinned pnpm version are recorded in `package.json`.

1. Press and **keep holding** the microphone button while speaking. With keyboard focus on the button, hold Space or Enter instead.
2. The transcript updates during the hold. The first use has an initial speech-model loading delay.
3. Release to end the section. Capture stops immediately, the final speech result settles, and sound generation begins. There is no timer that submits a section while you are still holding.
4. Once the instrument is ready, audition **Preview original** and **Preview playable**, choose another alternative if needed, then play the on-screen keys or **A S D F G H J K**. Chords, note releases, and overlapping voices are supported.
5. Describe another sound to replace the patch. The existing instrument remains playable during preparation and after a failed request. **Cancel** discards pending work. **Export instrument** and **Import instrument** transfer the prepared sound without regenerating it.

The GUI offers 1–4 variations (default 3), natural-ending or sustained playback, and a sound-identity/pitch-emphasis slider. Details show the transcript, actual generation prompt, model, seed and matching score. Preview-original plays the retained generator audio at its original speed; preview-playable uses the chosen MIDI note and current resonance/loop settings, releasing after four seconds. Both previews are level-normalized for comparison.

The interface follows **Describe → Shape → Play**. Generation settings and sound diagnostics are disclosed when needed; the empty state explains the next action, and the demo keyboard becomes available once an instrument is ready. Focus indicators, held-note feedback, responsive controls and reduced-motion support are included.

Typed descriptions use the same generation/preparation path. The test page saves its active patch in browser local storage; exported files are the portable backup. The native Output saves the patch in the host's workspace options.

`setup:models` installs approximately 2.4 GB of local assets, including the sound model, Moonshine speech recognition and quantized CLAP text/audio models. Downloads are setup only, not hosted inference. The sound graphs, sound tokenizer and CLAP graphs are checked against pinned SHA-256 hashes; interrupted downloads can be resumed. On this development machine the verified sound-model downloads from the earlier investigation are reused automatically.

Review the [sound conversion's model terms and notices](https://huggingface.co/atauser001/stable-audio-open-small-onnx) and the [upstream model card](https://huggingface.co/stabilityai/stable-audio-open-small) before distributing weights. The runtime's MIT licence does not replace the model's terms. Model weights and generated runtime copies are ignored by Git.

Local matching uses the [Xenova CLAP ONNX conversion](https://huggingface.co/Xenova/clap-htsat-unfused) of [LAION CLAP](https://huggingface.co/laion/clap-htsat-unfused), whose upstream model card specifies Apache-2.0. The setup script pins its revision and verifies both quantized graph hashes. The extra matching assets add about 165 MB; existing sound-model files are reused.

## GitHub Pages test page

The [Pages workflow](.github/workflows/pages.yml) checks types, runs tests, builds the independent plugin, and builds a separate hosted demo. Pull requests run the build checks; pushes to `main` and manual workflow runs on `main` deploy the demo.

In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source. Push the workflow and its supporting source/scripts to `main`, or run **Test and deploy GitHub Pages demo** from Actions after enabling Pages. The deployment job publishes the resulting URL. For this repository the expected default URL is:

**https://designerzen.github.io/audiobus-input-describe-a-synth/**

This is the configured URL, not a claim that deployment has already run. Custom domains and account-root sites use the base path reported by `actions/configure-pages`.

The Pages artifact is about 105 MB and excludes all model weights. GitHub Pages has a [1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); the 2.3 GB of models are installed on the visitor's device instead. On the hosted page:

1. Choose **Download models to this device** to fetch pinned pretrained files from Hugging Face into this site's browser cache. Downloads stream to cache, resume by skipping completed files, and do not run hosted inference. Browser setup validates expected file sizes; the Node setup CLI also checks the pinned graph hashes.
2. Alternatively, run `pnpm setup:models` locally and use **Import existing model folder** to select `public/describe-synth/models`. The folder must contain `sound`, `moonshine`, and `clap`. This avoids downloading those weights again over the internet.
3. Once **Models ready** appears, hold the microphone button or type a description and generate. The browser may ask for microphone permission. Use a desktop WebGPU browser with at least about 2.5 GB of available browser storage plus inference working memory.

The page keeps recordings and inference on-device. Model caches belong to the site's origin and URL path; a localhost cache does not automatically carry over to the GitHub Pages origin. Clearing browser data or cache eviction requires setup again. The optional native CUDA companion is intended for the localhost app; the hosted page does not supply a native server.

GitHub Pages cannot set the development server's COOP/COEP headers. The worker already falls back to one WASM thread when cross-origin isolation is absent; this preserves local speech recognition and conditioning with potentially slower preparation. No service worker, proxy, or cloud inference is required.

Build the same artifact locally, including a repository subpath, with:

```powershell
$env:PAGES_BASE_PATH = '/audiobus-input-describe-a-synth/'
pnpm build:pages
```

A local browser check imported all 24 model files, generated a patch with WebGPU and ran the speech model with `crossOriginIsolated === false`; see [Pages validation](docs/gpu-investigation/pages-validation.json). This verifies the artifact under the repository path, not a live deployment.

The output is `dist/pages`; `.nojekyll`, the icon, worker/worklet modules, runtime/WASM files, and model setup UI are included. Model folders, the CUDA companion, hosting-provider server shims, and plugin distribution are excluded. The build rejects artifacts exceeding its 900 MB budget. Omitting `PAGES_BASE_PATH` builds for `/`.

## Package installation and host integration

This repository is independent of HarmonEasy. It has no dependency on a neighbouring checkout, does not edit a host application, and does not register itself during installation. HarmonEasy (or another compatible host) installs the package and owns registration, static asset deployment, and model installation.

Build an installable package here:

```sh
pnpm build:plugin
pnpm pack
```

The package is **`audiobus-output-describe-synth`**, with ES module and TypeScript declaration entry points. The tarball includes the Output, factory metadata, workers, browser runtimes, icon, and asset/model setup CLIs. It excludes model weights, the test application, and host source. It is not published to a registry by these commands.

For example, a consuming Turborepo can install the generated tarball as a dependency of its host application:

```sh
pnpm --filter <host-package> add /absolute/path/audiobus-output-describe-synth-0.1.0.tgz
```

Then, from the consuming application's directory, explicitly prepare its local model cache and static assets:

```sh
pnpm exec describe-synth-models --directory .cache/describe-synth-models
pnpm exec describe-synth-assets --to public/describe-synth --models-from .cache/describe-synth-models
```

These commands require explicit destinations. Neither command knows the host's repository layout or modifies its dependency list, factory registry, configuration, or source files. Package installation runs no postinstall download. The model setup command uses Node.js 24+ and `curl`.

For subsequent builds, a host-controlled asset preparation task can copy only the runtime assets, leaving already installed model files in place:

```json
{
  "scripts": {
    "prepare:plugin": "describe-synth-assets --to public/describe-synth",
    "build": "pnpm prepare:plugin && vite build"
  }
}
```

Turborepo runs the consuming application's chosen tasks; this plugin does not require a particular Turbo configuration. Hosts must include the model directory when packaging a complete offline application, or arrange their own explicit model installation. Models remain local and inference never falls back to a cloud service.

### Interface compatibility

Development follows HarmonEasy's actual `IAudioOutput` and `OutputFactory` interfaces. `src/output/output-interface.ts` declares the required Output surface plus implemented optional hooks, and the class explicitly implements that contract. The package has no runtime imports from HarmonEasy or AudioBus.

The complete upstream contract can be checked independently by supplying its paths for a **read-only** development check:

```sh
pnpm check:compat --interface /path/to/output-interface.ts --factory /path/to/output-factory.ts
```

This check compiled the public package declarations against the actual supplied HarmonEasy interfaces. It is optional, takes no default checkout path, and is not part of package build or install. Normal builds and tests work with this repository alone.

The consuming host imports the class or factory:

```ts
import OutputDescribeSynth, { describeSynthPlugin } from 'audiobus-output-describe-synth';

const assetBaseUrl = new URL('/describe-synth/', document.baseURI).href;
const output = describeSynthPlugin.create({ audioContext, mixer, assetBaseUrl });
container.append(await output.createGui());
output.noteOn(60, 100);
output.noteOff(60);
```

`describeSynthPlugin` exposes `id`, `name`, `description`, `type`, `subtype`, `category`, `isAvailable()`, and `create(options)`, matching the host's factory shape. The host chooses how to register that factory and supplies its AudioContext, mixer, and same-origin static asset base. With bundlers, pass `assetBaseUrl` explicitly; npm installation alone cannot choose a browser URL for worker/WASM/model assets. The icon is `icon.svg` under that asset base.

The Output supports `sendCommand`, channel/note keys, `allNotesOff`, connection lifecycle, and native DOM GUI cleanup. `options.patch` contains versioned PCM audio plus tuning, envelope, description, seed, and model provenance. Its configuration-change event lets the host persist replacements. Saved patches restore without model inference.

## Pipeline and boundaries

`src/output/hold-recorder.ts` requests the microphone on press. A released or cancelled permission request cannot start a late recording. An AudioWorklet supplies cumulative mono audio for live speech recognition; MediaRecorder retains the complete held section for finalisation. Releasing stops both capture paths and microphone tracks. Pointer cancellation discards the segment; window focus loss or keyboard release ends the hold. If live capture cannot start, the GUI reports the failure and typed entry remains available.

`src/output/pipeline-client.ts` starts a speech worker on press. Partial transcripts arrive while the hold continues. The speech worker keeps only the newest cumulative input when recognition is busy, avoiding an inference backlog. Release submits the final recorded section to the same recognition session, then disposes it before generation. Cancelling terminates workers and invalidates their results.

`public/describe-synth/pipeline.worker.js` runs Moonshine tiny locally on WASM. It preserves the free-form sound description and extracts a few bounded playing characteristics: attack, release, and one-shot versus sustained playback. Animal/event requests keep their natural attacks and endings; “woof” is expanded to dog bark, and dinosaur requests gain acoustic roar descriptors. Other descriptions remain unrestricted. A short acoustic prompt replaces the old universal sustained-instrument suffix. The generated prompt is visible, and the user can override playback mode independently. No language-model service, executable prompt code, or fixed instrument-name whitelist is involved.

Generation uses the pinned [Stable Audio Open Small ONNX conversion](https://huggingface.co/atauser001/stable-audio-open-small-onnx): local T5 tokenization, WASM text conditioning, eight WebGPU denoising steps, and WebGPU stereo decoding. Each alternative uses its own seed and eight-step latent. Conditioning, denoiser and decoder sessions are each loaded once per request and reused across alternatives, then released before CLAP matching. A roughly three-second excerpt of each full latent is decoded for preparation. Three alternatives increase generation work compared with one; select one for the fastest manual-audition path. This is not yet optimised variable-length denoising. All runtime/model requests are to application-local assets; Transformers remote model loading is disabled. Sound weights and speech assets use a versioned persistent browser cache shared across workers. After the first cache fill, repeated requests read weights from that cache without HTTP model transfers. The GUI distinguishes caching from using cached files. Weights still need loading into CPU/GPU memory for each disposable inference session. Cache eviction, browser data clearing, or a model revision change requires another cache fill; quota failures are reported rather than silently ignored.

`public/describe-synth/patch.js` removes DC offset, trims silence, controls level, and estimates the source's fundamental from multiple regions. Stable voiced material becomes a transposed sample. Low-confidence or unpitched material becomes a **preserved source texture**, with middle C/C4 (261.63 Hz) as a nominal transposition reference, not an asserted measured pitch. The old automatic 18% source / 82% harmonic-body replacement has been removed. The nominal reference is now centred on the demo keyboard: its C4 key plays unpitched source audio at original speed, avoiding the old A2 mapping that sped it up 2.38× at C4. Pitch emphasis defaults to zero; increasing it blends in a tuned delay resonator driven entirely by the source, rather than an independent oscillator. Original generator audio is retained separately from cleaned playable PCM, and both are saved in instrument exports. Legacy exports still load, but cannot recover original audio that was never stored. A new source is prepared once per description, not once per note.

`public/describe-synth/candidates.js` ranks the original candidate audio against the acoustic description using separate quantized CLAP text/audio embedding models. Audio is resampled to CLAP’s required rate. Raw cosine similarities rank candidates; they are not probabilities or calibrated quality guarantees. The highest-ranked candidate is initially selected, with all alternatives available for audition. If matching fails or its assets are missing, the GUI explicitly reports the failure and presents unranked alternatives rather than discarding the generated sounds. Matching uses local WASM, with generation remaining on WebGPU. Models are pinned in setup and use the same persistent browser cache. No automatic per-request remote download is allowed.

Playback uses independent AudioBufferSourceNode/GainNode voices through the host's mixer, with up to 16 active keyed voices. The mapping is:

```text
frequency = 440 * 2 ** ((midiNote - 69) / 12)
playbackRate = frequency / preparedRootFrequency
```

NoteOff releases the voice envelope. Velocity-zero NoteOn, sustain pedal, channel-separated notes, retriggering, a two-semitone pitch-bend range, and panic/all-notes-off are handled. Held voices retain their original patch while replacements affect subsequent notes. Note handlers perform no speech recognition, model inference, network requests, or decoding.

Pitch, duration, and formants remain coupled for sample transposition. Loop regions are selected from the prepared body; broad multisample coverage, independent duration/formant control, realistic articulation modelling, and guaranteed fidelity for every description are not implemented. Strong transposition can still change sound identity, speed and formants. Source textures are relative-pitch instruments; exact stable fundamentals are not guaranteed for noises or barks. Use the original/playable previews and the reference-note control to distinguish generation errors from transposition effects. The original soundboard's nine independent MusicGen pads are no longer the main application flow; its historical worker/storage helpers remain in the source tree.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
```

Unit tests cover source-preserving preparation, middle-C reference playback for unpitched audio, event prompts, source-driven resonance, candidate ranking, preview lifecycle and original-audio persistence, in addition to recording boundaries and permission races, no automatic section submission, persistent model cache reuse across fresh workers, streaming partial/final transcripts, cancellation, stale results, pitch estimation on known tones, unpitched-source preparation, saved-patch validation, channel-separated polyphony, sustain, velocity-zero release, panic, and patch replacement during note handling.

An earlier development integration was exercised through HarmonEasy's actual `createOutputById('describe-synth', …)` factory. A local Windows speech-synthesis fixture was connected as a microphone MediaStream, exercising MediaRecorder, AudioWorklet, live Moonshine transcription, explicit pointer release, local GPU generation, tuning, and native Output playback. Partial and complete transcripts appeared before release; generation started only after release. Two pitched voices, independent channel release, panic, and host workspace serialization were checked. The recorded page resource requests were all on the local application origin. This test used a synthetic speech fixture, not a human microphone-quality evaluation.

That temporary integration has been removed from the host checkout. Current package validation includes an isolated consumer install, explicit asset deployment, and a read-only check against the upstream Output/factory interfaces.

Persistent caching was verified in a browser by filling the graph cache, then creating a fresh worker with model fetching disabled. All three graphs were found in the cache without HTTP transfers. Full local GPU generation also completed using those cached graph bytes. See [cache validation](docs/gpu-investigation/model-cache-validation.json).

The updated browser pipeline was also exercised in an isolated headless Chrome profile with inference requests restricted to loopback: dog-bark and creature-roar requests each generated three ranked alternatives, both previews worked, instrument exports retained original audio, and subsequent requests reused cached models. See [browser validation](docs/gpu-investigation/sound-identity-browser-validation.json) and the separate [real-weight CLAP dog/cat check](docs/gpu-investigation/clap-validation.json). The optional AudioLDM2 companion also passed a full GUI generation/ranking/export request for three 100-step bark alternatives on the RTX 3050 Ti using model CPU offload; see [native validation](docs/gpu-investigation/native-companion-validation.json). A Transformers compatibility problem found during this test was resolved by pinning version 4.49.0. These establish execution and semantic matching behavior, not human-rated fidelity or superiority of either generator.

See [historical host pipeline validation](docs/gpu-investigation/host-pipeline-validation.json) for the event trace and assertions. The earlier source-generation investigation also has [glass](docs/gpu-investigation/webgpu-glass.wav) and [cello](docs/gpu-investigation/webgpu-cello.wav) examples, their JSON measurements, and a separate [reproducible GPU probe](scripts/gpu-probe/README.md).

The browser selected Intel integrated graphics on this machine despite a high-performance adapter request. The machine also has an RTX 3050 Ti Laptop GPU with 4 GB dedicated VRAM and approximately 32 GB system RAM. Successful WebGPU execution does not establish NVIDIA acceleration, perceptual fidelity, or calibrated end-to-end audio latency. Patch preparation currently takes tens of seconds on the tested integrated GPU; playing an already prepared patch requires no generation worker.

## Local GPU alternatives investigated

The implemented browser path works without a Python inference service. An on-device CUDA companion remains an alternative for other models or better hardware use. [Stable Audio 3](https://github.com/Stability-AI/stable-audio-3) supplies small sound-effect/music variants and a larger native model; [Open Small](https://huggingface.co/stabilityai/stable-audio-open-small) also has native CUDA examples. [AudioLDM 2](https://huggingface.co/docs/diffusers/en/api/pipelines/audioldm2) is another local audio-generation candidate. An optional, local-only AudioLDM2 companion is now included; the others remain investigation candidates. See [companion setup and listening benchmark](companion/README.md). The GUI selects the browser generator or an HTTP loopback companion explicitly. The companion loads only a preinstalled local snapshot, retains its model between requests, uses CUDA with configurable CPU offload, and returns alternatives to the same preparation/matching path. It is experimental until measured on the target machine; its **CC-BY-NC-SA-4.0** checkpoint is not an unrestricted commercial default.

Run `node scripts/benchmark.mjs --out benchmark-results --patches ./exported-instruments` to create original/playable WAVs and a listening report from exported patches. Add `--endpoint http://127.0.0.1:8794/` to generate matching AudioLDM2 examples using fixed seeds. The report hides model details initially and exports human ratings for sound identity, pitch usefulness and artifacts. This makes model comparisons repeatable without treating a semantic score as a listening test.

[THX-02](https://huggingface.co/HAL-X-AI/THX-02) was assessed as an optional decision model. It does not accept audio or generate sound through its documented interface, and therefore cannot judge whether generated audio resembles a bark. Its 4.5B-parameter local runtime adds considerable cost for selecting envelope/playback settings already adjustable in the GUI. It has not been added as a dependency. CLAP addresses the relevant audio/text matching task directly.

The [Stable Audio 3 TensorRT route](https://github.com/Stability-AI/stable-audio-3/tree/main/optimized/tensorRT) targets Linux/NVIDIA and architecture-specific engines. Its toolchain and model memory requirements require separate verification on the RTX 3050 Ti. No hardware purchase is required for the browser pipeline tested here. Cloud inference remains excluded.

## Repository

[designerzen/audiobus-input-describe-a-synth](https://github.com/designerzen/audiobus-input-describe-a-synth) retains its original repository URL. Its independent npm package is named `audiobus-output-describe-synth`; this instrument is an **Output**. The microphone configures its sound; HarmonEasy's note stream plays it. The original hosting configuration is retained under `.openai/`, and bundled third-party licence notices are preserved.
