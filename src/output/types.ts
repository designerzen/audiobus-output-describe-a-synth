export type SoundSpec = {
  prompt: string;
  attack: number;
  release: number;
  oneShot: boolean;
  semanticPrompt?: string;
};

export type PreparedPatch = {
  version: 1;
  description: string;
  sampleRate: number;
  pcm: Float32Array;
  rootFrequency: number;
  confidence: number;
  mode: "sample" | "pitched-texture" | "source-texture";
  originalPcm?: Float32Array;
  pitchEmphasis?: number;
  similarity?: number;
  ranking?: string;
  generation?: { steps: number; backend: string; offload?: string };
  loopStart: number;
  loopEnd: number;
  spec: SoundSpec;
  seed: number;
  model: string;
};

export type SavedPatch = Omit<PreparedPatch, "pcm" | "originalPcm"> & { pcm16: string; originalPcm16?: string };
export type PipelineRequest = { audio?: Float32Array; text?: string; candidateCount?: number; seeds?: number[]; backendUrl?: string };
export type PipelineUpdate = { stage: string; message: string; progress?: number; transcript?: string; candidates?: PreparedPatch[] };
export interface SpeechSession {
  push(audio: Float32Array): void;
  finish(audio: Float32Array): Promise<string>;
  cancel(): void;
}
export interface PatchPipeline {
  startSpeech?(update: (text: string) => void): SpeechSession;
  prepare(request: PipelineRequest, signal: AbortSignal, update: (value: PipelineUpdate) => void): Promise<PreparedPatch>;
}

export type NoteCommand = {
  type: string;
  number: number;
  velocity?: number;
  channel?: number;
  value?: number;
  pitchBend?: number;
};
