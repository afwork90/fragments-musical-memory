import assert from "node:assert/strict";
import test from "node:test";

import {
  explainedVariance,
  fitProjection,
  projectAll,
  projectOne,
  topLoadings,
} from "../../electron-dist/lib/map/projection.js";

/** Points spread widely along dimension 0, narrowly along 1, not at all along 2. */
const OBVIOUS = [
  [-10, -1, 5],
  [-5, 1, 5],
  [0, -1, 5],
  [5, 1, 5],
  [10, -1, 5],
];

test("the first component follows the widest direction", () => {
  const basis = fitProjection(OBVIOUS, 2);
  assert.equal(Math.abs(basis.components[0][0]) > 0.9, true);
  assert.equal(Math.abs(basis.components[0][1]) < 0.2, true);
});

test("the mean is the corpus centroid", () => {
  const basis = fitProjection(OBVIOUS, 2);
  assert.equal(basis.mean[0], 0);
  assert.equal(basis.mean[2], 5);
});

test("components are unit length and mutually orthogonal", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const [first, second] = basis.components;
  assert.equal(Math.abs(Math.hypot(...first) - 1) < 1e-6, true);
  assert.equal(Math.abs(Math.hypot(...second) - 1) < 1e-6, true);
  const dot = first.reduce((sum, value, index) => sum + value * second[index], 0);
  assert.equal(Math.abs(dot) < 1e-6, true);
});

test("projecting twice gives byte-identical coordinates", () => {
  // No RNG anywhere. Users navigate by spatial memory, so a layout that moves
  // between runs for no reason is worse than a slightly worse layout.
  const first = projectAll(OBVIOUS, fitProjection(OBVIOUS, 2));
  const second = projectAll(OBVIOUS, fitProjection(OBVIOUS, 2));
  assert.deepEqual(first, second);
});

test("component signs are fixed, so the map cannot mirror itself between runs", () => {
  // An eigenvector's sign is arbitrary. Negating the input must not flip the
  // basis: the largest-magnitude loading is forced positive either way.
  const flipped = OBVIOUS.map((row) => row.map((value) => -value));
  const basis = fitProjection(OBVIOUS, 2);
  const other = fitProjection(flipped, 2);
  const dominant = (component) => component.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
  assert.equal(dominant(basis.components[0]) > 0, true);
  assert.equal(dominant(other.components[0]) > 0, true);
});

test("explained variance is a descending set of ratios summing to at most one", () => {
  const ratios = explainedVariance(fitProjection(OBVIOUS, 3));
  for (let index = 1; index < ratios.length; index++) {
    assert.equal(ratios[index - 1] >= ratios[index], true, `PC${index} should not exceed PC${index - 1}`);
  }
  assert.equal(ratios.reduce((sum, value) => sum + value, 0) <= 1 + 1e-9, true);
  assert.equal(ratios[0] > 0.9, true);
});

test("asking for more components than the data has returns only the real ones", () => {
  // OBVIOUS spreads along two dimensions and holds the third constant, so there
  // is no third direction to find. Returning a zero-variance component would be
  // a fabricated axis, and the map would place points along it.
  assert.equal(fitProjection(OBVIOUS, 3).components.length, 2);
  assert.equal(fitProjection(OBVIOUS, 8).components.length, 2);
});

test("projectOne agrees with projectAll", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const all = projectAll(OBVIOUS, basis);
  assert.deepEqual(projectOne(OBVIOUS[3], basis), all[3]);
});

test("a point at the centroid lands at the origin", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const point = projectOne(basis.mean, basis);
  assert.equal(Math.abs(point.x) < 1e-9, true);
  assert.equal(Math.abs(point.y) < 1e-9, true);
});

test("top loadings name the dimensions driving an axis", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const loadings = topLoadings(basis, ["wide", "narrow", "flat"], 0, 2);
  assert.equal(loadings[0].name, "wide");
  assert.equal(loadings.length, 2);
});

test("a corpus too small to have a direction returns zero coordinates, not NaN", () => {
  const basis = fitProjection([[1, 2, 3]], 2);
  const point = projectOne([1, 2, 3], basis);
  assert.equal(Number.isFinite(point.x), true);
  assert.equal(Number.isFinite(point.y), true);
});

test("an empty corpus does not throw", () => {
  const basis = fitProjection([], 2);
  assert.deepEqual(projectAll([], basis), []);
});
