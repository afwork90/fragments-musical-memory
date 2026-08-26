// Cells for the Fracture map: one region per point, together tiling the whole
// plot. Clicking a region is what makes a 14px dot easy to hit, and the shards
// are the app's own metaphor.
//
// This is `.mjs` rather than `.ts` on purpose. `lib/map/*.ts` is compiled to
// CommonJS in `electron-dist/` and loaded by Node, and `d3-delaunay` is
// ESM-only ("type": "module", no `types`), which a `require` of that build
// cannot resolve under `moduleResolution: Node10`. Node 22 happens to allow
// `require(esm)`, but leaning on that would be a runtime-only failure waiting
// for a different Node. Plain ESM sidesteps it: Vite loads this for the
// renderer, the unit tests import it directly, and `allowJs` gives the
// component its types by inference. Same arrangement as `app/map-layout.mjs`.

import { Delaunay } from "d3-delaunay";

/**
 * One polygon per point, clipped to the plot rectangle.
 *
 * A `null` entry means the point has no drawable region. d3 returns that for a
 * genuinely degenerate cell, and the caller must skip it rather than draw an
 * empty path.
 *
 * @param {{ x:number, y:number }[]} points
 * @param {{ width:number, height:number }} bounds
 * @returns {([number,number][] | null)[]}
 */
export function voronoiCells(points, bounds) {
  if (points.length === 0) return [];

  const delaunay = Delaunay.from(points, (point) => point.x, (point) => point.y);
  const voronoi = delaunay.voronoi([0, 0, bounds.width, bounds.height]);

  return points.map((_, index) => {
    const polygon = voronoi.cellPolygon(index);
    // d3 closes the ring by repeating the first vertex. Dropping it keeps the
    // path terse, since `Z` closes it anyway.
    if (!polygon || polygon.length < 4) return null;
    return polygon.slice(0, -1).map(([x, y]) => [x, y]);
  });
}

/**
 * An SVG path for one cell, or `null` if there is nothing to draw.
 *
 * Coordinates are the plot's own, so the caller draws under a `viewBox` and
 * never needs to measure the element.
 *
 * @param {[number,number][] | null} polygon
 * @returns {string | null}
 */
export function cellPath(polygon) {
  if (!polygon || polygon.length < 3) return null;
  const round = (value) => Math.round(value * 100) / 100;
  return `M${polygon.map(([x, y]) => `${round(x)},${round(y)}`).join("L")}Z`;
}
