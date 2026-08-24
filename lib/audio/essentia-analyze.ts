import type { EssentiaAnalysis } from "./types";
import { loadEssentiaExtractor } from "./essentia-loader";
import { extractFeatures } from "../analysis/features";
import { FEATURE_SAMPLE_RATE, resample } from "../analysis/resample";

/**
 * Measures a decoded signal in the browser.
 *
 * The measurement itself lives in `lib/analysis/features.ts`, shared with the Node
 * batch pass, so the app and `npm run analyze` cannot drift into reporting
 * different numbers for the same audio. This function only gets the signal into
 * the shape that module requires.
 *
 * Callers pass whatever rate the browser decoded at — typically the output
 * device's 48kHz — and it is resampled here, because MFCC and chroma are only
 * comparable across sources measured at the same rate.
 *
 * How much audio to measure is the caller's decision: `audio-service` passes the
 * loudest window for an on-demand look and the leading 90 seconds on import.
 */
export async function analyzeSignal(
  signal: Float32Array,
  sampleRate: number,
): Promise<EssentiaAnalysis> {
  const essentia = await loadEssentiaExtractor();
  return extractFeatures(essentia, resample(signal, sampleRate, FEATURE_SAMPLE_RATE));
}
