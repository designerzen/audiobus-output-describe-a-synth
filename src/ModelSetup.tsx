import { useEffect, useRef, useState } from "react";
// @ts-expect-error Shared browser-native installer, also shipped with the plugin assets.
import { installModels, modelStatus } from "../public/describe-synth/install-models.js";
// @ts-expect-error Shared pinned model manifest.
import { MODEL_BYTES } from "../public/describe-synth/model-manifest.js";

export default function ModelSetup() {
  const [message, setMessage] = useState("Checking this browser's local models…");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const request = useRef<AbortController | undefined>(undefined);
  const base = new URL("describe-synth/", document.baseURI).href;
  useEffect(() => {
    let active = true;
    void modelStatus(base).then((status: { ready: boolean; missing: unknown[]; total: number }) => {
      if (!active) return;
      setReady(status.ready);
      setMessage(status.ready ? "Local models are ready in this browser." : "Set up the models once before recording or generating. Completed downloads are reused when you retry.");
    }).catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; request.current?.abort(); };
  }, [base]);
  const install = async (files?: File[]) => {
    if (request.current) return;
    const controller = request.current = new AbortController();
    setBusy(true); setProgress(0);
    try {
      await navigator.storage?.persist?.();
      await installModels(base, { files, signal: controller.signal, report: (update: { message: string; completed: number; total: number }) => {
        if (!controller.signal.aborted) { setMessage(update.message); setProgress(update.completed / update.total); }
      } });
      if (!controller.signal.aborted) setReady(true);
    } catch (error) {
      setMessage(controller.signal.aborted ? "Setup cancelled. Completed files remain cached; retry to continue." : error instanceof Error ? error.message : String(error));
    } finally { if (request.current === controller) request.current = undefined; setBusy(false); }
  };
  return <section className="model-setup" aria-label="Local model setup">
    <h2>Local model setup</h2>
    <p>This page runs speech recognition and synthesis on your device. Models need about {(MODEL_BYTES / 1e9).toFixed(1)} GB of browser storage. Downloading installs files; it does not send your voice or descriptions to an inference service.</p>
    <p>Review the <a href="https://huggingface.co/stabilityai/stable-audio-open-small" target="_blank" rel="noreferrer">sound model terms</a> before downloading.</p>
    <p role="status" aria-live="polite">{message}</p>
    {busy && <progress max="1" value={progress} aria-label="Model setup progress" />}
    {!ready && <div className="setup-actions">
      <button type="button" disabled={busy} onClick={() => void install()}>Download models to this device</button>
      <label>Or import your existing models folder<input type="file" multiple {...{ webkitdirectory: "" }} disabled={busy} onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (files.length) void install(files);
      }} /></label>
      {busy && <button type="button" onClick={() => request.current?.abort()}>Cancel setup</button>}
    </div>}
    <small>Use a desktop WebGPU browser and allow microphone access when prompted. GitHub Pages uses single-threaded speech/conditioning because it cannot supply the app's isolation headers. The optional CUDA companion is tested from localhost.</small>
  </section>;
}
