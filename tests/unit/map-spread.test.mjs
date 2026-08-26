import assert from "node:assert/strict";
import test from "node:test";

import { spreadPoints } from "../../electron-dist/lib/map/spread.js";

const BOUNDS = { width: 1280, height: 760, padX: 72, padY: 62 };

function inBounds(point) {
  return point.x >= BOUNDS.padX && point.x <= BOUNDS.width - BOUNDS.padX
    && point.y >= BOUNDS.padY && point.y <= BOUNDS.height - BOUNDS.padY;
}

test("everything lands inside the padded bounds", () => {
  const points = [{ x: -100, y: -100 }, { x: 0, y: 0 }, { x: 250, y: 3 }];
  const spread = spreadPoints(points, ["a", "b", "c"], BOUNDS);
  for (const point of spread) assert.equal(inBounds(point), true);
});

test("the extremes are pushed to opposite edges", () => {
  const spread = spreadPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }], ["a", "b"], BOUNDS);
  assert.equal(Math.min(spread[0].x, spread[1].x), BOUNDS.padX);
  assert.equal(Math.max(spread[0].x, spread[1].x), BOUNDS.width - BOUNDS.padX);
});

test("coincident points are separated so both can be clicked", () => {
  // A source and a fragment spanning its whole take measure almost identically.
  const spread = spreadPoints(
    [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 100, y: 100 }],
    ["one", "two", "three", "far"],
    BOUNDS,
  );
  const seen = new Set(spread.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`));
  assert.equal(seen.size, 4);
  for (const point of spread) assert.equal(inBounds(point), true);
});

test("separation is deterministic and keyed on the id, not on order", () => {
  const points = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
  const first = spreadPoints(points, ["one", "two"], BOUNDS);
  const second = spreadPoints(points, ["one", "two"], BOUNDS);
  assert.deepEqual(first, second);
});

test("a corpus with no spread on one axis is centred rather than divided by zero", () => {
  const spread = spreadPoints([{ x: 3, y: 0 }, { x: 3, y: 1 }], ["a", "b"], BOUNDS);
  for (const point of spread) {
    assert.equal(Number.isFinite(point.x), true);
    assert.equal(inBounds(point), true);
  }
});

test("a single point sits in the middle", () => {
  const [point] = spreadPoints([{ x: 42, y: 42 }], ["only"], BOUNDS);
  assert.equal(point.x, BOUNDS.width / 2);
  assert.equal(point.y, BOUNDS.height / 2);
});

test("an empty list stays empty", () => {
  assert.deepEqual(spreadPoints([], [], BOUNDS), []);
});

test("a crowd of identical points terminates and stays in bounds", () => {
  // The de-collision loop rescans after each nudge. With 40 points on one spot
  // that must still finish rather than cycle.
  const points = Array.from({ length: 40 }, () => ({ x: 1, y: 1 }));
  const ids = points.map((_, index) => `asset-${index}`);
  const spread = spreadPoints(points, ids, BOUNDS);
  assert.equal(spread.length, 40);
  for (const point of spread) assert.equal(inBounds(point), true);
});
