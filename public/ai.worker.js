/// <reference lib="webworker" />
import { AutoTokenizer, BaseStreamer, env, MusicgenForConditionalGeneration, pipeline, } from "./vendor/transformers/transformers.min.js";
const TRANSCRIBER_MODEL = "onnx-community/moonshine-tiny-ONNX";
const GENERATOR_MODEL = "Xenova/musicgen-small";
const VARIANTS = [
    "clean studio recording, isolated and crisp",
    "close perspective, detailed texture and a sharp transient",
    "natural environmental recording with gentle reflections",
    "dark cinematic interpretation, deep and resonant",
    "bright playful interpretation, light and snappy",
    "mechanical synthetic interpretation, precise and rhythmic",
    "organic tactile interpretation, warm and textured",
    "distant atmospheric perspective, spacious and soft",
    "minimal abstract interpretation with an unusual timbre",
];
let transcriberPromise = null;
let generatorPromise = null;
let inferenceChain = Promise.resolve();
function post(type, payload = {}, transfer = []) {
    self.postMessage({ type, ...payload }, transfer);
}
function progressCallback(stage) {
    return (data) => {
        if (data.status !== "progress")
            return;
        const progress = typeof data.progress === "number"
            ? data.progress / 100
            : data.loaded && data.total
                ? data.loaded / data.total
                : 0;
        post("model-progress", {
            stage,
            file: data.file ?? "",
            progress,
        });
    };
}
async function supportsWebGpu() {
    const gpu = self.navigator.gpu;
    if (!gpu)
        return false;
    try {
        return Boolean(await gpu.requestAdapter());
    }
    catch {
        return false;
    }
}
async function getTranscriber() {
    transcriberPromise ??= (async () => {
        const device = (await supportsWebGpu()) ? "webgpu" : "wasm";
        post("status", {
            message: `Preparing private speech recognition on ${device.toUpperCase()}…`,
        });
        return pipeline("automatic-speech-recognition", TRANSCRIBER_MODEL, {
            device,
            dtype: device === "webgpu"
                ? { encoder_model: "fp32", decoder_model_merged: "q4" }
                : { encoder_model: "fp32", decoder_model_merged: "q8" },
            progress_callback: progressCallback("speech"),
        });
    })();
    return transcriberPromise;
}
async function getGenerator() {
    generatorPromise ??= (async () => {
        if (env.backends.onnx.wasm) {
            env.backends.onnx.wasm.proxy = false;
        }
        post("status", {
            message: "Preparing the 656 MB local sound model…",
        });
        const [model, tokenizer] = await Promise.all([
            MusicgenForConditionalGeneration.from_pretrained(GENERATOR_MODEL, {
                progress_callback: progressCallback("sound"),
                dtype: {
                    text_encoder: "q8",
                    decoder_model_merged: "q8",
                    encodec_decode: "fp32",
                },
                device: "wasm",
            }),
            AutoTokenizer.from_pretrained(GENERATOR_MODEL),
        ]);
        return { model, tokenizer };
    })();
    return generatorPromise;
}
class ProgressStreamer extends BaseStreamer {
    slot;
    maxLength;
    tokenCount = 0;
    constructor(slot, maxLength) {
        super();
        this.slot = slot;
        this.maxLength = maxLength;
    }
    put() {
        this.tokenCount += 1;
        post("generation-progress", {
            slot: this.slot,
            progress: Math.min(this.tokenCount / this.maxLength, 1),
        });
    }
    end() {
        post("generation-progress", { slot: this.slot, progress: 1 });
    }
}
function encodeWav(samples, sampleRate) {
    const bytesPerSample = 2;
    const channelCount = 1;
    const dataLength = samples.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);
    const writeText = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
            view.setUint8(offset + index, value.charCodeAt(index));
        }
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
    view.setUint16(32, channelCount * bytesPerSample, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, dataLength, true);
    let offset = 44;
    for (const sample of samples) {
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
        offset += bytesPerSample;
    }
    return buffer;
}
async function transcribe(request) {
    post("status", { message: "Transcribing on this device…" });
    const transcriber = await getTranscriber();
    const result = await transcriber(request.audio);
    const text = String(result.text ?? "").trim();
    if (!text) {
        throw new Error("No speech was detected. Hold the button and try again.");
    }
    post("transcript", { requestId: request.requestId, text });
}
async function generate(request) {
    const { model, tokenizer } = await getGenerator();
    const maxLength = Math.min(Math.max(Math.floor(request.duration * 50), 1) + 4, model.generation_config.max_length ?? 1500);
    for (const slot of request.slots) {
        const variant = VARIANTS[slot - 1];
        const generationPrompt = `${request.prompt}. ${variant}. Sound only, no speech or vocals.`;
        post("status", {
            message: `Generating pad ${slot} of ${request.slots.length}…`,
        });
        const inputs = tokenizer(generationPrompt);
        const audioValues = await model.generate({
            ...inputs,
            max_length: maxLength,
            guidance_scale: 3,
            temperature: 0.85 + slot * 0.025,
            do_sample: true,
            streamer: new ProgressStreamer(slot, maxLength),
        });
        const sampleRate = model.config.audio_encoder.sampling_rate;
        const samples = Float32Array.from(audioValues.data);
        const wav = encodeWav(samples, sampleRate);
        post("sample", {
            requestId: request.requestId,
            slot,
            prompt: request.prompt,
            variant,
            duration: samples.length / sampleRate,
            wav,
        }, [wav]);
    }
    post("generation-complete", {
        requestId: request.requestId,
        count: request.slots.length,
    });
}
self.addEventListener("message", (event) => {
    inferenceChain = inferenceChain
        .then(async () => {
        if (event.data.type === "transcribe") {
            await transcribe(event.data);
        }
        else {
            await generate(event.data);
        }
    })
        .catch((error) => {
        post("error", {
            requestId: event.data.requestId,
            message: error instanceof Error
                ? error.message
                : "The local AI model could not complete the request.",
        });
    });
});
