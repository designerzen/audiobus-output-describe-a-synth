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
  const [error, setError] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const base = new URL("describe-synth/", document.baseURI).href;
  useEffect(() => {
    let active = true;
    void modelStatus(base).then((status: { ready: boolean; missing: unknown[]; total: number }) => {
      if (!active) return;
      setReady(status.ready);
      setMessage(status.ready ? "Local models are ready in this browser." : "Download once, or import the model folder you already have.");
    }).catch((error: Error) => { if (active) { setMessage(error.message); setError(true); } });
    return () => { active = false; request.current?.abort(); };
  }, [base]);
  const install = async (files?: File[]) => {
    if (request.current) return;
    const controller = request.current = new AbortController();
    setBusy(true); setProgress(0); setError(false);
    try {
      await navigator.storage?.persist?.();
      await installModels(base, { files, signal: controller.signal, report: (update: { message: string; completed: number; total: number }) => {
        if (!controller.signal.aborted) { setMessage(update.message); setProgress(update.completed / update.total); }
      } });
      if (!controller.signal.aborted) setReady(true);
    } catch (error) {
      setError(!controller.signal.aborted);
      setMessage(controller.signal.aborted ? "Setup cancelled. Completed files remain cached; retry to continue." : error instanceof Error ? error.message : String(error));
    } finally { if (request.current === controller) request.current = undefined; setBusy(false); }
  };
  return <section className="model-setup" data-ready={ready} data-error={error} aria-label="Local model setup">
    <div className="setup-heading"><h2>{ready ? "Your local models are ready" : "Set up your local models"}</h2><span className="setup-tag">{ready ? "On this device" : "One-time setup"}</span></div>
    {!ready && <p>Install {(MODEL_BYTES / 1e9).toFixed(1)} GB of models in this browser to create sounds on your device. Your voice and descriptions stay here.</p>}
    <p role={error ? "alert" : "status"}>{message}</p>
    {busy && <progress max="1" value={progress} aria-label="Model setup progress" />}
    {!ready && <div className="setup-actions">
      <button className="setup-primary" type="button" disabled={busy} onClick={() => void install()}>Download models to this device</button>
      <label className="setup-import">Import existing model folder<input type="file" multiple {...{ webkitdirectory: "" }} disabled={busy} onChange={event => {
        const files = Array.from(event.target.files ?? []); event.target.value = "";
        if (files.length) void install(files);
      }} /></label>
      {busy && <button type="button" onClick={() => request.current?.abort()}>Cancel setup</button>}
    </div>}
    {!ready && <span className="setup-terms">Before downloading, review the <a href="https://huggingface.co/stabilityai/stable-audio-open-small" target="_blank" rel="noreferrer">model terms</a>.</span>}
    <details><summary>About local setup</summary><p>Completed files stay cached, so retries continue where you left off. Use a desktop WebGPU browser and allow microphone access when prompted. Downloads install model files; inference runs on your device.</p><p>GitHub Pages uses single-threaded speech and conditioning. The optional CUDA companion is available from the localhost app.</p></details>
  </section>;
}
