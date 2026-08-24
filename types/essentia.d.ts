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

    /**
     * The raw algorithm surface. `EssentiaExtractor` extends `Essentia`, which
     * constructs `new EssentiaWASM.EssentiaJS(...)` and keeps it here, so the one
     * bundle the renderer already loads carries every core algorithm too. Typed
     * from `lib/analysis/features` so the browser and Node share one definition
     * of what is called and with which parameters.
     */
    algorithms: import("../lib/analysis/features").EssentiaAlgorithms;
  }
}
