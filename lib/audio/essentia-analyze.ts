import type { AudioAnalysisMode, EssentiaAnalysis } from "./types";
import { EMPTY_AUDIO_ANALYSIS } from "./types";
import { loadEssentiaExtractor } from "./essentia-loader";

function analysisSignal(signal: Float32Array) {
  return signal.slice();
}

export async function analyzeSignal(
  signal: Float32Array,
  sampleRate: number,
  mode: AudioAnalysisMode,
): Promise<EssentiaAnalysis> {
  const essentia = await loadEssentiaExtractor();
  const samples = analysisSignal(signal);

  let bpm: number | null = null;
  let key: string | null = null;
  let scale: string | null = null;
  let keyStrength: number | null = null;

  try {
    const bpmResult = essentia.PercivalBpmEstimator(
      essentia.arrayToVector(samples),
      1024,
      2048,
      512,
      512,
      210,
      50,
      sampleRate,
    );
    bpm = Number.isFinite(bpmResult.bpm) && bpmResult.bpm > 0 ? Math.round(bpmResult.bpm) : null;
  } catch (error) {
    console.warn("BPM extraction failed.", error);
  }

  try {
    const keyResult = essentia.KeyExtractor(
      essentia.arrayToVector(samples),
      true,
      4096,
      4096,
      12,
      3500,
      60,
      25,
      0.2,
      "edma",
      sampleRate,
      0.0001,
      440,
      "cosine",
      "hann",
    );
    key = typeof keyResult.key === "string" && keyResult.key.length > 0 ? keyResult.key : null;
    scale = typeof keyResult.scale === "string" && keyResult.scale.length > 0 ? keyResult.scale : null;
    keyStrength = Number.isFinite(keyResult.strength) ? Math.round(keyResult.strength * 100) : null;
  } catch (error) {
    console.warn("Key extraction failed.", error);
  }

  if (mode === "quick") {
    return { bpm, key, scale, keyStrength, sonogram: EMPTY_AUDIO_ANALYSIS.sonogram };
  }

  const frames = essentia.FrameGenerator(essentia.arrayToVector(samples), 2048, 1024);
  const frameCount = Math.min(frames.size(), 320);
  const spectrogram: number[][] = [];
  let bandCount = 96;

  for (let index = 0; index < frameCount; index++) {
    const frame = essentia.vectorToArray(frames.get(index)) as Float32Array;
    const mel = essentia.melSpectrumExtractor(frame, sampleRate) as number[];
    bandCount = mel.length;
    spectrogram.push(mel);
  }

  return { bpm, key, scale, keyStrength, sonogram: { bands: bandCount, frames: spectrogram } };
}

export async function analyzeQuick(signal: Float32Array, sampleRate: number) {
  return analyzeSignal(signal, sampleRate, "quick");
}
