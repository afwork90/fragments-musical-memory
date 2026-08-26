// One asset's measurements as 32 raw numbers, some of which may be absent.
//
// Grouping is not cosmetic. Harmony and timbre contribute 24 dimensions between
// them and character only 8, so without per-group normalisation and a weight,
// timbre silently decides every position and the character of the playing
// contributes almost nothing.

import { MIN_BPM_CONFIDENCE } from "../analysis/features";
import type { MeasuredSummary } from "../view/analysis";

export type DimensionGroup = "harmony" | "timbre" | "character";

export const GROUP_WEIGHTS: Record<DimensionGroup, number> = {
  harmony: 1,
  timbre: 1,
  character: 1.5,
};

const CHROMA_BINS = 12;
/** MFCC means, minus coefficient 0. */
const TIMBRE_COEFFICIENTS = 12;

/** Chroma starts at A, matching what `HPCP` writes and what `MeasuredSummary` documents. */
const PITCH_CLASSES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

export const DIMENSIONS: readonly { name: string; group: DimensionGroup }[] = [
  ...PITCH_CLASSES.map((pitch) => ({ name: `chroma ${pitch}`, group: "harmony" as const })),
  ...Array.from({ length: TIMBRE_COEFFICIENTS }, (_, index) => ({
    // Named by their real coefficient number, which starts at 1 here.
    name: `mfcc ${index + 1}`,
    group: "timbre" as const,
  })),
  { name: "brightness", group: "character" },
  { name: "flatness", group: "character" },
  { name: "dynamics", group: "character" },
  { name: "onset density", group: "character" },
  { name: "tempo", group: "character" },
  { name: "key strength", group: "character" },
  { name: "intensity", group: "character" },
  { name: "loudness range", group: "character" },
];

/** Positive-only quantities are compared ratiometrically, so they enter as logs. */
function logOf(value: number | null): number | null {
  return value === null || value <= 0 ? null : Math.log2(value);
}

/**
 * A vector of exactly one number or `null` per entry in `DIMENSIONS`.
 *
 * `null` means not measured. It is never a zero: zero flatness is a pure tone and
 * zero onsets is a drone, both of which are findings, and conflating them with
 * "we do not know" is the mistake this whole slice is built to avoid.
 */
export function rawVector(analysis: MeasuredSummary): (number | null)[] {
  // Short vectors are refused rather than padded. A 2-bin chroma is a bug
  // upstream, and padding it would invent ten pitch classes.
  const chroma = analysis.chroma?.length === CHROMA_BINS ? analysis.chroma : null;
  const timbre = analysis.timbre?.length === TIMBRE_COEFFICIENTS + 1 ? analysis.timbre : null;

  // Essentia returns a plausible tempo at confidence 0 for short or unrhythmic
  // audio, which is 13 of the library's 25 fragments. The same gate
  // `tempoSimilarity` applies, imported rather than mirrored.
  const trustedBpm = analysis.bpm !== null && (analysis.bpmConfidence ?? 0) >= MIN_BPM_CONFIDENCE
    ? analysis.bpm
    : null;

  const onsets = analysis.onsetsPerSecond;

  return [
    ...Array.from({ length: CHROMA_BINS }, (_, index) => chroma?.[index] ?? null),
    // Coefficient 0 tracks loudness rather than timbre — across this library it
    // runs about -600 to -870 while every other coefficient is inside +-200.
    ...Array.from({ length: TIMBRE_COEFFICIENTS }, (_, index) => timbre?.[index + 1] ?? null),
    logOf(analysis.centroidHz),
    analysis.flatness,
    analysis.dynamicComplexity,
    // log2(1 + x), not log2(x): eight library fragments have no onsets at all, and
    // that is a measurement, so it must survive as 0 rather than become -Infinity.
    onsets === null ? null : Math.log2(1 + onsets),
    logOf(trustedBpm),
    analysis.keyStrength,
    analysis.intensity,
    analysis.loudnessRange,
  ];
}
