import assert from "node:assert/strict";
import test from "node:test";

import { measuredSummaryFrom } from "../../electron-dist/lib/domain/measured-summary.js";

test("returns undefined when there is no analysis", () => {
  assert.equal(measuredSummaryFrom(undefined, 10), undefined);
});

test("carries the MFCC means through", () => {
  const timbre = [-700, 40, -12, 8, -4, 3, -2, 1, -1, 0.5, -0.3, 0.2, -0.1];
  assert.deepEqual(measuredSummaryFrom({ timbre }, 10).timbre, timbre);
});

test("an empty MFCC array reads as not measured", () => {
  assert.equal(measuredSummaryFrom({ timbre: [] }, 10).timbre, null);
});

test("onset density divides by the measured window, not the whole duration", () => {
  // FEATURE_MAX_SECONDS is 90: a 180s recording is only measured over its first 90.
  const summary = measuredSummaryFrom({ onsets: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, 180);
  assert.equal(summary.onsetsPerSecond, 9 / 90);
});

test("an empty onset array is a density of zero, not null", () => {
  // Zero onsets is a real measurement -- a drone. Nulling it would let the
  // Fracture map impute it as "unknown" and place the asset at the axis origin.
  assert.equal(measuredSummaryFrom({ onsets: [] }, 10).onsetsPerSecond, 0);
});

test("provenance is flattened and an unknown origin becomes null", () => {
  const summary = measuredSummaryFrom(
    { provenance: { origin: "measured", extractor: "essentia.js@0.1.3", at: "2026-01-01T00:00:00.000Z" } },
    10,
  );
  assert.equal(summary.origin, "measured");
  assert.equal(summary.extractor, "essentia.js@0.1.3");
  assert.equal(measuredSummaryFrom({ provenance: { origin: "guessed" } }, 10).origin, null);
});

test("absent numeric fields become null rather than zero", () => {
  const summary = measuredSummaryFrom({}, 10);
  for (const field of ["bpm", "bpmConfidence", "key", "centroidHz", "flatness", "lufs", "intensity"]) {
    assert.equal(summary[field], null, `${field} should be null`);
  }
});
