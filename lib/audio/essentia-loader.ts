import type EssentiaExtractor from "essentia.js/dist/essentia.js-extractor.es.js";

type EssentiaInstance = InstanceType<typeof EssentiaExtractor>;

let essentiaPromise: Promise<EssentiaInstance> | null = null;

export async function loadEssentiaExtractor() {
  if (typeof window === "undefined") {
    throw new Error("Essentia analysis requires a browser environment");
  }

  if (!essentiaPromise) {
    essentiaPromise = (async () => {
      const [{ EssentiaWASM }, { default: EssentiaExtractorCtor }] = await Promise.all([
        import("essentia.js/dist/essentia-wasm.es.js"),
        import("essentia.js/dist/essentia.js-extractor.es.js"),
      ]);
      await EssentiaWASM.ready;
      return new EssentiaExtractorCtor(EssentiaWASM);
    })().catch((error) => {
      essentiaPromise = null;
      throw error;
    });
  }

  return essentiaPromise;
}

export type { EssentiaInstance };
