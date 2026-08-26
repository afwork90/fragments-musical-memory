import assert from "node:assert/strict";
import test from "node:test";

import { clusterCountFor, clusterPoints, renumberByPosition } from "../../electron-dist/lib/map/cluster.js";

/** Three tight, well-separated groups in one dimension. */
const THREE_GROUPS = [
  [0], [0.1], [0.2],
  [10], [10.1], [10.2],
  [20], [20.1], [20.2],
];

test("finds groups that are obviously groups", () => {
  const { assignments } = clusterPoints(THREE_GROUPS, 3);
  // Members of one group agree with each other and differ from the others.
  assert.equal(assignments[0], assignments[1]);
  assert.equal(assignments[1], assignments[2]);
  assert.equal(assignments[3], assignments[4]);
  assert.equal(assignments[6], assignments[7]);
  assert.notEqual(assignments[0], assignments[3]);
  assert.notEqual(assignments[3], assignments[6]);
});

test("every point is assigned", () => {
  const { assignments } = clusterPoints(THREE_GROUPS, 3);
  assert.equal(assignments.length, THREE_GROUPS.length);
  for (const value of assignments) assert.equal(Number.isInteger(value) && value >= 0, true);
});

test("clustering twice gives the identical answer", () => {
  // No RNG. k-means is normally seeded randomly, which would repaint the whole
  // map on every reload -- the same failure the PCA sign fix exists to prevent.
  const first = clusterPoints(THREE_GROUPS, 3).assignments;
  const second = clusterPoints(THREE_GROUPS, 3).assignments;
  assert.deepEqual(first, second);
});

test("asking for more clusters than there are points does not invent any", () => {
  const { assignments, count } = clusterPoints([[1], [2]], 8);
  assert.equal(count <= 2, true);
  assert.equal(assignments.length, 2);
});

test("a corpus that is entirely one value collapses to one cluster", () => {
  const { count } = clusterPoints([[5], [5], [5], [5]], 3);
  assert.equal(count, 1);
});

test("an empty corpus produces no clusters", () => {
  const { assignments, count } = clusterPoints([], 4);
  assert.deepEqual(assignments, []);
  assert.equal(count, 0);
});

test("renumbering orders clusters left to right", () => {
  // So the hue ramp reads as a progression across the map instead of jumping
  // about, which is what makes the regions legible.
  const assignments = [0, 0, 1, 1];
  const points = [{ x: 900, y: 0 }, { x: 1000, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  const ordered = renumberByPosition(assignments, points, 2);
  assert.equal(ordered[2], 0);
  assert.equal(ordered[3], 0);
  assert.equal(ordered[0], 1);
  assert.equal(ordered[1], 1);
});

test("renumbering keeps members of a cluster together", () => {
  const assignments = [2, 0, 2, 1, 0];
  const points = [{ x: 50, y: 0 }, { x: 5, y: 0 }, { x: 55, y: 0 }, { x: 90, y: 0 }, { x: 8, y: 0 }];
  const ordered = renumberByPosition(assignments, points, 3);
  assert.equal(ordered[0], ordered[2]);
  assert.equal(ordered[1], ordered[4]);
  assert.equal(new Set(ordered).size, 3);
});

test("cluster count grows with the corpus but stays in a legible range", () => {
  // Colour stops being a grouping cue once there are more hues than a person can
  // tell apart, so this is bounded on purpose.
  assert.equal(clusterCountFor(0), 0);
  assert.equal(clusterCountFor(1), 1);
  assert.equal(clusterCountFor(55) >= 4 && clusterCountFor(55) <= 8, true);
  assert.equal(clusterCountFor(5000) <= 8, true);
});
