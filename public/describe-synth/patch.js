// Pure DSP shared by the worker and the acoustic regression tests.
export function interpret(description) {
  const text = description.trim().slice(0, 1500);
  if (!text) throw new Error("No speech was detected. Hold the button and describe an instrument or sound.");
  const event = /\b(hit|impact|crash|shatter|breaking|knock|pluck|drum|percussion|bang|click|snap|bark|barks|barking|woof|woofs|meow|roar|roars|growl|dinosaur|dog|cat)\b/i.test(text);
  const sustained = /\b(sustain\w*|continuous\w*|pad|drone|loop\w*)\b/i.test(text);
  const oneShot = event && !sustained;
  // Describe the sound itself; do not turn animal/event requests into instrument prompts.
  let acoustic = text.replace(/^(?:please\s+)?(?:make (?:it|this) sound like|sound like|give me|i want)\s+/i, "");
  acoustic = acoustic.replace(/\bwoofs?\b/gi, "dog bark").replace(/\bdinosaur\b/gi, "dinosaur creature with a deep, rough, chesty roar");
  const subject = acoustic.slice(0, 300);
  return {
    prompt: `${subject}. Isolated ${oneShot ? "single sound event with its natural attack and decay" : "sound"}, dry close recording.`,
    semanticPrompt: subject,
    attack: /\b(slow|soft|gentle|pad|swell)\b/i.test(text) ? 0.15 : 0.008,
    release: /\b(short|tight|staccato|dry)\b/i.test(text) ? 0.08 : 0.3,
    oneShot,
  };
}

/** A tuned source-driven delay resonator; never substitutes an oscillator for the source. */
export function applyPitchEmphasis(source, sampleRate, frequency, amount = 0) {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1) throw new Error("Pitch emphasis must be between zero and one.");
  if (!amount) return new Float32Array(source);
  const delay = sampleRate / frequency, resonated = new Float32Array(source.length);
  let dryPeak = 0, wetPeak = 0;
  for (let i = 0; i < source.length; i++) {
    const position = i - delay, index = Math.floor(position), fraction = position - index;
    const previous = index < 0 ? 0 : (resonated[index] || 0) * (1 - fraction) + (resonated[index + 1] || 0) * fraction;
    resonated[i] = source[i] + 0.88 * previous;
    dryPeak = Math.max(dryPeak, Math.abs(source[i]));
    wetPeak = Math.max(wetPeak, Math.abs(resonated[i]));
  }
  const scale = wetPeak ? dryPeak / wetPeak : 0;
  return Float32Array.from(source, (value, i) => (1 - amount) * value + amount * resonated[i] * scale);
}

export function estimatePitch(pcm, sampleRate) {
  const stride = Math.max(1, Math.floor(sampleRate / 8000));
  const rate = sampleRate / stride;
  const size = 2048;
  const candidates = [];
  for (const fraction of [0.15, 0.35, 0.55]) {
    const offset = Math.floor(Math.max(0, pcm.length - size * stride) * fraction);
    const frame = new Float32Array(size);
    let energy = 0;
    for (let i = 0; i < size; i++) {
      frame[i] = pcm[offset + i * stride] || 0;
      energy += frame[i] ** 2;
    }
    if (energy / size < 0.00001) continue;
    const min = Math.max(2, Math.floor(rate / 1200));
    const max = Math.min(size / 2, Math.ceil(rate / 45));
    const scores = new Float32Array(max + 2);
    for (let lag = min - 1; lag <= max + 1; lag++) {
      let cross = 0, power = 0;
      for (let i = 0; i < size - lag; i++) {
        const a = frame[i], b = frame[i + lag];
        cross += a * b;
        power += a * a + b * b;
      }
      scores[lag] = power ? 2 * cross / power : 0;
    }
    const peaks = [];
    for (let lag = min; lag <= max; lag++) {
      if (scores[lag] > scores[lag - 1] && scores[lag] >= scores[lag + 1]) peaks.push(lag);
    }
    const best = Math.max(...peaks.map(lag => scores[lag]), 0);
    const lag = peaks.find(lag => scores[lag] >= Math.max(0.82, best * 0.95));
    if (!lag) continue;
    const denominator = scores[lag - 1] - 2 * scores[lag] + scores[lag + 1];
    const delta = denominator ? 0.5 * (scores[lag - 1] - scores[lag + 1]) / denominator : 0;
    candidates.push({ frequency: rate / (lag + delta), confidence: scores[lag] });
  }
  if (candidates.length < 2) return { frequency: 110, confidence: 0 };
  candidates.sort((a, b) => a.frequency - b.frequency);
  const median = candidates[Math.floor(candidates.length / 2)];
  const consistent = candidates.filter(item => Math.abs(12 * Math.log2(item.frequency / median.frequency)) < 0.5);
  return consistent.length >= 2 ? median : { frequency: 110, confidence: 0 };
}

export function preparePatch(source, sampleRate, description, seed) {
  if (source.length < sampleRate * 0.1 || source.some(value => !Number.isFinite(value))) {
    throw new Error("The local generator returned invalid audio. The previous instrument is unchanged.");
  }
  let mean = 0, peak = 0;
  for (const value of source) mean += value;
  mean /= source.length;
  const cleaned = Float32Array.from(source, value => value - mean);
  for (const value of cleaned) peak = Math.max(peak, Math.abs(value));
  if (peak < 0.0001) throw new Error("The generated sound is silent. Try another description.");
  let start = 0, end = cleaned.length;
  while (start < end && Math.abs(cleaned[start]) < peak * 0.015) start++;
  start = Math.max(0, start - Math.floor(sampleRate * 0.01));
  while (end > start && Math.abs(cleaned[end - 1]) < peak * 0.005) end--;
  let pcm = cleaned.slice(start, Math.max(start + 1, end));
  if (pcm.length < sampleRate * 0.1) {
    const padded = new Float32Array(Math.ceil(sampleRate * 0.1));
    padded.set(pcm); pcm = padded;
  }
  const pitch = estimatePitch(pcm, sampleRate);
  const spec = interpret(description);
  const mode = pitch.confidence >= 0.82 ? "sample" : "source-texture";
  // Centre unpitched sources on the demo/host keyboard's middle C. Mapping them
  // to A2 made the first C4 key play at 2.38x speed, turning deep barks into squeaks.
  const rootFrequency = mode === "sample" ? pitch.frequency : 261.6255653005986;
  peak = 0;
  for (const value of pcm) peak = Math.max(peak, Math.abs(value));
  const fade = Math.min(Math.floor(sampleRate * 0.005), Math.floor(pcm.length / 4));
  for (let i = 0; i < pcm.length; i++) {
    const edge = Math.min(1, i / Math.max(fade, 1), (pcm.length - 1 - i) / Math.max(fade, 1));
    pcm[i] = pcm[i] / peak * 0.65 * edge;
  }
  const period = sampleRate / rootFrequency;
  // Use matching positive-going crossings near whole cycles, never loop the attack.
  let loopStart = Math.floor(pcm.length * 0.3);
  while (loopStart < pcm.length * 0.45 && !(pcm[loopStart] <= 0 && pcm[loopStart + 1] > 0)) loopStart++;
  let loopEnd = Math.min(pcm.length - fade - 1, Math.floor(loopStart + Math.floor(pcm.length * 0.5 / period) * period));
  const target = loopEnd;
  for (let i = Math.max(loopStart + 2, target - Math.ceil(period / 2)); i < Math.min(pcm.length - 1, target + period / 2); i++) {
    if (pcm[i] <= 0 && pcm[i + 1] > 0) { loopEnd = i; break; }
  }
  return {
    version: 1, pcm, originalPcm: new Float32Array(source), pitchEmphasis: 0, sampleRate, rootFrequency, confidence: pitch.confidence,
    mode, description, spec, loopStart: loopStart / sampleRate, loopEnd: loopEnd / sampleRate,
    seed, model: "atauser001/stable-audio-open-small-onnx@8f9544df5933b9ed4a7e8ed7fa6f77b3dd48ddce",
  };
}
