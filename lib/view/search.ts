// How the user steers matching: axis weights and how far a match may stray.
//
// These defaults are real application settings, not part of the prototype
// dataset — they describe the app's starting preferences and survive it.

export type SearchWeights = {
  rhythm: number;
  harmony: number;
  melody: number;
  timbre: number;
};

export type MatchTolerances = {
  /** Percent of the anchor's BPM a candidate may differ by. */
  tempoWindow: number;
  keyFlexibility: "exact" | "related" | "nearby";
  lengthTolerance: "same" | "one" | "any";
  allowRepetition: boolean;
};

export const DEFAULT_WEIGHTS: SearchWeights = { rhythm: 54, harmony: 72, melody: 68, timbre: 36 };

export const DEFAULT_TOLERANCES: MatchTolerances = {
  tempoWindow: 10,
  keyFlexibility: "related",
  lengthTolerance: "one",
  allowRepetition: true,
};
