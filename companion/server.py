"""Optional local-only AudioLDM2 backend. Model download is an explicit separate command."""
import argparse
import hashlib
import json
import math
import os
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

MODEL_ID = "cvssp/audioldm2"
MODEL_REVISION = "c8e7e189d324425c05c4c2f81214041ef4107983"


def download_model(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with urlopen(f"https://huggingface.co/api/models/{MODEL_ID}/revision/{MODEL_REVISION}?blobs=true", timeout=30) as response:
        files = json.load(response)["siblings"]
    for item in files:
        name = item["rfilename"]
        if name.endswith((".bin", ".msgpack", ".h5")) or name == ".gitattributes":
            continue
        target = (directory / name).resolve()
        if not target.is_relative_to(directory.resolve()):
            raise ValueError("Invalid model asset path.")
        target.parent.mkdir(parents=True, exist_ok=True)
        expected = item.get("lfs", {}).get("sha256")
        def verified(path):
            if not path.is_file() or path.stat().st_size != item["size"]:
                return False
            if not expected:
                return True
            with path.open("rb") as stream:
                return hashlib.file_digest(stream, "sha256").hexdigest() == expected
        if verified(target):
            continue
        partial = target.with_name(target.name + ".partial")
        subprocess.run(["curl.exe" if os.name == "nt" else "curl", "--fail", "--location", "--show-error",
                        "--max-time", "1800", "--continue-at", "-", "--output", str(partial),
                        f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}/{name}"], check=True)
        if not verified(partial):
            raise RuntimeError(f"Incomplete or corrupt model asset: {name}. Remove its .partial file and retry.")
        partial.replace(target)
    (directory / "describe-synth-provenance.json").write_text(json.dumps({"model": MODEL_ID, "revision": MODEL_REVISION}))


def validate_request(data):
    prompt, seeds = data.get("prompt"), data.get("seeds")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 2500:
        raise ValueError("Provide a sound prompt of 1–2500 characters.")
    if not isinstance(seeds, list) or not 1 <= len(seeds) <= 4 or any(
        type(seed) is not int or not 0 <= seed <= 0xFFFFFFFF for seed in seeds
    ):
        raise ValueError("Provide one to four unsigned 32-bit seeds.")
    return prompt, seeds


class AudioGenerator:
    def __init__(self, model_path, steps=100, offload="model"):
        # Offline flags precede imports, including libraries which import huggingface_hub.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        import torch
        from diffusers import AudioLDM2Pipeline
        if not torch.cuda.is_available():
            raise RuntimeError("A CUDA-enabled PyTorch installation and NVIDIA GPU are required.")
        self.torch, self.steps, self.offload = torch, steps, offload
        provenance_path = model_path / "describe-synth-provenance.json"
        provenance = json.loads(provenance_path.read_text()) if provenance_path.is_file() else {}
        self.model_id = f"{MODEL_ID}@{provenance['revision']}" if provenance.get("model") == MODEL_ID and provenance.get("revision") == MODEL_REVISION else f"{MODEL_ID} (local snapshot; revision unverified)"
        self.pipe = AudioLDM2Pipeline.from_pretrained(
            str(model_path), torch_dtype=torch.float16, local_files_only=True,
        )
        self.pipe.enable_attention_slicing()
        if offload == "sequential":
            self.pipe.enable_sequential_cpu_offload()
        elif offload == "model":
            self.pipe.enable_model_cpu_offload()
        else:
            self.pipe.to("cuda")

    def generate(self, data):
        prompt, seeds = validate_request(data)
        candidates = []
        # One waveform per call bounds VRAM; browser CLAP ranks the resulting alternatives.
        with self.torch.inference_mode():
            for seed in seeds:
                result = self.pipe(
                    prompt=prompt, negative_prompt="Low quality, speech, music accompaniment.",
                    num_inference_steps=self.steps, audio_length_in_s=3.0,
                    num_waveforms_per_prompt=1, guidance_scale=3.5,
                    generator=self.torch.Generator(device="cpu").manual_seed(seed),
                )
                pcm = result.audios[0].tolist()
                if not pcm or any(not math.isfinite(value) for value in pcm):
                    raise RuntimeError("The GPU returned invalid audio.")
                candidates.append({"pcm": pcm, "sampleRate": int(self.pipe.vocoder.config.sampling_rate), "seed": seed})
        return {"model": self.model_id, "steps": self.steps, "offload": self.offload, "candidates": candidates}


def make_handler(generator, allowed_origin):
    class Handler(BaseHTTPRequestHandler):
        def allowed(self):
            # CLI callers omit Origin. Browsers must match the explicitly configured app.
            return self.headers.get("Origin") in (None, allowed_origin)

        def reply(self, status, value):
            payload = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            if self.headers.get("Origin") == allowed_origin:
                self.send_header("Access-Control-Allow-Origin", allowed_origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_OPTIONS(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin is not the configured local application."})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin is not allowed."})
            self.reply(200 if self.path == "/health" else 404, {"model": MODEL_ID, "localOnly": True})

        def do_POST(self):
            if not self.allowed():
                return self.reply(403, {"error": "Origin is not allowed."})
            if self.path != "/generate":
                return self.reply(404, {"error": "Unknown endpoint."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16384:
                    raise ValueError("Invalid request size.")
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("Content-Type must be application/json.")
                data = json.loads(self.rfile.read(length))
                if not isinstance(data, dict):
                    raise ValueError("Expected a JSON object.")
                validate_request(data)
                self.reply(200, generator.generate(data))
            except (ValueError, TypeError) as error:
                self.reply(400, {"error": str(error)})
            except Exception as error:
                self.reply(500, {"error": f"Local generation failed: {error}"})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["download", "serve"])
    parser.add_argument("--model", type=Path, required=True, help="Explicit local model directory")
    parser.add_argument("--port", type=int, default=8794)
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--offload", choices=["sequential", "model", "none"], default="model")
    args = parser.parse_args()
    if args.command == "download":
        download_model(args.model)
        print(f"Installed {MODEL_ID}@{MODEL_REVISION} into {args.model.resolve()}")
        return
    origin = urlparse(args.origin)
    if origin.scheme not in ("http", "https") or origin.hostname not in ("127.0.0.1", "localhost", "::1") or origin.path or origin.query:
        parser.error("--origin must be the exact localhost/loopback application origin, without a trailing slash.")
    if not 10 <= args.steps <= 200:
        parser.error("--steps must be between 10 and 200.")
    if not (args.model / "model_index.json").is_file():
        parser.error("Local model is missing. Run the explicit download command first.")
    generator = AudioGenerator(args.model.resolve(), args.steps, args.offload)
    server = HTTPServer(("127.0.0.1", args.port), make_handler(generator, args.origin))
    print(f"Local-only AudioLDM2 ready at http://127.0.0.1:{args.port}; app origin {args.origin}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
