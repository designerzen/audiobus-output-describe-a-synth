import { recordedBlobToMonoPcm } from "../lib/audio.js";
import { HoldRecorder } from "./hold-recorder.js";
import { LocalPipeline } from "./pipeline-client.js";
import { restorePatch, savePatch } from "./patch-storage.js";
// @ts-expect-error Native worker DSP is also bundled into the Output for instant pitch-emphasis changes.
import { applyPitchEmphasis } from "../../public/describe-synth/patch.js";
// @ts-expect-error Native shared local-backend URL validation.
import { loopbackEndpoint } from "../../public/describe-synth/candidates.js";
import type { IAudioOutput } from "./output-interface.js";
import type { NoteCommand, PatchPipeline, PipelineUpdate, PreparedPatch, SavedPatch, SpeechSession } from "./types.js";

export const EVENT_CONFIGURATION_CHANGED = "configurationChanged";
export const EVENT_SYNTH_STATE_CHANGED = "describeSynthStateChanged";
const EVENTS = {
  pointerDown: "pointerdown", pointerUp: "pointerup", pointerCancel: "pointercancel",
  lostCapture: "lostpointercapture", keyDown: "keydown", keyUp: "keyup",
  blur: "blur", visibility: "visibilitychange", click: "click", submit: "submit", change: "change",
} as const;

export interface DescribeSynthOptions {
  audioContext: AudioContext;
  mixer?: AudioNode;
  assetBaseUrl?: string;
  patch?: SavedPatch;
  pipeline?: PatchPipeline;
  candidateCount?: number;
  companionUrl?: string;
}

type Voice = { source: AudioBufferSourceNode; gain: GainNode; channel: number; note: number; held: boolean; released: boolean; releaseSeconds: number };

/** Structural HarmonEasy IAudioOutput; the host owns the context and mixer. */
export default class OutputDescribeSynth extends EventTarget implements IAudioOutput {
  readonly uuid = `Output-DescribeSynth-${crypto.randomUUID()}`;
  readonly name = "Describe a Synth";
  readonly description = "Hold to describe any sound, then play it as a local GPU instrument";
  readonly isHidden = false;
  readonly requiresConnectionControl = false;
  readonly configurationAffectsNoteRouting = false;
  readonly output: GainNode;
  readonly options: { patch?: SavedPatch };
  private readonly context: AudioContext;
  private readonly destination: AudioNode;
  private readonly pipeline: PatchPipeline;
  private readonly recorder: HoldRecorder;
  private voices = new Map<string, Voice>();
  private tails = new Set<Voice>();
  private speech?: SpeechSession;
  private sustain = new Set<number>();
  private bends = new Map<number, number>();
  private buffer?: AudioBuffer;
  private patch?: PreparedPatch;
  private candidates: PreparedPatch[] = [];
  private candidateCount: number;
  private companionUrl: string;
  private useCompanion = false;
  private previewSource?: AudioBufferSourceNode;
  private previewGain?: GainNode;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private connected = true;
  private destroyed = false;
  private request?: AbortController;
  private revision = 0;
  private gui?: HTMLElement;
  private guiEvents?: AbortController;
  private controls?: {
    hold: HTMLButtonElement; cancel: HTMLButtonElement; generate: HTMLButtonElement;
    prompt: HTMLTextAreaElement; status: HTMLParagraphElement; patch: HTMLParagraphElement;
    progress: HTMLProgressElement; export: HTMLButtonElement; file: HTMLInputElement;
    original: HTMLButtonElement; playable: HTMLButtonElement; stop: HTMLButtonElement;
    alternatives: HTMLSelectElement; emphasis: HTMLInputElement; emphasisValue: HTMLOutputElement;
    details: HTMLElement; count: HTMLSelectElement; backend: HTMLSelectElement;
    companion: HTMLInputElement; playback: HTMLSelectElement; previewNote: HTMLInputElement;
  };
  state: PipelineUpdate = { stage: "idle", message: "Hold the microphone button and describe an instrument or sound." };

  constructor(options: DescribeSynthOptions) {
    super();
    if (!options?.audioContext) throw new Error("Describe a Synth requires the host's audioContext.");
    this.context = options.audioContext;
    this.destination = options.mixer ?? this.context.destination;
    this.output = this.context.createGain();
    this.output.gain.value = 0.22;
    this.output.connect(this.destination);
    this.options = {};
    this.candidateCount = Math.max(1, Math.min(4, Math.floor(options.candidateCount || 3)));
    this.companionUrl = options.companionUrl ?? "http://127.0.0.1:8794/";
    const assetBaseUrl = new URL(options.assetBaseUrl ?? "./assets/", import.meta.url).href;
    this.pipeline = options.pipeline ?? new LocalPipeline(assetBaseUrl);
    this.recorder = new HoldRecorder({
      state: stage => {
        if (stage === "idle") { this.speech?.cancel(); this.speech = undefined; }
        this.setState({ stage, message: stage === "recording" ? "Listening and transcribing… release to finish your description." : stage === "requesting-microphone" ? "Waiting for microphone permission. Keep holding to record." : "Hold to describe a sound." });
      },
      segment: blob => { void this.acceptRecording(blob); },
      error: error => this.fail(error),
      partial: audio => this.speech?.push(audio),
    }, undefined, { context: this.context, workletUrl: new URL("capture.worklet.js", assetBaseUrl).href });
    if (options.patch) {
      try { this.installPatch(restorePatch(options.patch)); }
      catch (error) { this.fail(error); }
    }
  }

  get isConnected(): boolean { return this.connected; }
  hasAudioOutput(): boolean { return true; }
  getNoteKey(command: NoteCommand): string { return `${command.channel ?? 1}:${command.number}`; }
  private get busy(): boolean { return !["idle", "ready", "error", "recording", "requesting-microphone"].includes(this.state.stage); }

  private setState(state: PipelineUpdate): void {
    if (this.destroyed) return;
    this.state = state;
    this.render();
    this.dispatchEvent(new CustomEvent(EVENT_SYNTH_STATE_CHANGED, { detail: state }));
  }
  private fail(error: unknown): void {
    this.setState({ stage: "error", message: error instanceof Error ? error.message : String(error) });
  }

  private async acceptRecording(blob: Blob): Promise<void> {
    const revision = ++this.revision;
    this.setState({ stage: "transcribing", message: "Preparing your recorded description…" });
    try {
      const audio = await recordedBlobToMonoPcm(blob);
      if (revision !== this.revision || this.destroyed || !this.connected) return;
      if (audio.length < 4000) throw new Error("The recording was too short. Hold the button while speaking.");
      if (this.speech) {
        const speech = this.speech;
        const text = await speech.finish(audio);
        if (revision !== this.revision || this.destroyed) return;
        if (this.speech === speech) this.speech = undefined;
        if (!text.trim()) throw new Error("No speech was detected. Hold the button while describing a sound.");
        if (this.controls) this.controls.prompt.value = text;
        await this.prepare({ text }, revision);
      } else await this.prepare({ audio }, revision);
    } catch (error) { if (revision === this.revision) this.fail(error); }
  }

  async describe(text: string): Promise<void> {
    if (this.destroyed || !this.connected) return;
    this.cancelPreparation();
    const trimmed = text.trim().slice(0, 1500);
    if (!trimmed) return;
    const revision = ++this.revision;
    await this.context.resume();
    if (revision === this.revision && !this.destroyed) await this.prepare({ text: trimmed }, revision);
  }

  private async prepare(input: { text?: string; audio?: Float32Array }, revision: number): Promise<void> {
    const controller = new AbortController();
    this.request?.abort();
    this.request = controller;
    let alternatives: PreparedPatch[] = [], rankingWarning = "";
    this.setState({ stage: input.audio ? "transcribing" : "generating", message: "Preparing your instrument locally…", progress: 0 });
    try {
      const patch = await this.pipeline.prepare({ ...input, candidateCount: this.candidateCount, ...(this.useCompanion ? { backendUrl: this.companionUrl } : {}) }, controller.signal, update => {
        if (revision !== this.revision || controller.signal.aborted || this.destroyed) return;
        if (update.transcript && this.controls) this.controls.prompt.value = update.transcript;
        if (update.candidates) { alternatives = update.candidates; rankingWarning = update.message === "Alternatives ready." ? "" : update.message; }
        this.setState(update);
      });
      if (revision !== this.revision || controller.signal.aborted || this.destroyed || !this.connected) return;
      this.installPatch(patch);
      this.candidates = alternatives.length ? alternatives : [patch];
      this.refreshAlternatives();
      if (rankingWarning) this.setState({ stage: "ready", message: `Instrument ready.${rankingWarning}`, progress: 1 });
    } catch (error) {
      if (revision === this.revision && !controller.signal.aborted) this.fail(error);
    } finally { if (this.request === controller) this.request = undefined; }
  }

  private installPatch(patch: PreparedPatch): void {
    // Validate the same schema used for workspace restore before installing worker data.
    const saved = savePatch(patch);
    const checked = restorePatch(saved);
    const buffer = this.context.createBuffer(1, checked.pcm.length, checked.sampleRate);
    buffer.copyToChannel(applyPitchEmphasis(checked.pcm, checked.sampleRate, checked.rootFrequency, checked.pitchEmphasis ?? 0), 0);
    // Existing voices retain their old buffer and envelope until their NoteOff.
    this.buffer = buffer;
    this.patch = checked;
    this.stopPreview();
    this.options.patch = saved;
    if (this.controls) this.controls.prompt.value = checked.description;
    this.setState({ stage: "ready", message: "Instrument ready. Play notes.", progress: 1 });
    this.dispatchEvent(new Event(EVENT_CONFIGURATION_CHANGED));
  }

  private refreshAlternatives(): void {
    if (!this.controls) return;
    const select = this.controls.alternatives;
    select.replaceChildren();
    this.candidates.forEach((candidate, index) => {
      const option = document.createElement("option"); option.value = String(index);
      option.textContent = `Alternative ${index + 1}${candidate.similarity === undefined ? " · unranked" : ` · match ${candidate.similarity.toFixed(3)}`}`;
      option.selected = candidate.seed === this.patch?.seed;
      select.append(option);
    });
    this.render();
  }

  setPitchEmphasis(amount: number): void {
    if (!this.patch) return;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error("Pitch emphasis must be between zero and one.");
    this.installPatch({ ...this.patch, pitchEmphasis: amount });
  }

  stopPreview(): void {
    clearTimeout(this.previewTimer); this.previewTimer = undefined;
    const source = this.previewSource, gain = this.previewGain;
    if (source) {
      try {
        if (gain) {
          gain.gain.cancelAndHoldAtTime(this.context.currentTime);
          gain.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.015);
          source.stop(this.context.currentTime + 0.02);
        } else { source.stop(); source.disconnect(); }
      } catch { source.disconnect(); gain?.disconnect(); }
    }
    this.previewSource = undefined; this.previewGain = undefined;
  }

  async preview(kind: "original" | "playable", note = 60): Promise<void> {
    if (!this.patch || !this.connected || this.destroyed) return;
    const patch = this.patch, revision = this.revision;
    await this.context.resume();
    if (patch !== this.patch || revision !== this.revision || !this.connected || this.destroyed) return;
    this.stopPreview();
    const source = this.context.createBufferSource();
    if (kind === "original") {
      const pcm = patch.originalPcm ?? patch.pcm;
      const buffer = this.context.createBuffer(1, pcm.length, patch.sampleRate);
      let peak = 0; for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
      buffer.copyToChannel(Float32Array.from(pcm, value => value * (peak ? 0.65 / peak : 0)), 0);
      source.buffer = buffer; source.playbackRate.value = 1;
    } else {
      source.buffer = this.buffer!;
      source.playbackRate.value = 440 * 2 ** ((Math.max(0, Math.min(127, note)) - 69) / 12) / patch.rootFrequency;
      source.loop = !patch.spec.oneShot; source.loopStart = patch.loopStart; source.loopEnd = patch.loopEnd;
    }
    const gain = kind === "playable" ? this.context.createGain() : undefined;
    if (gain) {
      gain.gain.setValueAtTime(0, this.context.currentTime);
      gain.gain.linearRampToValueAtTime(1, this.context.currentTime + patch.spec.attack);
      gain.gain.setValueAtTime(1, this.context.currentTime + 4);
      gain.gain.linearRampToValueAtTime(0, this.context.currentTime + 4 + patch.spec.release);
      source.connect(gain); gain.connect(this.output);
    } else source.connect(this.output);
    this.previewSource = source; this.previewGain = gain;
    source.addEventListener("ended", () => { source.disconnect(); gain?.disconnect(); if (this.previewSource === source) { this.previewSource = undefined; this.previewGain = undefined; } }, { once: true });
    source.start();
    this.previewTimer = setTimeout(() => { if (this.previewSource === source) this.stopPreview(); }, kind === "playable" ? (4 + patch.spec.release) * 1000 : 4000);
  }

  cancelPreparation(): void {
    ++this.revision;
    this.speech?.cancel(); this.speech = undefined;
    this.recorder.cancel();
    this.request?.abort();
    this.request = undefined;
    this.setState({ stage: this.patch ? "ready" : "idle", message: this.patch ? "Preparation cancelled. Your current instrument is ready." : "Cancelled. Hold to describe a sound." });
  }

  noteOn(number: number, velocity = 127): void { this.sendCommand({ type: "noteOn", number, velocity, channel: 1 }); }
  noteOff(number: number): void { this.sendCommand({ type: "noteOff", number, channel: 1 }); }

  sendCommand(command: NoteCommand): void {
    if (!this.connected || this.destroyed) return;
    const channel = command.channel ?? 1;
    if (command.type === "controlChange") {
      const value = command.value ?? command.velocity ?? 0;
      if (command.number === 64) {
        if (value >= 64) this.sustain.add(channel);
        else {
          this.sustain.delete(channel);
          for (const voice of this.voices.values()) if (voice.channel === channel && !voice.held) this.release(voice);
        }
      }
      if (command.number === 120 || command.number === 123) {
        this.sustain.delete(channel);
        for (const voice of this.voices.values()) if (voice.channel === channel) this.release(voice, 0.01);
      }
      return;
    }
    if (command.type === "pitchBend") {
      const cents = ((command.value ?? command.pitchBend ?? 8192) - 8192) / 8192 * 200;
      this.bends.set(channel, cents);
      for (const voice of this.voices.values()) if (voice.channel === channel) voice.source.detune.setValueAtTime(cents, this.context.currentTime);
      return;
    }
    if (!Number.isInteger(command.number) || command.number < 0 || command.number > 127) return;
    const key = this.getNoteKey(command);
    if (command.type === "noteOff" || (command.type === "noteOn" && (command.velocity ?? 127) <= 0)) {
      const voice = this.voices.get(key);
      if (voice) { voice.held = false; if (!this.sustain.has(channel)) this.release(voice); }
      return;
    }
    if (command.type !== "noteOn" || !this.buffer || !this.patch) return;
    const previous = this.voices.get(key);
    if (previous) this.release(previous, 0.005);
    if (this.voices.size >= 16) this.release(this.voices.values().next().value!, 0.005);
    const source = this.context.createBufferSource(), gain = this.context.createGain();
    source.buffer = this.buffer;
    source.loop = !this.patch.spec.oneShot;
    source.loopStart = this.patch.loopStart;
    source.loopEnd = this.patch.loopEnd;
    source.playbackRate.value = (440 * 2 ** ((command.number - 69) / 12)) / this.patch.rootFrequency;
    source.detune.value = this.bends.get(channel) ?? 0;
    gain.gain.setValueAtTime(0, this.context.currentTime);
    gain.gain.linearRampToValueAtTime(Math.max(0, Math.min(127, command.velocity ?? 127)) / 127, this.context.currentTime + this.patch.spec.attack);
    source.connect(gain); gain.connect(this.output);
    const voice: Voice = { source, gain, channel, note: command.number, held: true, released: false, releaseSeconds: this.patch.spec.release };
    this.voices.set(key, voice);
    this.tails.add(voice);
    source.addEventListener("ended", () => {
      source.disconnect(); gain.disconnect();
      this.tails.delete(voice);
      if (this.voices.get(key) === voice) this.voices.delete(key);
    }, { once: true });
    source.start();
  }

  private release(voice: Voice, duration = voice.releaseSeconds): void {
    if (voice.released) return;
    voice.released = true;
    const key = `${voice.channel}:${voice.note}`;
    if (this.voices.get(key) === voice) this.voices.delete(key);
    const now = this.context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + duration);
    voice.source.stop(now + duration + 0.01);
  }

  allNotesOff(): void {
    this.sustain.clear();
    this.bends.clear();
    for (const voice of this.tails) {
      voice.released = false;
      this.release(voice, 0.005);
    }
  }
  async connect(): Promise<void> {
    if (this.destroyed) return;
    await this.context.resume();
    if (this.destroyed) return;
    if (!this.connected) { this.output.connect(this.destination); this.connected = true; }
    this.render();
  }
  async disconnect(): Promise<void> {
    this.stopPreview();
    this.cancelPreparation();
    this.allNotesOff();
    this.output.disconnect();
    this.connected = false;
    this.render();
  }

  async createGui(): Promise<HTMLElement> {
    if (this.gui) return this.gui;
    const panel = document.createElement("section");
    panel.className = "describe-synth-panel nodrag nopan nowheel";
    panel.setAttribute("aria-label", "Describe a Synth");
    panel.innerHTML = `<style>
      .describe-synth-panel{display:grid;gap:12px;min-width:240px;max-width:440px;padding:16px;box-sizing:border-box;font:14px/1.5 system-ui;color:inherit}
      .describe-synth-panel button,.describe-synth-panel textarea{font:inherit;border:1px solid #71838d;border-radius:8px;padding:10px;color:inherit;background:transparent}
      .describe-synth-panel textarea{resize:vertical;min-height:66px;width:100%;box-sizing:border-box}
      .describe-synth-panel .synth-hold{min-height:72px;background:#156d65;color:white;font-weight:650;touch-action:none;user-select:none}
      .describe-synth-panel .synth-hold[aria-pressed=true]{background:#9c3030}
      .describe-synth-panel :focus-visible{outline:3px solid #ebaf51;outline-offset:3px}
      .describe-synth-panel button:disabled{opacity:.45;cursor:not-allowed}
      .describe-synth-panel p{margin:0}.describe-synth-panel progress{width:100%}
      .describe-synth-panel .synth-actions{display:flex;gap:8px;flex-wrap:wrap}
      .describe-synth-panel label{display:grid;gap:6px}.describe-synth-panel small{opacity:.75}
    </style>
    <strong>Describe a Synth</strong>
    <button type="button" class="synth-hold" aria-pressed="false">Hold to describe a sound</button>
    <small>Keep holding while you speak. Transcription starts as you talk. Release to finish and create your instrument. Space or Enter also works.</small>
    <p role="status" aria-live="polite" data-status></p><progress max="1" hidden></progress>
    <form><label>Description<textarea maxlength="1500" placeholder="A warm cello, a glass bell, ocean waves…"></textarea></label><button type="submit">Create from text</button></form>
    <label>Generator<select data-backend><option value="browser">Local browser GPU</option><option value="companion">Local CUDA companion · AudioLDM2</option></select></label>
    <label data-companion-label hidden>Companion address<input data-companion type="url" value="http://127.0.0.1:8794/"><small>Experimental AudioLDM2 checkpoint · noncommercial CC-BY-NC-SA-4.0 license.</small></label>
    <label>Variations<select data-count><option value="1">1 · fastest, manual audition</option><option value="2">2 · local matching</option><option value="3">3 · local matching</option><option value="4">4 · local matching</option></select></label>
    <p data-patch>No instrument prepared yet.</p>
    <label>Choose a sound<select data-alternatives aria-label="Sound alternatives"></select></label>
    <label>Playback<select data-playback><option value="natural">Natural ending · single event</option><option value="sustain">Sustain while held · loop body</option></select></label>
    <label>Sound identity ↔ stronger musical pitch<input data-emphasis type="range" min="0" max="1" step="0.05" value="0"><output data-emphasis-value>Preserve source</output></label>
    <small>Pitch emphasis adds resonance from the source. Unpitched sounds use middle C as a relative transposition reference; they may have no exact musical fundamental.</small>
    <label>Playable preview MIDI note<input data-preview-note type="number" min="0" max="127" value="60"></label>
    <div class="synth-actions"><button type="button" data-original>Preview original</button><button type="button" data-playable>Preview playable</button><button type="button" data-stop>Stop preview</button></div>
    <details><summary>Transcript, prompt and matching</summary><p data-details style="white-space:pre-wrap;overflow-wrap:anywhere"></p></details>
    <div class="synth-actions"><button type="button" data-cancel>Cancel</button><button type="button" data-export>Export instrument</button></div>
    <label>Import instrument<input type="file" accept="application/json,.json"></label>
    <small>Speech recognition and sound generation run on this device. Local model files must be installed.</small>`;
    const hold = panel.querySelector<HTMLButtonElement>(".synth-hold")!;
    const prompt = panel.querySelector("textarea")!;
    this.controls = {
      hold, prompt, cancel: panel.querySelector("[data-cancel]")!, export: panel.querySelector("[data-export]")!,
      generate: panel.querySelector("button[type=submit]")!, status: panel.querySelector("[data-status]")!,
      patch: panel.querySelector("[data-patch]")!, progress: panel.querySelector("progress")!, file: panel.querySelector("input[type=file]")!,
      original: panel.querySelector("[data-original]")!, playable: panel.querySelector("[data-playable]")!, stop: panel.querySelector("[data-stop]")!,
      alternatives: panel.querySelector("[data-alternatives]")!, emphasis: panel.querySelector("[data-emphasis]")!, emphasisValue: panel.querySelector("[data-emphasis-value]")!,
      details: panel.querySelector("[data-details]")!, count: panel.querySelector("[data-count]")!, backend: panel.querySelector("[data-backend]")!,
      companion: panel.querySelector("[data-companion]")!, playback: panel.querySelector("[data-playback]")!, previewNote: panel.querySelector("[data-preview-note]")!,
    };
    this.controls.count.value = String(this.candidateCount);
    this.controls.backend.value = this.useCompanion ? "companion" : "browser";
    this.controls.companion.value = this.companionUrl;
    panel.querySelector<HTMLElement>("[data-companion-label]")!.hidden = !this.useCompanion;
    prompt.value = this.patch?.description ?? "";
    const events = this.guiEvents = new AbortController();
    const listen = (target: EventTarget, type: string, listener: EventListener) => target.addEventListener(type, listener, { signal: events.signal });
    let pointer: number | undefined, key: string | undefined;
    const press = () => {
      if (this.busy || ["recording", "requesting-microphone"].includes(this.state.stage) || !this.connected || this.destroyed) return;
      void this.context.resume().catch(error => this.fail(error));
      this.speech?.cancel();
      this.speech = this.pipeline.startSpeech?.(text => {
        if (this.controls) this.controls.prompt.value = text;
        if (this.state.stage === "recording") this.setState({ stage: "recording", message: text ? `Listening… ${text}` : "Listening and transcribing…" });
      });
      void this.recorder.press();
    };
    const release = () => { pointer = undefined; key = undefined; this.recorder.release(); };
    const cancelHold = () => { pointer = undefined; key = undefined; this.recorder.cancel(); };
    listen(hold, EVENTS.pointerDown, event => {
      const e = event as PointerEvent;
      if (e.button !== 0 || pointer !== undefined || key !== undefined) return;
      e.preventDefault(); e.stopPropagation(); pointer = e.pointerId;
      try { hold.setPointerCapture(e.pointerId); } catch { /* Synthetic input has no native capture. */ }
      press();
    });
    listen(window, EVENTS.pointerUp, event => { if ((event as PointerEvent).pointerId === pointer) release(); });
    listen(hold, EVENTS.lostCapture, () => { if (pointer !== undefined) release(); });
    listen(hold, EVENTS.pointerCancel, () => { if (pointer !== undefined) cancelHold(); });
    listen(hold, EVENTS.keyDown, event => {
      const e = event as KeyboardEvent;
      if (![" ", "Enter"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && key === undefined && pointer === undefined) { key = e.key; press(); }
    });
    listen(window, EVENTS.keyUp, event => { if ((event as KeyboardEvent).key === key) release(); });
    listen(hold, EVENTS.blur, () => { if (key !== undefined) release(); });
    listen(window, EVENTS.blur, () => { if (key !== undefined || pointer !== undefined) release(); });
    listen(document, EVENTS.visibility, () => { if (document.hidden && (key !== undefined || pointer !== undefined)) release(); });
    listen(panel.querySelector("form")!, EVENTS.submit, event => { event.preventDefault(); void this.describe(prompt.value).catch(error => this.fail(error)); });
    listen(this.controls.cancel, EVENTS.click, () => this.cancelPreparation());
    listen(this.controls.original, EVENTS.click, () => { void this.preview("original").catch(error => this.fail(error)); });
    listen(this.controls.playable, EVENTS.click, () => { void this.preview("playable", Number(this.controls!.previewNote.value)).catch(error => this.fail(error)); });
    listen(this.controls.stop, EVENTS.click, () => this.stopPreview());
    listen(this.controls.count, EVENTS.change, () => { this.candidateCount = Number(this.controls!.count.value); });
    listen(this.controls.backend, EVENTS.change, () => {
      this.useCompanion = this.controls!.backend.value === "companion";
      panel.querySelector<HTMLElement>("[data-companion-label]")!.hidden = !this.useCompanion;
    });
    listen(this.controls.companion, EVENTS.change, () => {
      try { loopbackEndpoint(this.controls!.companion.value); this.companionUrl = this.controls!.companion.value; }
      catch (error) { this.controls!.companion.value = this.companionUrl; this.fail(error); }
    });
    listen(this.controls.alternatives, EVENTS.change, () => {
      const candidate = this.candidates[Number(this.controls!.alternatives.value)];
      if (candidate) this.installPatch({ ...candidate, pitchEmphasis: this.patch?.pitchEmphasis ?? 0 });
    });
    listen(this.controls.emphasis, EVENTS.change, () => this.setPitchEmphasis(Number(this.controls!.emphasis.value)));
    listen(this.controls.playback, EVENTS.change, () => {
      if (this.patch) this.installPatch({ ...this.patch, spec: { ...this.patch.spec, oneShot: this.controls!.playback.value === "natural" } });
    });
    listen(this.controls.export, EVENTS.click, () => {
      if (!this.options.patch) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(this.options.patch)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "describe-synth.instrument.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    listen(this.controls.file, EVENTS.change, () => { void (async () => {
      const file = this.controls?.file.files?.[0];
      if (!file) return;
      try {
        if (file.size > 4_200_000) throw new Error("Instrument files must be smaller than 4.2 MB.");
        const patch = restorePatch(JSON.parse(await file.text()));
        if (this.destroyed) return;
        this.cancelPreparation(); this.installPatch(patch);
        this.candidates = [patch]; this.refreshAlternatives();
      } catch (error) { this.fail(error); }
      if (this.controls) this.controls.file.value = "";
    })(); });
    this.gui = panel;
    if (this.patch && !this.candidates.length) this.candidates = [this.patch];
    this.refreshAlternatives();
    this.render();
    return panel;
  }

  private render(): void {
    if (!this.controls) return;
    const c = this.controls;
    const recording = ["recording", "requesting-microphone"].includes(this.state.stage);
    c.hold.disabled = this.busy || !this.connected || this.destroyed;
    c.hold.setAttribute("aria-pressed", String(recording));
    c.hold.textContent = recording ? "Listening… release to finish" : "Hold to describe a sound";
    c.status.textContent = this.state.message;
    c.progress.hidden = !this.busy;
    if (this.state.progress === undefined) c.progress.removeAttribute("value"); else c.progress.value = this.state.progress;
    c.generate.disabled = this.busy || recording || !this.connected;
    c.prompt.disabled = this.busy || recording;
    c.cancel.disabled = !this.busy && !recording;
    c.export.disabled = !this.patch;
    c.file.disabled = this.busy || recording;
    for (const control of [c.count, c.backend, c.companion]) control.disabled = this.busy || recording;
    for (const control of [c.alternatives, c.emphasis, c.playback]) control.disabled = !this.patch || this.busy || recording;
    c.original.disabled = !this.patch || !this.connected;
    c.playable.disabled = !this.patch || !this.connected;
    c.emphasis.value = String(this.patch?.pitchEmphasis ?? 0);
    c.emphasisValue.textContent = this.patch?.pitchEmphasis ? `${Math.round(this.patch.pitchEmphasis * 100)}% pitch resonance` : "Preserve source";
    c.playback.value = this.patch?.spec.oneShot ? "natural" : "sustain";
    c.details.textContent = this.patch ? `Transcript / description: ${this.patch.description}\nGeneration prompt: ${this.patch.spec.prompt}\nModel: ${this.patch.model}\nSeed: ${this.patch.seed}\n${this.patch.similarity === undefined ? "Unranked; audition to choose." : `CLAP cosine similarity: ${this.patch.similarity.toFixed(3)}. Relative match, not a probability or guarantee.`}\n${this.patch.originalPcm ? "Original generator audio retained." : "Legacy patch: original generator audio was not saved."}` : "Your description, generation prompt and matching results will appear here.";
    c.patch.textContent = this.patch ? `${this.patch.description} · ${this.patch.mode === "sample" ? "Tuned sample" : this.patch.mode === "source-texture" ? "Preserved source texture · relative tuning" : "Legacy pitched texture"} · reference ${this.patch.rootFrequency.toFixed(1)} Hz` : "No instrument prepared yet. Notes are ignored until a patch is ready.";
  }

  async destroyGui(): Promise<void> {
    this.stopPreview();
    this.cancelPreparation();
    this.guiEvents?.abort();
    this.gui?.remove();
    this.gui = undefined; this.controls = undefined;
  }
  destroy(): void {
    if (this.destroyed) return;
    void this.disconnect();
    void this.destroyGui();
    this.destroyed = true;
    this.buffer = undefined; this.patch = undefined;
  }
}
