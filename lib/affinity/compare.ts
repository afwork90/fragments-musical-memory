// Comparing two measured fragments, one axis at a time.
//
// Pure and dually compiled: relative extensionless imports, no `node:*`, no DOM.
//
// Every function here returns `null` rather than a number when the inputs do not
// support an answer — a missing measurement, or one essentia reported with no
// confidence. That is the whole contract: absent is not zero. A fragment whose
// tempo essentia could not establish must not be told it has a different tempo
// from everything else.

import type { MeasuredAnalysis } from "../domain/source-document";
import type { RelationshipMetrics } from "../domain/source-document";
import { MIN_BPM_CONFIDENCE } from "../analysis/features";

/** A fragment as the scorer sees it: measurements plus what they were measured over. */
export type ComparableFragment = {
  id: string;
  sourceId: string;
  /**
   * Seconds of audio the measurements cover. Onset *density* needs this, and it is
   * not the fragment's duration when the fragment ran longer than the analysis
   * window.
   */
  measuredSeconds: number;
  analysis: MeasuredAnalysis;
};

/**
 * A key detection weaker than this is not worth comparing. Across the library the
 * measured strengths run 41 to 95, so this excludes the genuinely ambiguous tail
 * without discarding ordinary material.
 */
export const MIN_KEY_STRENGTH = 50;

/**
 * How far apart two tempi may be, as a fraction, before they score zero.
 *
 * Not the bound `transform.ts` matches with, and deliberately so: this asks whether
 * two fragments are *already* at the same tempo, while a match exists to bring them
 * there. Requiring them to be within 12% before offering to close the gap would be
 * circular.
 */
const TEMPO_TOLERANCE = 0.12;

/**
 * Tempo relationships worth recognising. Half and double time are musically the
 * same pulse, and essentia octave-errors in exactly this way, so a 70 and a 140
 * are a match rather than a miss.
 */
const TEMPO_RATIOS = [1, 2, 0.5] as const;

/** Two octaves of spectral centroid difference scores zero. */
const BRIGHTNESS_OCTAVES = 2;

/** Onset density: an eightfold difference scores zero. */
const RHYTHM_OCTAVES = 3;

/** Dynamic complexity is in dB; this much apart scores zero. */
const DYNAMICS_TOLERANCE = 6;

/**
 * How far apart two flatness readings may be before scoring zero.
 *
 * Not 1, even though flatness is already 0..1. Real recordings occupy a narrow band
 * of it — measured across the library they run about 0.16 to 0.30 — so a raw
 * difference would put every pair above 0.86 and the axis would behave like a
 * constant bonus. That is precisely the defect the old hand-written metrics had,
 * where timbre and brightness were 0.70 on all 791 rows. Scaling to the range the
 * data actually occupies is what makes it discriminate.
 */
const FLATNESS_TOLERANCE = 0.15;

/** Semitone above C for a key name, or `null` when it is missing or unrecognised. */
export function pitchClassOf(key: string | null | undefined): number | null {
  if (!key) return null;
  const pitchClass = PITCH_CLASSES[key];
  return pitchClass === undefined ? null : pitchClass;
}

const PITCH_CLASSES: Record<string, number> = {
  C: 0, "B#": 0,
  "C#": 1, Db: 1,
  D: 2,
  "D#": 3, Eb: 3,
  E: 4, Fb: 4,
  F: 5, "E#": 5,
  "F#": 6, Gb: 6,
  G: 7,
  "G#": 8, Ab: 8,
  A: 9,
  "A#": 10, Bb: 10,
  B: 11, Cb: 11,
};

/**
 * Similarity by key, on the circle of fifths, or `null` when either key was not
 * measured or was measured too weakly to mean anything.
 *
 * The tiers are a deliberate choice over a formula so they can be read against the
 * tolerances the UI filters with: "exact" admits only an identical key, "related"
 * reaches a relative major/minor and a perfect fifth, "nearby" reaches two steps.
 */
export function pitchSimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  if (!a.key || !b.key) return null;
  if ((a.keyStrength ?? 0) < MIN_KEY_STRENGTH || (b.keyStrength ?? 0) < MIN_KEY_STRENGTH) return null;

  const rootA = pitchClassOf(a.key);
  const rootB = pitchClassOf(b.key);
  if (rootA === null || rootB === null) return null;

  const sameScale = a.scale === b.scale;
  if (rootA === rootB && sameScale) return 1;

  // Relative major/minor: the minor root sits three semitones below the major's.
  if (!sameScale) {
    const major = a.scale === "major" ? rootA : rootB;
    const minor = a.scale === "major" ? rootB : rootA;
    if ((major - 3 + 12) % 12 === minor % 12) return 0.88;
  }

  // Distance in perfect fifths, which is how key proximity is actually heard —
  // C and G are neighbours, C and F# are as far apart as keys get.
  const fifths = (root: number) => (root * 7) % 12;
  const raw = Math.abs(fifths(rootA) - fifths(rootB));
  const distance = Math.min(raw, 12 - raw);

  const byDistance = [1, 0.8, 0.65, 0.45, 0.28, 0.15, 0.08];
  const score = byDistance[distance] ?? 0;

  return sameScale ? score : score * 0.9;
}

/**
 * Similarity by tempo, or `null` when either BPM is missing or was reported at a
 * confidence too low to trust.
 *
 * Half and double time count as a match: see `TEMPO_RATIOS`.
 */
export function tempoSimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  const usable = (analysis: MeasuredAnalysis) =>
    analysis.bpm !== null
    && analysis.bpm > 0
    && (analysis.bpmConfidence ?? 0) >= MIN_BPM_CONFIDENCE;

  if (!usable(a) || !usable(b)) return null;

  const bpmA = a.bpm as number;
  const bpmB = b.bpm as number;

  let closest = Infinity;
  for (const ratio of TEMPO_RATIOS) {
    closest = Math.min(closest, Math.abs(bpmA - bpmB * ratio) / bpmA);
  }

  return clamp(1 - closest / TEMPO_TOLERANCE);
}

/**
 * Similarity of harmonic content, from the 12-bin chroma. Cosine similarity, which
 * for non-negative vectors already lands in 0..1.
 *
 * Chroma is pitch content with octave collapsed, so this recognises two fragments
 * built from the same notes even when one is an octave up or voiced differently.
 */
export function harmonySimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  return cosine(a.chroma, b.chroma);
}

/**
 * Similarity of timbre, from the MFCC means.
 *
 * Coefficient 0 is skipped: it tracks overall loudness rather than timbre, and its
 * magnitude dwarfs the rest, so including it would rank fragments by how loud they
 * were recorded. The remaining coefficients can be negative, so the cosine is
 * mapped from -1..1 onto 0..1.
 */
export function timbreSimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  if (!a.timbre || !b.timbre || a.timbre.length < 2 || b.timbre.length < 2) return null;

  const raw = cosine(a.timbre.slice(1), b.timbre.slice(1));
  return raw === null ? null : clamp((raw + 1) / 2);
}

/**
 * Similarity of brightness, from the spectral centroid, compared in octaves —
 * pitch and brightness are both heard ratiometrically, so 400Hz against 800Hz is
 * the same distance as 800Hz against 1600Hz.
 */
export function brightnessSimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  return octaveSimilarity(a.centroidHz, b.centroidHz, BRIGHTNESS_OCTAVES);
}

/**
 * Similarity of rhythmic activity, from onset density in onsets per second.
 *
 * An empty onset list is a measurement, not a gap: a sustained pad genuinely has no
 * onsets. Two such fragments are rhythmically alike, and one of them against a busy
 * drum take is as different as this axis gets.
 */
export function rhythmSimilarity(a: ComparableFragment, b: ComparableFragment): number | null {
  const density = (fragment: ComparableFragment) => {
    const onsets = fragment.analysis.onsets;
    if (!onsets || fragment.measuredSeconds <= 0) return null;
    return onsets.length / fragment.measuredSeconds;
  };

  const densityA = density(a);
  const densityB = density(b);
  if (densityA === null || densityB === null) return null;

  if (densityA === 0 && densityB === 0) return 1;
  if (densityA === 0 || densityB === 0) return 0;

  return octaveSimilarity(densityA, densityB, RHYTHM_OCTAVES);
}

/**
 * Similarity of spectral flatness: how alike two fragments are on the tonal to
 * noise-like scale, scaled to the range real audio occupies — see
 * `FLATNESS_TOLERANCE`.
 */
export function flatnessSimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  if (a.flatness === null || a.flatness === undefined) return null;
  if (b.flatness === null || b.flatness === undefined) return null;

  return clamp(1 - Math.abs(a.flatness - b.flatness) / FLATNESS_TOLERANCE);
}

/**
 * Similarity of dynamic behaviour, from dynamic complexity in dB.
 *
 * This is deliberately not loudness. Loudness describes what gain something was
 * recorded at; dynamic complexity describes whether a performance breathes, which
 * is a property of the playing.
 */
export function dynamicsSimilarity(a: MeasuredAnalysis, b: MeasuredAnalysis): number | null {
  if (a.dynamicComplexity === null || a.dynamicComplexity === undefined) return null;
  if (b.dynamicComplexity === null || b.dynamicComplexity === undefined) return null;

  return clamp(1 - Math.abs(a.dynamicComplexity - b.dynamicComplexity) / DYNAMICS_TOLERANCE);
}

/** Every axis at once. */
export function compareFragments(a: ComparableFragment, b: ComparableFragment): RelationshipMetrics {
  return {
    tempo: tempoSimilarity(a.analysis, b.analysis),
    pitch: pitchSimilarity(a.analysis, b.analysis),
    harmony: harmonySimilarity(a.analysis, b.analysis),
    timbre: timbreSimilarity(a.analysis, b.analysis),
    brightness: brightnessSimilarity(a.analysis, b.analysis),
    rhythm: rhythmSimilarity(a, b),
    flatness: flatnessSimilarity(a.analysis, b.analysis),
    dynamics: dynamicsSimilarity(a.analysis, b.analysis),
  };
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** Ratio distance in octaves, mapped to 0..1. Both values must be positive. */
function octaveSimilarity(a: number | null | undefined, b: number | null | undefined, octaves: number) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  if (a <= 0 || b <= 0) return null;

  return clamp(1 - Math.abs(Math.log2(a / b)) / octaves);
}

function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  // A zero vector has no direction, so there is no similarity to report. Silence
  // measured as all-zero chroma must not read as "identical to everything".
  if (normA === 0 || normB === 0) return null;

  return dot / Math.sqrt(normA * normB);
}
