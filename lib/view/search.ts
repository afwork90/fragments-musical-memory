// How the user steers matching: axis weights and how far a match may stray.
//
// These defaults are real application settings, not part of the prototype
// dataset — they describe the app's starting preferences and survive it.

/**
 * How much each axis counts when ranking matches.
 *
 * One weight per measurable axis of `RelationshipMetrics`. There is no `melody`
 * weight because there is no melody metric for it to scale — a slider that
 * multiplies a number nobody computes is a control that does nothing.
 */
export type SearchWeights = {
  rhythm: number;
  harmony: number;
  timbre: number;
};

export type MatchTolerances = {
  /** Percent of the anchor's BPM a candidate may differ by. */
  tempoWindow: number;
  keyFlexibility: "exact" | "related" | "nearby";
  lengthTolerance: "same" | "one" | "any";
  allowRepetition: boolean;
};

export const DEFAULT_WEIGHTS: SearchWeights = { rhythm: 54, harmony: 72, timbre: 36 };

export const DEFAULT_TOLERANCES: MatchTolerances = {
  tempoWindow: 10,
  keyFlexibility: "related",
  lengthTolerance: "one",
  allowRepetition: true,
};
