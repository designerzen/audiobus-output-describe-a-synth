import OutputDescribeSynth from "./output/output-describe-synth.js";
import type { DescribeSynthOptions } from "./output/output-describe-synth.js";

export { default, EVENT_CONFIGURATION_CHANGED, EVENT_SYNTH_STATE_CHANGED } from "./output/output-describe-synth.js";
export type { DescribeSynthOptions } from "./output/output-describe-synth.js";
export type { IAudioOutput } from "./output/output-interface.js";
export type { NoteCommand, PatchPipeline, PipelineUpdate, PreparedPatch, SavedPatch, SoundSpec, SpeechSession } from "./output/types.js";

/** OutputFactory-compatible metadata; installation and registration belong to the host. */
export const describeSynthPlugin = {
  id: "describe-synth",
  name: "Describe a Synth",
  description: "Hold to describe any sound and create a playable instrument locally",
  type: "engine" as const,
  subtype: "instrument" as const,
  category: "Synthesis",
  isAvailable: () => typeof AudioContext !== "undefined" && typeof Worker !== "undefined",
  create(options?: Record<string, unknown>): OutputDescribeSynth {
    if (!options?.audioContext) throw new Error("Describe a Synth requires the host's audioContext.");
    return new OutputDescribeSynth(options as unknown as DescribeSynthOptions);
  },
};
