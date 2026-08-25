// Measuring audio features with essentia.
//
// Essentia is injected rather than imported: the Node build and the browser build
// load different bundles, and only the caller knows which host it is in. This
// module owns the parameters and the framing, so both hosts measure identically.
//
// Everything essentia's own type declarations get wrong is handled here:
//
//  - Every algorithm parameter must be passed. The bindings have no defaults even
//    though `core_api.d.ts` marks them optional; omitting one throws
//    "called with 4 arguments, expected 6".
//  - `vectorToArray` throws on a zero-length vector, so an algorithm that
//    legitimately found nothing is indistinguishable from a crash unless guarded.
//  - There is no `FrameGenerator` in the Node bundle, so framing is done here.

import type { MeasuredAnalysis } from "../domain/source-document";
import { FEATURE_SAMPLE_RATE } from "./resample";

/**
 * The slice of essentia this module uses. Deliberately not `any`: a typo in an
 * algorithm or parameter name should be a compile error, which is the whole
 * reason the hand-written declaration in `types/essentia.d.ts` exists.
 */
export type EssentiaHost = {
  arrayToVector(input: Float32Array): unknown;
  vectorToArray(input: unknown): Float32Array;
  algorithms: EssentiaAlgorithms;
};

export type EssentiaAlgorithms = {
  RhythmExtractor2013(
    signal: unknown,
    maxTempo: number,
    method: string,
    minTempo: number,
  ): { bpm: number; confidence: number; ticks: { size(): number } };
  KeyExtractor(
    signal: unknown,
    averageDetuningCorrection: boolean,
    frameSize: number,
    hopSize: number,
    hpcpSize: number,
    maxFrequency: number,
    maximumSpectralPeaks: number,
    minFrequency: number,
    pcpThreshold: number,
    profileType: string,
    sampleRate: number,
    spectralPeaksThreshold: number,
    tuningFrequency: number,
    weightType: string,
    windowType: string,
  ): { key: string; scale: string; strength: number };
  SuperFluxExtractor(
    signal: unknown,
    combine: number,
    frameSize: number,
    hopSize: number,
    ratioThreshold: number,
    sampleRate: number,
    threshold: number,
  ): { onsets: SizedVector };
  Windowing(
    frame: unknown,
    normalized: boolean,
    size: number,
    type: string,
    zeroPadding: number,
    zeroPhase: boolean,
  ): { frame: unknown };
  Spectrum(frame: unknown, size: number): { spectrum: unknown };
  MFCC(
    spectrum: unknown,
    dctType: number,
    highFrequencyBound: number,
    inputSize: number,
    liftering: number,
    logType: string,
    lowFrequencyBound: number,
    normalize: string,
    numberBands: number,
    numberCoefficients: number,
    sampleRate: number,
    silenceThreshold: number,
    type: string,
    warpingFormula: string,
    weighting: string,
  ): { mfcc: SizedVector };
  SpectralPeaks(
    spectrum: unknown,
    magnitudeThreshold: number,
    maxFrequency: number,
    maxPeaks: number,
    minFrequency: number,
    orderBy: string,
    sampleRate: number,
  ): { frequencies: unknown; magnitudes: unknown };
  HPCP(
    frequencies: unknown,
    magnitudes: unknown,
    bandPreset: boolean,
    bandSplitFrequency: number,
    harmonics: number,
    maxFrequency: number,
    maxShifted: boolean,
    minFrequency: number,
    nonLinear: boolean,
    normalized: string,
    referenceFrequency: number,
    sampleRate: number,
    size: number,
    weightType: string,
    windowSize: number,
  ): { hpcp: SizedVector };
  SpectralCentroidTime(array: unknown, sampleRate: number): { centroid: number };
  /**
   * Takes two channels. Ours is mono, so the same signal goes to both — see
   * `measureLoudness`. Works at 22050Hz, unlike `LoudnessVickers` and `ReplayGain`,
   * which abort at anything but 44100.
   */
  LoudnessEBUR128(
    leftSignal: unknown,
    rightSignal: unknown,
    hopSize: number,
    sampleRate: number,
    startAtZero: boolean,
  ): { integratedLoudness: number; loudnessRange: number };
  DynamicComplexity(
    signal: unknown,
    frameSize: number,
    sampleRate: number,
  ): { dynamicComplexity: number; loudness: number };
  RMS(array: unknown): { rms: number };
  Flatness(array: unknown): { flatness: number };
  Intensity(signal: unknown, sampleRate: number): { intensity: number };
};

type SizedVector = { size(): number };

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const MFCC_COEFFICIENTS = 13;
const CHROMA_BINS = 12;

/**
 * A tempo below this confidence is reported but should not be trusted. Essentia's
 * multifeature confidence runs 0–5.32; short or unrhythmic audio characteristically
 * returns a plausible BPM at a confidence of 0.
 */
export const MIN_BPM_CONFIDENCE = 1;

/**
 * The longest stretch handed to essentia, in seconds.
 *
 * Not a tuning knob: `arrayToVector` copies the whole signal into the WASM heap and
 * `RhythmExtractor2013` allocates on top of it, so an unbounded signal exhausts the
 * heap. A 5.8-minute recording killed the batch process outright (SIGKILL, no
 * catchable error, because Emscripten's abort is not a JS exception). The renderer
 * always capped its signal; the batch pass did not and merely got away with it on
 * shorter files.
 *
 * Ninety seconds of a recording is ample for a tempo and a key, and both hosts must
 * use the same window or they would report different numbers for the same audio.
 */
export const FEATURE_MAX_SECONDS = 90;

export function windowForFeatures(
  signal: Float32Array,
  sampleRate: number,
  maxSeconds: number = FEATURE_MAX_SECONDS,
): Float32Array {
  const maxSamples = Math.min(signal.length, Math.floor(sampleRate * maxSeconds));
  if (signal.length === maxSamples) return signal;

  // `slice`, not `subarray`: a view keeps its whole backing buffer alive, and
  // `arrayToVector` copies based on the buffer rather than the view, so handing it a
  // 90-second view of a 5.8-minute recording pushed the full 5.8 minutes into the
  // WASM heap and the process was killed. A copy costs one allocation and is the
  // only form that means what it says.
  return signal.slice(0, maxSamples);
}

export type ExtractedFeatures = Pick<
  MeasuredAnalysis,
  | "bpm"
  | "key"
  | "scale"
  | "keyStrength"
  | "bpmConfidence"
  | "timbre"
  | "chroma"
  | "centroidHz"
  | "onsets"
  | "featureSampleRate"
  | "lufs"
  | "loudnessRange"
  | "dynamicComplexity"
  | "rms"
  | "flatness"
  | "intensity"
  | "leadingSilence"
  | "trailingSilence"
>;

/**
 * Below this magnitude a sample counts as silence when trimming, about -60dBFS.
 *
 * Trimming is done here rather than with essentia's `StartStopSilence`, whose
 * bindings return an empty object — no `start`, no `stop`. Scanning for the first
 * and last sample above a threshold is a few lines and does exactly what it says.
 */
const SILENCE_FLOOR = 0.001;

/** Leading and trailing silence in seconds. */
function measureSilence(signal: Float32Array, sampleRate: number) {
  let first = -1;
  for (let i = 0; i < signal.length; i++) {
    if (Math.abs(signal[i]) > SILENCE_FLOOR) { first = i; break; }
  }

  // Entirely silent: there is no leading or trailing edge to report, and calling
  // the whole thing "leading silence" would be a stranger claim than saying nothing.
  if (first === -1) return { leadingSilence: null, trailingSilence: null };

  let last = signal.length - 1;
  while (last > first && Math.abs(signal[last]) <= SILENCE_FLOOR) last--;

  return {
    leadingSilence: round(first / sampleRate, 3),
    trailingSilence: round((signal.length - 1 - last) / sampleRate, 3),
  };
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Guards the empty-vector throw described at the top of this file. */
function toArray(essentia: EssentiaHost, vector: SizedVector): Float32Array {
  return vector.size() === 0 ? new Float32Array(0) : essentia.vectorToArray(vector);
}

/**
 * `signal` must already be mono at `FEATURE_SAMPLE_RATE` — see `resample`.
 *
 * Every field is independent: one algorithm failing leaves the rest measured and
 * that field null. Null means "not measured", which is never the same as zero.
 */
export function extractFeatures(essentia: EssentiaHost, signal: Float32Array): ExtractedFeatures {
  const sampleRate = FEATURE_SAMPLE_RATE;
  const algorithms = essentia.algorithms;
  const features: ExtractedFeatures = {
    bpm: null,
    key: null,
    scale: null,
    keyStrength: null,
    bpmConfidence: null,
    timbre: null,
    chroma: null,
    centroidHz: null,
    onsets: null,
    featureSampleRate: sampleRate,
    lufs: null,
    loudnessRange: null,
    dynamicComplexity: null,
    rms: null,
    flatness: null,
    intensity: null,
    leadingSilence: null,
    trailingSilence: null,
  };

  if (signal.length < FRAME_SIZE) return features;

  const silence = measureSilence(signal, sampleRate);
  features.leadingSilence = silence.leadingSilence;
  features.trailingSilence = silence.trailingSilence;

  try {
    // Mono into both channels. EBUR128 sums channel energy, so this reads roughly
    // 3dB hotter than a true mono meter would. It is consistent across every
    // fragment, which is what comparison needs; it is not what a mastering meter
    // would show. Carrying real stereo through decode is what would fix that.
    const loudness = algorithms.LoudnessEBUR128(
      essentia.arrayToVector(signal), essentia.arrayToVector(signal), 0.1, sampleRate, false,
    );
    if (Number.isFinite(loudness.integratedLoudness)) {
      features.lufs = round(loudness.integratedLoudness, 2);
    }
    if (Number.isFinite(loudness.loudnessRange)) {
      features.loudnessRange = round(loudness.loudnessRange, 2);
    }
  } catch {
    // Leave loudness null.
  }

  try {
    const dynamics = algorithms.DynamicComplexity(essentia.arrayToVector(signal), 0.2, sampleRate);
    if (Number.isFinite(dynamics.dynamicComplexity)) {
      features.dynamicComplexity = round(dynamics.dynamicComplexity, 3);
    }
  } catch {
    // Leave dynamicComplexity null.
  }

  try {
    const rms = algorithms.RMS(essentia.arrayToVector(signal));
    if (Number.isFinite(rms.rms)) features.rms = round(rms.rms, 5);
  } catch {
    // Leave rms null.
  }

  try {
    // -1 relaxed, 0 moderate, 1 aggressive.
    const intensity = algorithms.Intensity(essentia.arrayToVector(signal), sampleRate);
    if (Number.isFinite(intensity.intensity)) features.intensity = Math.round(intensity.intensity);
  } catch {
    // Leave intensity null.
  }

  // RhythmExtractor2013, not PercivalBpmEstimator: on the one library recording
  // with a known tempo, Percival returned 198.8 against a true 100, and reported
  // an identical 215.3 across unrelated files.
  try {
    const rhythm = algorithms.RhythmExtractor2013(essentia.arrayToVector(signal), 208, "multifeature", 40);
    if (Number.isFinite(rhythm.bpm) && rhythm.bpm > 0) {
      features.bpm = Math.round(rhythm.bpm);
      features.bpmConfidence = round(rhythm.confidence, 2);
    }
  } catch {
    // Leave bpm null: not measured.
  }

  try {
    const key = algorithms.KeyExtractor(
      essentia.arrayToVector(signal),
      true, 4096, 4096, 12, 3500, 60, 25, 0.2, "edma", sampleRate, 0.0001, 440, "cosine", "hann",
    );
    if (key.key) {
      features.key = key.key;
      features.scale = key.scale || null;
      features.keyStrength = Number.isFinite(key.strength) ? Math.round(key.strength * 100) : null;
    }
  } catch {
    // Leave key null.
  }

  try {
    const onsets = toArray(essentia, algorithms.SuperFluxExtractor(
      essentia.arrayToVector(signal), 20, FRAME_SIZE, 256, 16, sampleRate, 0.05,
    ).onsets);
    features.onsets = Array.from(onsets, (time) => round(time, 3));
  } catch {
    // Leave onsets null.
  }

  try {
    const framed = extractFrameFeatures(essentia, signal, sampleRate);
    features.timbre = framed.timbre;
    features.chroma = framed.chroma;
    features.centroidHz = framed.centroidHz;
    features.flatness = framed.flatness;
  } catch {
    // Leave the frame-based features null.
  }

  return features;
}

/**
 * Averages MFCC, chroma, and centroid over frames.
 *
 * A mean discards how a sound evolves, which is a real limitation: it cannot tell
 * a swell from a decay. It is kept because it is comparable with a single cosine
 * distance, which is what the affinity work needs first.
 */
function extractFrameFeatures(essentia: EssentiaHost, signal: Float32Array, sampleRate: number) {
  const algorithms = essentia.algorithms;
  const mfccTotals = new Float64Array(MFCC_COEFFICIENTS);
  const chromaTotals = new Float64Array(CHROMA_BINS);
  let centroidTotal = 0;
  let flatnessTotal = 0;
  let frames = 0;

  for (let start = 0; start + FRAME_SIZE <= signal.length; start += HOP_SIZE) {
    const frame = essentia.arrayToVector(signal.subarray(start, start + FRAME_SIZE));
    const windowed = algorithms.Windowing(frame, true, FRAME_SIZE, "hann", 0, true).frame;
    const spectrum = algorithms.Spectrum(windowed, FRAME_SIZE).spectrum;

    const mfcc = toArray(essentia, algorithms.MFCC(
      spectrum, 2, 11000, FRAME_SIZE / 2 + 1, 0, "dbamp", 0, "unit_sum",
      40, MFCC_COEFFICIENTS, sampleRate, 1e-10, "power", "htkMel", "warping",
    ).mfcc);
    for (let i = 0; i < MFCC_COEFFICIENTS && i < mfcc.length; i++) mfccTotals[i] += mfcc[i];

    const peaks = algorithms.SpectralPeaks(spectrum, -1000, 5000, 100, 0, "frequency", sampleRate);
    const chroma = toArray(essentia, algorithms.HPCP(
      peaks.frequencies, peaks.magnitudes,
      true, 500, 0, 5000, false, 40, false, "unitMax", 440, sampleRate, CHROMA_BINS, "squaredCosine", 1,
    ).hpcp);
    for (let i = 0; i < CHROMA_BINS && i < chroma.length; i++) chromaTotals[i] += chroma[i];

    centroidTotal += algorithms.SpectralCentroidTime(frame, sampleRate).centroid;
    // 0 is a pure tone, 1 is white noise. Cheap here because the spectrum already
    // exists; a separate pass would double the framing cost for one number.
    flatnessTotal += algorithms.Flatness(spectrum).flatness;
    frames++;
  }

  if (frames === 0) return { timbre: null, chroma: null, centroidHz: null, flatness: null };

  return {
    timbre: Array.from(mfccTotals, (total) => round(total / frames, 3)),
    chroma: Array.from(chromaTotals, (total) => round(total / frames, 4)),
    centroidHz: round(centroidTotal / frames, 1),
    flatness: round(flatnessTotal / frames, 4),
  };
}
