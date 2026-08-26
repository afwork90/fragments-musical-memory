// Projected coordinates become screen coordinates.
//
// The bounds match `MAP_WORLD` in `app/map-layout.mjs` so the two maps share a
// coordinate space and the camera helpers already written there stay applicable.

export type Point = { x: number; y: number };

export type Bounds = { width: number; height: number; padX: number; padY: number };

/**
 * How close two points may be, in screen pixels, before they are separated.
 *
 * Not cosmetic: two dots at the same pixel means one of them cannot be clicked,
 * and when cells arrive, coincident sites produce a degenerate polygon.
 */
const MIN_SEPARATION = 9;

/**
 * How many positions are tried before a point is accepted where it stands.
 *
 * A cap rather than "loop until clear" because clear is not always reachable —
 * push enough points at one spot near a corner and the clamp keeps handing back
 * the same position. A slightly overlapping dot is a cosmetic flaw; a hung
 * render is not.
 */
const MAX_ATTEMPTS = 24;

/** The same hash the existing map uses, so both derive jitter the same way. */
function stableHash(value: string): number {
  return Array.from(value).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

function fit(values: number[], low: number, high: number): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const middle = (low + high) / 2;
  // Every asset agreeing on an axis is a real outcome for a small corpus, and
  // there is no honest place to put them but the middle.
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min === 0) {
    return values.map(() => middle);
  }
  return values.map((value) => low + ((value - min) / (max - min)) * (high - low));
}

export function spreadPoints(points: Point[], ids: string[], bounds: Bounds): Point[] {
  if (points.length === 0) return [];

  const xs = fit(points.map((point) => point.x), bounds.padX, bounds.width - bounds.padX);
  const ys = fit(points.map((point) => point.y), bounds.padY, bounds.height - bounds.padY);

  const clampX = (value: number) => Math.max(bounds.padX, Math.min(bounds.width - bounds.padX, value));
  const clampY = (value: number) => Math.max(bounds.padY, Math.min(bounds.height - bounds.padY, value));

  const placed: Point[] = [];

  for (let index = 0; index < points.length; index++) {
    const home = { x: xs[index], y: ys[index] };
    // Both the direction and the order of attempts come from the id, so the
    // result is the same on every run and does not depend on the order assets
    // arrived in.
    const hash = stableHash(ids[index] ?? String(index));
    let candidate = home;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const clear = placed.every(
        (other) => Math.hypot(candidate.x - other.x, candidate.y - other.y) >= MIN_SEPARATION,
      );
      if (clear) break;

      // A widening spiral: the golden angle spaces successive attempts evenly
      // instead of marching in one direction, and the radius grows so a crowded
      // spot resolves outward rather than stacking along a line.
      const angle = (hash % 360) * (Math.PI / 180) + attempt * 2.399963;
      const radius = MIN_SEPARATION * (1 + attempt * 0.5);
      candidate = {
        x: clampX(home.x + Math.cos(angle) * radius),
        y: clampY(home.y + Math.sin(angle) * radius),
      };
    }

    placed.push(candidate);
  }

  return placed;
}
