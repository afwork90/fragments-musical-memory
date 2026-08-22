export type SonogramData = {
  bands: number;
  frames: number[][];
};

export type EssentiaAnalysis = {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  keyStrength: number | null;
  sonogram: SonogramData;
};

export type ProcessedAudio = {
  cacheKey: string;
  name: string;
  duration: number;
  peaks: number[];
  objectUrl: string;
  format: string;
  sampleRate: number;
  analysis: EssentiaAnalysis;
};

export type AudioProcessPhase = "decoding" | "analyzing";

export type AudioAnalysisMode = "quick" | "full";

export type AudioProcessOptions = {
  name: string;
  format?: string;
  peakCount?: number;
  cacheKey?: string;
  analyze?: false | AudioAnalysisMode;
  onProgress?: (phase: AudioProcessPhase) => void;
};

export const EMPTY_AUDIO_ANALYSIS: EssentiaAnalysis = {
  bpm: null,
  key: null,
  scale: null,
  keyStrength: null,
  sonogram: { bands: 0, frames: [] },
};
