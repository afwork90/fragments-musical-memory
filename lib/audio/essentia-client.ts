import type { EssentiaAnalysis } from "./types";
import { analyzeSignal } from "./essentia-analyze";

export type { EssentiaAnalysis, SonogramData } from "./types";

function monoFromBuffer(buffer: AudioBuffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);

  for (let index = 0; index < left.length; index++) {
    mono[index] = (left[index] + right[index]) / 2;
  }

  return mono;
}

export async function analyzeAudioBuffer(buffer: AudioBuffer): Promise<EssentiaAnalysis> {
  const signal = monoFromBuffer(buffer);
  return analyzeSignal(signal, buffer.sampleRate, "full");
}
