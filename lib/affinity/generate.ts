// Turning measured fragments into relationships.
//
// Deterministic by construction: the same fragments in any order produce the same
// relationships with the same ids, so a rebuild is a no-op rather than a reshuffle.
// Nothing here consults the user's search weights — those steer ranking at display
// time, in `score.ts`. Generation must not bake a preference into what exists.
//
// Pure and dually compiled: relative extensionless imports, no `node:*`, no DOM.

import type { RelationshipDocument, RelationshipMetrics } from "../domain/source-document";
import { METRIC_AXES, measuredAxes } from "../domain/source-document";
import type { ComparableFragment } from "./compare";
import { compareFragments } from "./compare";

/**
 * How much each axis counts when deciding whether a relationship is worth
 * recording. Harmony leads because shared pitch content is the most reliable
 * indicator that two fragments will sit together; brightness trails because it is
 * the one most easily changed with an EQ.
 */
const GENERATION_WEIGHTS: Record<keyof RelationshipMetrics, number> = {
  harmony: 3,
  pitch: 2,
  timbre: 2,
  tempo: 2,
  rhythm: 1.5,
  brightness: 1,
};

/**
 * A relationship resting on one axis is not evidence. Two fragments that merely
 * share a spectral centroid have nothing to do with each other, and emitting that
 * would bury the pairs that agree on several axes.
 */
export const MIN_MEASURED_AXES = 2;

/**
 * Below this weighted similarity, a pair is not worth recording.
 *
 * Chosen against the measured spread rather than picked as a round number. Across
 * the library's cross-source pairs the similarities run 0.36 to 1.00 with a median
 * of 0.66, so a floor in the fifties keeps three quarters of everything and says
 * nothing. At 0.70 roughly a quarter survives, which is few enough that a
 * relationship existing is itself information.
 */
export const MIN_SIMILARITY = 0.7;

/**
 * Kept per fragment. A cap rather than a global limit so a well-measured fragment
 * cannot crowd every other fragment out of its own list.
 */
export const MAX_PER_FRAGMENT = 12;

export type GenerateOptions = {
  minSimilarity?: number;
  maxPerFragment?: number;
};

/**
 * The weighted mean of the measured axes, or `null` if too few were measured.
 *
 * Weights of absent axes are excluded from the denominator, so a pair measured on
 * harmony and timbre alone is judged on those two rather than penalised for the
 * four that could not be measured.
 */
export function generationSimilarity(metrics: RelationshipMetrics): number | null {
  const present = measuredAxes(metrics);
  if (present.length < MIN_MEASURED_AXES) return null;

  let total = 0;
  let weight = 0;
  for (const axis of present) {
    const score = metrics[axis] as number;
    total += score * GENERATION_WEIGHTS[axis];
    weight += GENERATION_WEIGHTS[axis];
  }

  return weight > 0 ? total / weight : null;
}

/**
 * What it would take to sit these two together, 0 to 1.
 *
 * Only tempo and key contribute: those are what a user would have to stretch or
 * transpose. Timbre and brightness differences are not costs, they are the point.
 */
export function transformationCostFor(metrics: RelationshipMetrics): number {
  const tempoCost = metrics.tempo === null ? 0 : (1 - metrics.tempo) * 0.08;
  const pitchCost = metrics.pitch === null ? 0 : (1 - metrics.pitch) * 0.08;

  return round(tempoCost + pitchCost, 4);
}

const AXIS_PHRASES: Record<keyof RelationshipMetrics, string> = {
  harmony: "shared harmonic content",
  pitch: "a related key",
  tempo: "a matching pulse",
  timbre: "a similar timbre",
  rhythm: "comparable rhythmic activity",
  brightness: "a similar brightness",
};

/**
 * Why this pair was recorded, in the words of the measurements that produced it.
 *
 * Names the axes that actually agreed, and says plainly which were not measured,
 * so a thin relationship reads as thin rather than as a confident claim.
 */
export function reasonFor(metrics: RelationshipMetrics): string {
  const strong = METRIC_AXES
    .filter((axis) => (metrics[axis] ?? 0) >= 0.75)
    .sort((a, b) => (metrics[b] as number) - (metrics[a] as number));

  const absent = METRIC_AXES.filter((axis) => metrics[axis] === null);

  const lead = strong.length === 0
    ? "A broad resemblance with no single axis standing out"
    : strong.length === 1
      ? `Matched on ${AXIS_PHRASES[strong[0]]}`
      : `Matched on ${AXIS_PHRASES[strong[0]]} and ${AXIS_PHRASES[strong[1]]}`;

  const caveat = absent.length ? ` Not measured: ${absent.join(", ")}.` : "";

  return `${lead}.${caveat}`;
}

/**
 * A stable id for a pair, independent of the order the fragments arrive in.
 *
 * Rebuilding must not renumber relationships: the ids are what the user's
 * auditioned, preferred and rejected marks hang off, and reshuffling them would
 * silently reassign somebody's judgement to a different pair.
 */
export function relationshipIdFor(first: string, second: string): string {
  const [a, b] = [first, second].sort();
  return `aff-${a}-${b}`;
}

/**
 * Every relationship worth recording among these fragments.
 *
 * Fragments from the same source are never paired: two slices of one take are
 * trivially similar, and they would fill every list before anything from another
 * recording could appear.
 */
export function generateRelationships(
  fragments: ComparableFragment[],
  options: GenerateOptions = {},
): RelationshipDocument[] {
  const minSimilarity = options.minSimilarity ?? MIN_SIMILARITY;
  const maxPerFragment = options.maxPerFragment ?? MAX_PER_FRAGMENT;

  // Sorted so the output order depends only on the fragments themselves.
  const ordered = [...fragments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  type Candidate = { relationship: RelationshipDocument; similarity: number };
  const candidates: Candidate[] = [];

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const a = ordered[i];
      const b = ordered[j];
      if (a.sourceId === b.sourceId) continue;

      const metrics = compareFragments(a, b);
      const similarity = generationSimilarity(metrics);
      if (similarity === null || similarity < minSimilarity) continue;

      candidates.push({
        similarity,
        relationship: {
          id: relationshipIdFor(a.id, b.id),
          source: a.id,
          target: b.id,
          base: round(similarity, 4),
          metrics,
          transformationCost: transformationCostFor(metrics),
          reason: reasonFor(metrics),
          origin: "algorithmic",
        },
      });
    }
  }

  // Each fragment keeps its own best, then the union is emitted once per pair. A
  // pair surviving on either side survives, so the cap trims rather than truncates.
  const keep = new Set<string>();
  const byFragment = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    for (const id of [candidate.relationship.source, candidate.relationship.target]) {
      const list = byFragment.get(id) ?? [];
      list.push(candidate);
      byFragment.set(id, list);
    }
  }

  for (const list of byFragment.values()) {
    list
      .sort((a, b) => b.similarity - a.similarity || (a.relationship.id < b.relationship.id ? -1 : 1))
      .slice(0, maxPerFragment)
      .forEach((candidate) => keep.add(candidate.relationship.id));
  }

  return candidates
    .filter((candidate) => keep.has(candidate.relationship.id))
    .sort((a, b) => (a.relationship.id < b.relationship.id ? -1 : 1))
    .map((candidate) => candidate.relationship);
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
