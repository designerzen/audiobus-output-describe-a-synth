class DescribeSynthCapture extends AudioWorkletProcessor {
  constructor() { super(); this.block = new Float32Array(Math.floor(sampleRate / 2)); this.offset = 0; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) for (const value of input) {
      this.block[this.offset++] = value;
      if (this.offset === this.block.length) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(Math.floor(sampleRate / 2)); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("describe-synth-capture", DescribeSynthCapture);
