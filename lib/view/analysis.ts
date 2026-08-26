// What analysis measured, shaped for display.
//
// A pure type with no imports, like the rest of `lib/view/`. It mirrors the subset
// of `MeasuredAnalysis` worth showing a person. The 13 MFCC means are a direction
// in a space with no names for its axes, so nothing prints them — but the Fracture
// map projects them, which is why they are carried here. Chroma survives because a
// bar per pitch class is readable as a shape even unlabelled.
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
  /**
   * Onsets per second, not the raw count. A count cannot be compared between a
   * two-second stab and a minute of drums; the density can, and it is the same
   * figure `rhythmSimilarity` compares.
   */
  onsetsPerSecond: number | null;
  /** Spectral flatness, 0 tonal to 1 noise-like. */
  flatness: number | null;
  /** Integrated loudness, LUFS. */
  lufs: number | null;
  /** Loudness range, LU. */
  loudnessRange: number | null;
  /** Dynamic complexity in dB: how much the performance breathes. */
  dynamicComplexity: number | null;
  /** -1 relaxed, 0 moderate, 1 aggressive. */
  intensity: number | null;
  /** Silence at the head and tail, in seconds. */
  leadingSilence: number | null;
  trailingSilence: number | null;
  /** The 12 pitch classes starting at A, averaged over frames. Drawn, not read. */
  chroma: number[] | null;
  /**
   * The 13 MFCC means. Never displayed — see the note at the top of this file —
   * but projected by the Fracture map, which is the only reason it is here.
   */
  timbre: number[] | null;
  /** Whether these numbers were measured or corrected by hand. */
  origin: "measured" | "edited" | null;
  extractor: string | null;
  measuredAt: string | null;
};
