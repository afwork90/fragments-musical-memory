// Grouping the corpus so colour can say something the axes cannot.
//
// Colouring by pitch class was independent of position, so the map read as
// confetti: two dots side by side, meaning "these sound alike", could be any two
// hues. Clusters come from the same features the layout does, so a region of the
// map is one colour, and colour becomes a grouping cue instead of noise.
//
// k-means, hand-rolled and deterministic. Normally it is seeded randomly, which
// would repaint the whole map on every reload — the same failure the PCA sign fix
// exists to prevent.

/** Upper bound on clusters: past this, hues stop being tellable apart. */
const MAX_CLUSTERS = 8;
const MAX_ITERATIONS = 50;

export type Clustering = {
  /** One cluster index per row. */
  assignments: number[];
  /** How many clusters actually have members. Can be fewer than requested. */
  count: number;
};

/** A legible number of groups for a corpus of this size. */
export function clusterCountFor(size: number): number {
  if (size <= 1) return size;
  return Math.max(2, Math.min(MAX_CLUSTERS, Math.round(Math.sqrt(size / 2))));
}

function distanceSquared(a: number[], b: number[]): number {
  let total = 0;
  for (let index = 0; index < a.length; index++) {
    const delta = a[index] - b[index];
    total += delta * delta;
  }
  return total;
}

/**
 * Farthest-point seeding from the most central row.
 *
 * Deterministic in place of k-means++'s weighted sampling, and it picks spread-out
 * starts, which is the property that matters here. Ties go to the lower index.
 */
function seedCentres(rows: number[][], k: number): number[][] {
  const width = rows[0].length;
  const mean = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + row[column], 0) / rows.length);

  let firstIndex = 0;
  let firstDistance = Infinity;
  rows.forEach((row, index) => {
    const distance = distanceSquared(row, mean);
    if (distance < firstDistance) {
      firstDistance = distance;
      firstIndex = index;
    }
  });

  const centres = [[...rows[firstIndex]]];

  while (centres.length < k) {
    let bestIndex = -1;
    let bestDistance = -1;
    rows.forEach((row, index) => {
      const nearest = Math.min(...centres.map((centre) => distanceSquared(row, centre)));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = index;
      }
    });
    // Every remaining row already sits on a centre, so there is no further group
    // to find. A constant corpus hits this immediately.
    if (bestIndex < 0 || bestDistance === 0) break;
    centres.push([...rows[bestIndex]]);
  }

  return centres;
}

export function clusterPoints(rows: number[][], k: number): Clustering {
  if (rows.length === 0 || rows[0].length === 0) return { assignments: [], count: 0 };

  const wanted = Math.max(1, Math.min(k, rows.length));
  let centres = seedCentres(rows, wanted);
  let assignments = new Array<number>(rows.length).fill(0);

  for (let step = 0; step < MAX_ITERATIONS; step++) {
    const next = rows.map((row) => {
      let best = 0;
      let bestDistance = Infinity;
      centres.forEach((centre, index) => {
        const distance = distanceSquared(row, centre);
        // Strictly less than, so a tie keeps the lower cluster index.
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      return best;
    });

    const settled = next.every((value, index) => value === assignments[index]);
    assignments = next;
    if (settled && step > 0) break;

    centres = centres.map((centre, cluster) => {
      const members = rows.filter((_, index) => assignments[index] === cluster);
      // An empty cluster keeps its centre rather than being reseeded, so the
      // result cannot depend on iteration order.
      if (members.length === 0) return centre;
      return Array.from({ length: rows[0].length }, (_, column) =>
        members.reduce((sum, row) => sum + row[column], 0) / members.length);
    });
  }

  // Renumber to close the gaps left by clusters nothing landed in, so `count` is
  // the number of colours actually needed.
  const used = [...new Set(assignments)].sort((a, b) => a - b);
  const remap = new Map(used.map((cluster, index) => [cluster, index]));

  return {
    assignments: assignments.map((cluster) => remap.get(cluster) ?? 0),
    count: used.length,
  };
}

/**
 * Renumbers clusters left to right by where their members sit.
 *
 * Cluster indices out of k-means are arbitrary, so a hue taken straight from one
 * would put adjacent regions at opposite ends of the colour wheel. Ordering by
 * position makes the ramp read as a progression across the map.
 */
export function renumberByPosition(
  assignments: number[],
  points: { x: number; y: number }[],
  count: number,
): number[] {
  const totals = new Array<number>(count).fill(0);
  const sizes = new Array<number>(count).fill(0);

  assignments.forEach((cluster, index) => {
    if (cluster < 0 || cluster >= count) return;
    totals[cluster] += points[index]?.x ?? 0;
    sizes[cluster] += 1;
  });

  const order = Array.from({ length: count }, (_, cluster) => cluster)
    .sort((a, b) => {
      const left = sizes[a] === 0 ? Infinity : totals[a] / sizes[a];
      const right = sizes[b] === 0 ? Infinity : totals[b] / sizes[b];
      // Ties go to the lower cluster index, so the result is stable.
      return left === right ? a - b : left - right;
    });

  const rank = new Map(order.map((cluster, index) => [cluster, index]));
  return assignments.map((cluster) => rank.get(cluster) ?? cluster);
}
