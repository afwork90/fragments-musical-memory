// essentia.js ships no type declarations. Declare only the surface we call,
// so an accidental typo in an extractor name is still a compile error.

declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: { ready: Promise<void> };
}

declare module "essentia.js/dist/essentia.js-extractor.es.js" {
  export type EssentiaVector = { size(): number; get(index: number): unknown };

  export default class EssentiaExtractor {
    constructor(wasm: unknown);
    arrayToVector(input: Float32Array): unknown;
    vectorToArray(input: unknown): Float32Array;
    FrameGenerator(signal: unknown, frameSize: number, hopSize: number): EssentiaVector;
    melSpectrumExtractor(frame: Float32Array, sampleRate: number): number[];
    PercivalBpmEstimator(
      signal: unknown,
      frameSize: number,
      frameSizeOSS: number,
      hopSize: number,
      hopSizeOSS: number,
      maxBPM: number,
      minBPM: number,
      sampleRate: number,
    ): { bpm: number };
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
  }
}
