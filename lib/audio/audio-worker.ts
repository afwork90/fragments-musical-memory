/// <reference lib="webworker" />

import type { AudioAnalysisMode, EssentiaAnalysis } from "./types";
import { analyzeSignal } from "./essentia-analyze";

type AnalyzeMessage = {
  id: string;
  signal: Float32Array;
  sampleRate: number;
  mode: AudioAnalysisMode;
};

type WorkerResponse =
  | { id: string; ok: true; analysis: EssentiaAnalysis }
  | { id: string; ok: false; error: string };

self.onmessage = async (event: MessageEvent<AnalyzeMessage>) => {
  const { id, signal, sampleRate, mode } = event.data;

  try {
    const analysis = await analyzeSignal(signal, sampleRate, mode);
    const response: WorkerResponse = { id, ok: true, analysis };
    self.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : "Analysis failed",
    };
    self.postMessage(response);
  }
};

export {};
