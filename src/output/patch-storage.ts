import type { PreparedPatch, SavedPatch } from "./types.js";

function encode(pcm: Float32Array): string {
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) {
    if (!Number.isFinite(pcm[i])) throw new Error("Invalid audio samples.");
    view.setInt16(i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  }
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

export function savePatch(patch: PreparedPatch): SavedPatch {
  const { pcm, originalPcm, ...metadata } = patch;
  return { ...metadata, pcm16: encode(pcm), ...(originalPcm ? { originalPcm16: encode(originalPcm) } : {}) };
}

function decode(encoded: string): Float32Array {
  if (typeof encoded !== "string" || encoded.length > 2_000_000) throw new Error("Invalid saved audio.");
  const binary = atob(encoded);
  if (binary.length % 2 || binary.length < 8820) throw new Error("Invalid saved audio.");
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return Float32Array.from({ length: bytes.length / 2 }, (_, i) => view.getInt16(i * 2, true) / 32767);
}

export function restorePatch(value: unknown): PreparedPatch {
  const patch = value as SavedPatch;
  if (!patch || patch.version !== 1 || typeof patch.pcm16 !== "string" || patch.pcm16.length > 2_000_000 ||
    typeof patch.description !== "string" || patch.description.length > 1500 ||
    !Number.isFinite(patch.rootFrequency) || patch.rootFrequency < 20 || patch.rootFrequency > 20000 ||
    patch.sampleRate !== 44100 || !patch.spec || !Number.isFinite(patch.spec.attack) ||
    patch.spec.attack < 0 || patch.spec.attack > 2 || !Number.isFinite(patch.spec.release) ||
    patch.spec.release < 0.005 || patch.spec.release > 5 || typeof patch.spec.oneShot !== "boolean" ||
    !["sample", "pitched-texture", "source-texture"].includes(patch.mode) || !Number.isFinite(patch.confidence) ||
    (patch.pitchEmphasis !== undefined && (!Number.isFinite(patch.pitchEmphasis) || patch.pitchEmphasis < 0 || patch.pitchEmphasis > 1)) ||
    (patch.similarity !== undefined && (!Number.isFinite(patch.similarity) || Math.abs(patch.similarity) > 1)) ||
    (patch.spec.prompt !== undefined && (typeof patch.spec.prompt !== "string" || patch.spec.prompt.length > 2500)) ||
    !Number.isFinite(patch.loopStart) || !Number.isFinite(patch.loopEnd)) {
    throw new Error("This is not a valid Describe a Synth instrument file.");
  }
  const pcm = decode(patch.pcm16);
  const originalPcm = patch.originalPcm16 === undefined ? undefined : decode(patch.originalPcm16);
  const duration = pcm.length / patch.sampleRate;
  if (patch.loopStart < 0 || patch.loopStart >= patch.loopEnd || patch.loopEnd > duration) throw new Error("Invalid instrument loop region.");
  const { pcm16: _pcm16, originalPcm16: _original, ...metadata } = patch;
  return { ...metadata, pcm, originalPcm };
}
