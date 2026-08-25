// What analysis measured, shaped for display.
//
// A pure type with no imports, like the rest of `lib/view/`. It mirrors the subset
// of `MeasuredAnalysis` worth showing a person: the raw MFCC and chroma vectors are
// what the affinity scorer compares, not something to read off a panel.
//
// `null` means not measured, and must render as "—" rather than as a zero.

export type MeasuredSummary = {
  bpm: number | null;
  /**
   * Essentia's tempo confidence, 0 to 5.32. A low value on a plausible-looking BPM
   * is the characteristic answer for short or unrhythmic audio, so the panel says so
   * rather than presenting the tempo as settled.
   */
  bpmConfidence: number | null;
  key: string | null;
  scale: string | null;
  /** 0–100. */
  keyStrength: number | null;
  /** Spectral centroid: where the energy sits, which is heard as brightness. */
  centroidHz: number | null;
  onsetCount: number | null;
  /** Features are only comparable when measured at the same rate. */
  featureSampleRate: number | null;
  /** Whether these numbers were measured or corrected by hand. */
  origin: "measured" | "edited" | null;
  extractor: string | null;
  measuredAt: string | null;
  /** Whether a timbre vector exists at all — the values themselves are not for reading. */
  hasTimbre: boolean;
  hasChroma: boolean;
};
