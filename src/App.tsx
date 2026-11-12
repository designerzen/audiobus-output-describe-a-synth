import { useEffect, useRef } from "react";
import OutputDescribeSynth, { EVENT_CONFIGURATION_CHANGED } from "./output/output-describe-synth";
import type { SavedPatch } from "./output/types";
import ModelSetup from "./ModelSetup";

export default function App() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const context = new AudioContext();
    let active = true;
    let patch: SavedPatch | undefined;
    try { patch = JSON.parse(localStorage.getItem("describe-synth-patch") || "null") ?? undefined; } catch { /* A fresh patch can always be created. */ }
    const output = new OutputDescribeSynth({ audioContext: context, patch, assetBaseUrl: new URL("describe-synth/", document.baseURI).href });
    const events = new AbortController();
    const keys = ["a", "s", "d", "f", "g", "h", "j", "k"];
    const notes = [60, 62, 64, 65, 67, 69, 71, 72];
    const pressed = new Set<number>();
    const noteOn = (note: number) => { if (!pressed.has(note)) { pressed.add(note); void context.resume(); output.noteOn(note, 100); } };
    const noteOff = (note: number) => { pressed.delete(note); output.noteOff(note); };
    const releaseAll = () => { pressed.clear(); output.allNotesOff(); };
    const mount = async () => {
      const panel = await output.createGui();
      if (!active || !host.current) return;
      const keyboard = document.createElement("div"); keyboard.className = "demo-keyboard";
      keyboard.setAttribute("aria-label", "Audition instrument");
      notes.forEach((note, i) => {
        const button = document.createElement("button"); button.type = "button";
        button.textContent = `${["C", "D", "E", "F", "G", "A", "B", "C"][i]} · ${keys[i].toUpperCase()}`;
        button.addEventListener("pointerdown", event => { event.preventDefault(); button.setPointerCapture(event.pointerId); noteOn(note); });
        button.addEventListener("pointerup", () => noteOff(note));
        button.addEventListener("lostpointercapture", () => noteOff(note));
        button.addEventListener("pointercancel", () => noteOff(note));
        button.addEventListener("keydown", event => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); noteOn(note); } });
        button.addEventListener("keyup", () => noteOff(note));
        button.addEventListener("blur", () => noteOff(note));
        keyboard.append(button);
      });
      host.current.replaceChildren(panel, keyboard);
    };
    void mount();
    window.addEventListener("keydown", event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.repeat) return;
      const index = keys.indexOf(event.key.toLowerCase());
      if (index >= 0) { event.preventDefault(); noteOn(notes[index]); }
    }, { signal: events.signal });
    window.addEventListener("keyup", event => { const index = keys.indexOf(event.key.toLowerCase()); if (index >= 0) noteOff(notes[index]); }, { signal: events.signal });
    window.addEventListener("blur", releaseAll, { signal: events.signal });
    output.addEventListener(EVENT_CONFIGURATION_CHANGED, () => {
      try { localStorage.setItem("describe-synth-patch", JSON.stringify(output.options.patch)); }
      catch { /* Export instrument remains available if local storage is full. */ }
    }, { signal: events.signal });
    return () => { active = false; events.abort(); output.destroy(); void context.close(); };
  }, []);
  return <main className="instrument-demo">
    <header><p className="eyebrow">Output plugin · on-device audio</p><h1>Describe a Synth</h1><p>Hold. Describe. Release. Play.</p></header>
    {import.meta.env.MODE === "pages" && <ModelSetup />}
    <div className="instrument-card" ref={host} />
    <footer>Hold the microphone button while speaking; transcription starts as you talk. Release ends the section and creates a playable instrument. Audition with A–K, or install the plugin in your host application.</footer>
  </main>;
}
