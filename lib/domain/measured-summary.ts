// The one place a disk-shaped `MeasuredAnalysis` becomes a display-shaped
// `MeasuredSummary`.
//
// It lives here rather than in the renderer because three callers need it: the app,
// `scripts/compute-prototype-sources.mjs`, and `scripts/fracture-report.mjs`. A
// Node script cannot import from a `.tsx` file, and a second copy of this mapping
// is how two views of one fragment start disagreeing.

import { FEATURE_MAX_SECONDS } from "../analysis/features";
import type { MeasuredSummary } from "../view/analysis";
import type { MeasuredAnalysis } from "./source-document";

/**
 * The measured fields worth showing a person, straight off the document.
 *
 * `seconds` is what the measurements cover, which is the shorter of the audio and
 * the analysis window — onset density is meaningless against the wrong denominator,
 * and it must match what `rhythmSimilarity` divided by or the panel would disagree
 * with the affinities it explains.
 */
export function measuredSummaryFrom(
  analysis: MeasuredAnalysis | undefined,
  seconds: number,
): MeasuredSummary | undefined {
  if (!analysis) return undefined;

  const measuredSeconds = Math.min(seconds, FEATURE_MAX_SECONDS);
  const origin = analysis.provenance?.origin;
  return {
    bpm: analysis.bpm ?? null,
    bpmConfidence: analysis.bpmConfidence ?? null,
    key: analysis.key ?? null,
    scale: analysis.scale ?? null,
    keyStrength: analysis.keyStrength ?? null,
    centroidHz: analysis.centroidHz ?? null,
    onsetsPerSecond: analysis.onsets && measuredSeconds > 0
      ? analysis.onsets.length / measuredSeconds
      : null,
    flatness: analysis.flatness ?? null,
    lufs: analysis.lufs ?? null,
    loudnessRange: analysis.loudnessRange ?? null,
    dynamicComplexity: analysis.dynamicComplexity ?? null,
    intensity: analysis.intensity ?? null,
    leadingSilence: analysis.leadingSilence ?? null,
    trailingSilence: analysis.trailingSilence ?? null,
    chroma: analysis.chroma?.length ? analysis.chroma : null,
    timbre: analysis.timbre?.length ? analysis.timbre : null,
    origin: origin === "measured" || origin === "edited" ? origin : null,
    extractor: analysis.provenance?.extractor ?? null,
    measuredAt: analysis.provenance?.at ?? null,
  };
}
