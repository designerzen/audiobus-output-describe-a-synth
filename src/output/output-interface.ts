import type { NoteCommand } from "./types.js";

/**
 * Runtime-free compatibility surface guided by HarmonEasy's IAudioOutput:
 * packages/audiobus/io/outputs/output-interface.ts (and ComponentUi).
 * These are its required members plus the optional hooks implemented here.
 * Check against the complete upstream interfaces with `pnpm check:compat`.
 * No upstream source tree or runtime package is required to build this plugin.
 */
export interface IAudioOutput {
  readonly uuid: string;
  readonly name: string;
  readonly description: string;
  readonly isConnected: boolean;
  readonly isHidden: boolean;
  noteOn(noteNumber: number, velocity: number): unknown;
  noteOff(noteNumber: number): void;
  allNotesOff(): void;
  sendCommand?(command: NoteCommand): void | Promise<void>;
  getNoteKey?(command: NoteCommand): string;
  readonly configurationAffectsNoteRouting?: boolean;
  readonly requiresConnectionControl?: boolean;
  readonly output?: AudioNode;
  connect?(): unknown;
  disconnect?(): Promise<void | Function> | Function;
  createGui?(): Promise<HTMLElement>;
  destroyGui?(): Promise<void>;
  hasAudioOutput?(): boolean;
}
