// A corpus of raw vectors becomes the matrix PCA takes.
//
// Robust scaling, not z-scoring: these distributions are skewed, and two outlying
// recordings would otherwise compress everything else into a point.

import { DIMENSIONS, GROUP_WEIGHTS, type DimensionGroup } from "./feature-vector";

export type FeatureMatrix = {
  /** One row per asset, one column per surviving dimension. */
  rows: number[][];
  /** The surviving dimension names, in column order. */
  dimensions: string[];
  /** Names dropped for having no spread. */
  dropped: string[];
  /** Per asset, how many of its dimensions were absent. Counted before dropping. */
  imputed: number[];
};

/** How far a scaled value may travel from the median before it is clipped. */
const CLIP = 4;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function buildFeatureMatrix(vectors: (number | null)[][]): FeatureMatrix {
  if (vectors.length === 0) return { rows: [], dimensions: [], dropped: [], imputed: [] };

  const imputed = vectors.map((vector) => vector.filter((value) => value === null).length);

  const kept: { name: string; group: DimensionGroup; scaled: number[] }[] = [];
  const dropped: string[] = [];

  DIMENSIONS.forEach((dimension, column) => {
    const present = vectors
      .map((vector) => vector[column])
      .filter((value): value is number => value !== null && Number.isFinite(value));

    // Nothing measured this anywhere, so there is nothing to scale against.
    if (present.length === 0) {
      dropped.push(dimension.name);
      return;
    }

    const sorted = [...present].sort((a, b) => a - b);
    const centre = median(present);
    const spread = quantile(sorted, 0.75) - quantile(sorted, 0.25);

    // A constant dimension carries no information, and its IQR is 0 — dividing by
    // it would put Infinity or NaN through every row. `intensity` is the realistic
    // case: it only ever takes -1, 0 or 1.
    if (spread === 0) {
      dropped.push(dimension.name);
      return;
    }

    kept.push({
      name: dimension.name,
      group: dimension.group,
      // An absent value becomes 0, which after centring *is* the axis origin: the
      // asset contributes nothing to this direction rather than asserting a value.
      scaled: vectors.map((vector) => {
        const value = vector[column];
        if (value === null || !Number.isFinite(value)) return 0;
        return Math.max(-CLIP, Math.min(CLIP, (value - centre) / spread));
      }),
    });
  });

  const groups = Object.keys(GROUP_WEIGHTS) as DimensionGroup[];
  const columnsByGroup = new Map<DimensionGroup, number[]>(
    groups.map((group) => [
      group,
      kept.reduce<number[]>((found, dimension, index) => {
        if (dimension.group === group) found.push(index);
        return found;
      }, []),
    ]),
  );

  const rows = vectors.map((_, row) => {
    const values = kept.map((dimension) => dimension.scaled[row]);

    // Per-group L2 then a weight. Without this the 24 harmony and timbre
    // dimensions decide every position on their own.
    for (const group of groups) {
      const columns = columnsByGroup.get(group) ?? [];
      const norm = Math.hypot(...columns.map((column) => values[column]));
      if (norm === 0) continue;
      const factor = GROUP_WEIGHTS[group] / norm;
      for (const column of columns) values[column] *= factor;
    }

    return values;
  });

  return { rows, dimensions: kept.map((dimension) => dimension.name), dropped, imputed };
}
