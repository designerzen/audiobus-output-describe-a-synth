export const RECORDING_SAMPLE_RATE = 16_000;

export function pickRecordingMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export async function recordedBlobToMonoPcm(
  blob: Blob,
  targetSampleRate = RECORDING_SAMPLE_RATE,
): Promise<Float32Array> {
  const sourceContext = new AudioContext();

  try {
    const decoded = await sourceContext.decodeAudioData(
      await blob.arrayBuffer(),
    );
    const frameCount = Math.ceil(decoded.duration * targetSampleRate);
    const offline = new OfflineAudioContext(1, frameCount, targetSampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();

    const rendered = await offline.startRendering();
    return rendered.getChannelData(0).slice();
  } finally {
    await sourceContext.close();
  }
}

export function formatDuration(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}
