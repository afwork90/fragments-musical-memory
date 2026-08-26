import assert from "node:assert/strict";
import test from "node:test";

// Imported straight from source, not from `electron-dist/`: this module is ESM
// because d3-delaunay is, and it is deliberately outside the Electron build.
import { cellPath, voronoiCells } from "../../lib/map/voronoi.mjs";

const BOUNDS = { width: 1280, height: 760 };

/** Shoelace area, for checking the cells tile the plot without gaps. */
function areaOf(polygon) {
  let total = 0;
  for (let index = 0; index < polygon.length; index++) {
    const [x1, y1] = polygon[index];
    const [x2, y2] = polygon[(index + 1) % polygon.length];
    total += x1 * y2 - x2 * y1;
  }
  return Math.abs(total) / 2;
}

/** Ray casting, so we can assert a cell actually contains the point it belongs to. */
function contains(polygon, { x, y }) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [xi, yi] = polygon[index];
    const [xj, yj] = polygon[previous];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const SCATTER = [
  { x: 120, y: 100 }, { x: 900, y: 140 }, { x: 400, y: 380 },
  { x: 1100, y: 600 }, { x: 250, y: 650 }, { x: 700, y: 420 },
  { x: 1000, y: 300 }, { x: 550, y: 90 },
];

test("gives one cell per point", () => {
  const cells = voronoiCells(SCATTER, BOUNDS);
  assert.equal(cells.length, SCATTER.length);
  for (const cell of cells) assert.notEqual(cell, null);
});

test("every cell contains the point it belongs to", () => {
  // The property that makes clicking a cell mean what it looks like it means.
  const cells = voronoiCells(SCATTER, BOUNDS);
  cells.forEach((cell, index) => {
    assert.equal(contains(cell, SCATTER[index]), true, `cell ${index} does not contain its point`);
  });
});

test("the cells tile the whole plot", () => {
  // Border cells are the fiddly part, which is why this uses a library rather
  // than a hand-rolled sweep. If the clip rectangle were ignored the total would
  // come out under or over the plot area.
  const cells = voronoiCells(SCATTER, BOUNDS);
  const total = cells.reduce((sum, cell) => sum + areaOf(cell), 0);
  const expected = BOUNDS.width * BOUNDS.height;
  assert.equal(Math.abs(total - expected) < expected * 0.001, true, `covered ${total} of ${expected}`);
});

test("no cell escapes the plot", () => {
  const cells = voronoiCells(SCATTER, BOUNDS);
  for (const cell of cells) {
    for (const [x, y] of cell) {
      assert.equal(x >= -0.01 && x <= BOUNDS.width + 0.01, true, `x ${x} out of bounds`);
      assert.equal(y >= -0.01 && y <= BOUNDS.height + 0.01, true, `y ${y} out of bounds`);
    }
  }
});

test("a single point takes the whole plot", () => {
  const cells = voronoiCells([{ x: 400, y: 300 }], BOUNDS);
  assert.equal(cells.length, 1);
  assert.equal(Math.abs(areaOf(cells[0]) - BOUNDS.width * BOUNDS.height) < 1, true);
});

test("two points split the plot between them", () => {
  const cells = voronoiCells([{ x: 200, y: 380 }, { x: 1080, y: 380 }], BOUNDS);
  const total = cells.reduce((sum, cell) => sum + areaOf(cell), 0);
  assert.equal(Math.abs(total - BOUNDS.width * BOUNDS.height) < 1, true);
  assert.equal(contains(cells[0], { x: 200, y: 380 }), true);
  assert.equal(contains(cells[1], { x: 1080, y: 380 }), true);
});

test("collinear points still produce cells", () => {
  // Triangulating collinear input degenerates, and the map cannot go blank when
  // the corpus happens to line up on one axis.
  const points = [{ x: 200, y: 380 }, { x: 500, y: 380 }, { x: 800, y: 380 }, { x: 1100, y: 380 }];
  const cells = voronoiCells(points, BOUNDS);
  const total = cells.reduce((sum, cell) => sum + (cell ? areaOf(cell) : 0), 0);
  assert.equal(Math.abs(total - BOUNDS.width * BOUNDS.height) < 1, true);
});

test("an empty corpus produces no cells", () => {
  assert.deepEqual(voronoiCells([], BOUNDS), []);
});

test("computing twice gives the identical answer", () => {
  const first = voronoiCells(SCATTER, BOUNDS).map(cellPath);
  const second = voronoiCells(SCATTER, BOUNDS).map(cellPath);
  assert.deepEqual(first, second);
});

test("a path is closed and starts with a move", () => {
  const path = cellPath([[0, 0], [10, 0], [10, 10]]);
  assert.equal(path.startsWith("M0,0L"), true);
  assert.equal(path.endsWith("Z"), true);
});

test("nothing drawable yields no path rather than an empty one", () => {
  // An empty `d` attribute is a console warning per cell, on every render.
  assert.equal(cellPath(null), null);
  assert.equal(cellPath([[0, 0], [10, 10]]), null);
});
