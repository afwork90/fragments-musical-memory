// Ranking a relationship for display.
//
// Pure and dually compiled, so the app and any batch pass rank identically:
// relative extensionless imports, no `node:*`, no DOM.
//
// The important property is that an axis nobody measured must not drag a score
// down. Metrics are nullable, so the weighted mean is taken over the axes that are
// present and its denominator shrinks to match. A pair whose tempo is unknown is
// ranked on harmony, timbre, rhythm and brightness rather than penalised for a
// measurement essentia declined to make.

import type { Relationship } from "../view/relationship";
import type { RangeMode, SearchContext } from "../view/vocabulary";
import type { SearchWeights } from "../view/search";

/**
 * How strongly each axis counts, before the user's weights.
 *
 * `rhythm`, `harmony` and `timbre` are scaled by the user's sliders. `tempo`,
 * `pitch` and `brightness` are not steerable and carry these fixed weights, which
 * are the same numbers the previous inline scorer used.
 */
const FIXED_WEIGHTS = { tempo: 12, pitch: 10, brightness: 8, flatness: 8, dynamics: 8 } as const;

/**
 * Per-context emphasis. There is no melody axis to emphasise, so "melody" leans on
 * harmony and pitch — chroma is what carries pitch content — rather than on a
 * number nobody computes.
 */
const CONTEXT_MULTIPLIERS: Record<SearchContext, SearchWeights> = {
  whole: { rhythm: 1, harmony: 1, timbre: 1 },
  melody: { rhythm: 0.28, harmony: 2.2, timbre: 0.55 },
  rhythm: { rhythm: 2.8, harmony: 0.22, timbre: 0.72 },
  harmony: { rhythm: 0.42, harmony: 2.6, timbre: 0.5 },
  bass: { rhythm: 1.8, harmony: 1.45, timbre: 1.25 },
};

/**
 * The weighted mean of the measured axes, 0 to 1, or `null` when nothing was
 * measured at all — which is different from a similarity of zero and must not be
 * flattened into one.
 */
export function similarityOf(
  relationship: Relationship,
  weights: SearchWeights,
  context: SearchContext,
): number | null {
  const multiplier = CONTEXT_MULTIPLIERS[context];
  const contributions: Array<[number | null, number]> = [
    [relationship.metrics.rhythm, weights.rhythm * multiplier.rhythm],
    [relationship.metrics.harmony, weights.harmony * multiplier.harmony],
    [relationship.metrics.timbre, weights.timbre * multiplier.timbre],
    [relationship.metrics.tempo, FIXED_WEIGHTS.tempo],
    [relationship.metrics.pitch, FIXED_WEIGHTS.pitch],
    [relationship.metrics.brightness, FIXED_WEIGHTS.brightness],
    [relationship.metrics.flatness, FIXED_WEIGHTS.flatness],
    [relationship.metrics.dynamics, FIXED_WEIGHTS.dynamics],
  ];

  let total = 0;
  let weight = 0;
  for (const [score, axisWeight] of contributions) {
    if (score === null || axisWeight <= 0) continue;
    total += score * axisWeight;
    weight += axisWeight;
  }

  return weight > 0 ? total / weight : null;
}

/**
 * The 0–99 score shown in the UI.
 *
 * A relationship with nothing measured scores 0 rather than throwing: it is real
 * (someone or something asserted it) but says nothing about why, so it ranks last.
 */
export function scoreRelationship(
  relationship: Relationship,
  weights: SearchWeights,
  context: SearchContext,
  mode: RangeMode,
): number {
  const similarity = similarityOf(relationship, weights, context) ?? 0;
  const penalty = relationship.transformationCost * (mode === "experimental" ? 0.46 : 1);
  const score = (similarity * 0.9 + relationship.base * 0.1 - penalty) * 100;

  return Math.round(Math.max(0, Math.min(99, score)));
}
