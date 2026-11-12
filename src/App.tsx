import { useEffect, useRef } from "react";
import OutputDescribeSynth, { EVENT_CONFIGURATION_CHANGED, EVENT_SYNTH_STATE_CHANGED } from "./output/output-describe-synth";
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
    const keyButtons = new Map<number, HTMLButtonElement>();
    const noteOn = (note: number) => {
      if (!output.options.patch || ["recording", "requesting-microphone"].includes(output.state.stage)) return;
      if (!pressed.has(note)) { pressed.add(note); keyButtons.get(note)?.setAttribute("aria-pressed", "true"); void context.resume(); output.noteOn(note, 100); }
    };
    const noteOff = (note: number) => { pressed.delete(note); keyButtons.get(note)?.setAttribute("aria-pressed", "false"); output.noteOff(note); };
    const releaseAll = () => { pressed.clear(); keyButtons.forEach(button => button.setAttribute("aria-pressed", "false")); output.allNotesOff(); };
    const mount = async () => {
      const panel = await output.createGui();
      if (!active || !host.current) return;
      const play = document.createElement("section"); play.className = "demo-play"; play.setAttribute("aria-label", "Play your instrument");
      play.innerHTML = '<div class="play-heading"><div><span class="demo-step" aria-hidden="true">03</span><h2>Play your instrument</h2></div><span class="keyboard-range">C major · C4–C5</span></div><p class="keyboard-hint" role="status"></p>';
      const keyboard = document.createElement("div"); keyboard.className = "demo-keyboard";
      keyboard.setAttribute("aria-label", "Audition instrument");
      notes.forEach((note, i) => {
        const button = document.createElement("button"); button.type = "button";
        const label = `${["C", "D", "E", "F", "G", "A", "B", "C"][i]}${i === 7 ? "5" : "4"}`;
        button.innerHTML = `<span class="key-note">${label}</span><kbd>${keys[i].toUpperCase()}</kbd>`;
        button.setAttribute("aria-label", `${label}, keyboard ${keys[i].toUpperCase()}`);
        button.setAttribute("aria-pressed", "false"); keyButtons.set(note, button);
        button.addEventListener("pointerdown", event => { event.preventDefault(); button.setPointerCapture(event.pointerId); noteOn(note); });
        button.addEventListener("pointerup", () => noteOff(note));
        button.addEventListener("lostpointercapture", () => noteOff(note));
        button.addEventListener("pointercancel", () => noteOff(note));
        button.addEventListener("keydown", event => { if ([" ", "Enter"].includes(event.key)) { event.preventDefault(); noteOn(note); } });
        button.addEventListener("keyup", event => { if ([" ", "Enter"].includes(event.key)) noteOff(note); });
        button.addEventListener("blur", () => noteOff(note));
        keyboard.append(button);
      });
      const updateKeyboard = () => {
        const ready = !!output.options.patch;
        keyButtons.forEach(button => { button.disabled = !ready || ["recording", "requesting-microphone"].includes(output.state.stage); });
        play.querySelector(".keyboard-hint")!.textContent = ready ? "Use the letter keys shown below, or press and hold a note. You can play chords." : "Create a sound or import an instrument to start playing.";
      };
      output.addEventListener(EVENT_SYNTH_STATE_CHANGED, updateKeyboard, { signal: events.signal });
      updateKeyboard(); play.append(keyboard);
      host.current.replaceChildren(panel, play);
    };
    void mount();
    window.addEventListener("keydown", event => {
      if (event.repeat) return;
      const interactive = event.target instanceof Element ? event.target.closest("input,textarea,select,button,summary,[contenteditable=true]") : null;
      if (interactive && !interactive.closest(".demo-keyboard")) return;
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
    <header className="demo-header">
      <div className="demo-brand"><span className="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>VOICE → INSTRUMENT</span></div>
      <span className="local-badge"><span aria-hidden="true"></span>Made on your device</span>
      <div className="demo-intro"><h1>Describe a Synth</h1><p>Start with a sound in your head.<br /> Describe it. Shape it. Play it.</p></div>
    </header>
    {import.meta.env.MODE === "pages" && <ModelSetup />}
    <div className="instrument-card" ref={host} />
    <footer><span>An independent Output plugin.</span><span>Local synthesis. Your own sound.</span></footer>
  </main>;
}
