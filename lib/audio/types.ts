import type { ExtractedFeatures } from "../analysis/features";
import type { WaveformPeaks } from "../analysis/peaks";

/**
 * What the renderer measures — the same features the batch pass measures, so this
 * can be handed straight to `finalizeImport` as a `MeasuredAnalysis`.
 *
 * There used to be a `sonogram` here, a mel spectrogram from the extractor
 * bundle's `melSpectrumExtractor`. It never produced anything: that function
 * computes its MelBands input size as `frameSize / (2 + 1)`, which is 682 for a
 * 2048-sample frame where the spectrum is actually 1025 long, so it aborts inside
 * WASM every time. Every `source.json` in the library recorded
 * `{ bands: 0, frames: [] }`, nothing ever read it, and because it ran outside a
 * try/catch its abort discarded the BPM and key alongside it whenever analysis ran
 * in "full" mode.
 */
export type EssentiaAnalysis = ExtractedFeatures;

export type ProcessedAudio = {
  cacheKey: string;
  name: string;
  duration: number;
  /**
   * Display magnitudes at `PEAKS_PER_SECOND`, so resolution does not depend on
   * duration. A fragment sliced out of this keeps its own detail; the previous
   * fixed 512 points gave a two-second cut of a six-minute file two of them.
   */
  peaks: number[];
  /** The min/max form, kept so the renderer can draw true asymmetric waveforms. */
  waveform: WaveformPeaks;
  /** A 512-point reduction. The only form small enough to persist in `source.json`. */
  thumbnail: number[];
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
  /** Size of the persisted thumbnail, not of the display peaks. */
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
  bpmConfidence: null,
  timbre: null,
  chroma: null,
  centroidHz: null,
  onsets: null,
  featureSampleRate: null,
};
