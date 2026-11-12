// Shared by the explicit setup CLI and the hosted demo. No hosted inference.
const sound = ["atauser001/stable-audio-open-small-onnx", "8f9544df5933b9ed4a7e8ed7fa6f77b3dd48ddce"];
const speech = ["onnx-community/moonshine-tiny-ONNX", "a6da1241cd305dcd64eab1edbd615f2bb9aabb95"];
const clap = ["Xenova/clap-htsat-unfused", "c28f2883575e590e04d3146ff0713c2448d691ba"];
const entry = (folder, repo, file, bytes, sha256) => ({
  path: `${folder}/${file}`, bytes, ...(sha256 ? { sha256 } : {}),
  url: `https://huggingface.co/${repo[0]}/resolve/${repo[1]}/${file}`,
});
export const MODEL_FILES = [
  entry("sound", sound, "cond.onnx", 439547211, "847822809975d0c36a665594fad0312c4c225147910657820e9936b09014629c"),
  entry("sound", sound, "dit.onnx", 1364171978, "8e9c8b14baac4a26159d5ecf3d365ef5a097f321541f9548d62d136354a23d8b"),
  entry("sound", sound, "dec.onnx", 312575029, "96029859b4d563f3aff266e97e715190e8d53278c6e27ab94095535a0da4c911"),
  entry("sound", sound, "tokenizer.json", 1389353, "d2acde0d8d71dd30a711834b07781b9c89feaac33fd332f60507699282740066"),
  entry("sound", sound, "LICENSE", 11852), entry("sound", sound, "NOTICE", 1814),
  ...Object.entries({ "config.json": 921, "generation_config.json": 147, "preprocessor_config.json": 128,
    "special_tokens_map.json": 3, "tokenizer.json": 3761754, "tokenizer_config.json": 135735,
    "onnx/encoder_model.onnx": 30882331, "onnx/decoder_model_merged_quantized.onnx": 20243286,
  }).map(([file, bytes]) => entry("moonshine", speech, file, bytes)),
  ...Object.entries({ "config.json": 699, "preprocessor_config.json": 541, "special_tokens_map.json": 280,
    "tokenizer.json": 2108774, "tokenizer_config.json": 1392, "merges.txt": 456318, "vocab.json": 798293, "README.md": 2963,
  }).map(([file, bytes]) => entry("clap", clap, file, bytes)),
  entry("clap", clap, "onnx/text_model_quantized.onnx", 126603263, "1a3df8b197e249816e08415fd040434c44762b2eea7eb7bf8a48a0f0bf3c14e5"),
  entry("clap", clap, "onnx/audio_model_quantized.onnx", 34301667, "3fcff2c8824e7bcb83a983f2a49edab3b60cbcf4872ac70efee517355173bd1f"),
];
export const MODEL_BYTES = MODEL_FILES.reduce((total, file) => total + file.bytes, 0);
