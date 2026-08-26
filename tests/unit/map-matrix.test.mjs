import assert from "node:assert/strict";
import test from "node:test";

import { DIMENSIONS } from "../../electron-dist/lib/map/feature-vector.js";
import { buildFeatureMatrix, median } from "../../electron-dist/lib/map/matrix.js";

/** A vector where every dimension holds the same value, so tests can vary one. */
function flat(value) {
  return DIMENSIONS.map(() => value);
}

test("median of an even-length list averages the middle pair", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

test("rows line up with the surviving dimensions", () => {
  const built = buildFeatureMatrix([flat(1), flat(2), flat(3), flat(4)]);
  for (const row of built.rows) assert.equal(row.length, built.dimensions.length);
});

test("a dimension with no spread is dropped, not divided by", () => {
  // intensity is -1/0/1, so a corpus that agrees on it has an IQR of 0. Dividing
  // would put Infinity or NaN through every row.
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  const intensity = DIMENSIONS.findIndex((dimension) => dimension.name === "intensity");
  for (const vector of vectors) vector[intensity] = 0;

  const built = buildFeatureMatrix(vectors);
  assert.deepEqual(built.dropped, ["intensity"]);
  assert.equal(built.dimensions.includes("intensity"), false);
  for (const row of built.rows) {
    for (const value of row) assert.equal(Number.isFinite(value), true);
  }
});

test("an absent dimension is imputed to the axis origin, not to zero", () => {
  // Two assets differ only in tempo, and one has no trustworthy tempo. The one
  // without must sit at the centre of the tempo axis, contributing nothing --
  // not at an extreme, which is what a zero fill would do.
  const tempo = DIMENSIONS.findIndex((dimension) => dimension.name === "tempo");
  const vectors = [flat(1), flat(1), flat(1), flat(1)];
  vectors[0][tempo] = 10;
  vectors[1][tempo] = 20;
  vectors[2][tempo] = 30;
  vectors[3][tempo] = null;

  const built = buildFeatureMatrix(vectors);
  const column = built.dimensions.indexOf("tempo");
  assert.notEqual(column, -1);
  assert.equal(built.rows[3][column], 0);
});

test("imputed counts describe the asset, not the corpus", () => {
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  vectors[2][0] = null;
  vectors[2][1] = null;
  const built = buildFeatureMatrix(vectors);
  assert.deepEqual(built.imputed, [0, 0, 2, 0]);
});

test("an all-absent dimension is dropped rather than imputed everywhere", () => {
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  const column = DIMENSIONS.findIndex((dimension) => dimension.name === "key strength");
  for (const vector of vectors) vector[column] = null;
  assert.equal(buildFeatureMatrix(vectors).dropped.includes("key strength"), true);
});

test("an outlier is clipped rather than allowed to flatten the corpus", () => {
  const vectors = [flat(1), flat(2), flat(3), flat(1e9)];
  const built = buildFeatureMatrix(vectors);
  for (const row of built.rows) {
    for (const value of row) assert.equal(Math.abs(value) <= 4, true);
  }
});

test("the character group is weighted above harmony and timbre", () => {
  // Equal raw spread in each group must not mean equal influence: character has
  // 8 dimensions against 24, so per-group L2 plus a weight is what keeps it heard.
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  const built = buildFeatureMatrix(vectors);
  const norm = (row, group) => Math.hypot(
    ...built.dimensions
      .map((name, index) => [DIMENSIONS.find((d) => d.name === name).group, row[index]])
      .filter(([g]) => g === group)
      .map(([, value]) => value),
  );
  const row = built.rows[0];
  assert.equal(Math.abs(norm(row, "character") - 1.5) < 1e-9, true);
  assert.equal(Math.abs(norm(row, "harmony") - 1) < 1e-9, true);
});

test("an empty corpus produces an empty matrix rather than throwing", () => {
  const built = buildFeatureMatrix([]);
  assert.deepEqual(built.rows, []);
  assert.deepEqual(built.dimensions, []);
});
