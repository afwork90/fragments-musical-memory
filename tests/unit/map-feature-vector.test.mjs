import assert from "node:assert/strict";
import test from "node:test";

import { DIMENSIONS, GROUP_WEIGHTS, rawVector } from "../../electron-dist/lib/map/feature-vector.js";

/** A fully measured summary, unless overridden. */
function summary(fields = {}) {
  return {
    bpm: 120,
    bpmConfidence: 3,
    key: "C",
    scale: "major",
    keyStrength: 85,
    centroidHz: 800,
    onsetsPerSecond: 4,
    flatness: 0.2,
    lufs: -14,
    loudnessRange: 6,
    dynamicComplexity: 3,
    intensity: 0,
    leadingSilence: 0,
    trailingSilence: 0,
    chroma: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.05, 0.15],
    timbre: [-700, 40, -12, 8, -4, 3, -2, 1, -1, 0.5, -0.3, 0.2, -0.1],
    origin: "measured",
    extractor: "essentia.js@0.1.3",
    measuredAt: "2026-01-01T00:00:00.000Z",
    ...fields,
  };
}

const indexOf = (name) => DIMENSIONS.findIndex((dimension) => dimension.name === name);

test("there are 32 dimensions in three weighted groups", () => {
  assert.equal(DIMENSIONS.length, 32);
  const counts = { harmony: 0, timbre: 0, character: 0 };
  for (const dimension of DIMENSIONS) counts[dimension.group]++;
  assert.deepEqual(counts, { harmony: 12, timbre: 12, character: 8 });
  assert.deepEqual(GROUP_WEIGHTS, { harmony: 1, timbre: 1, character: 1.5 });
});

test("every dimension name is unique, so the report can name a loading", () => {
  const names = DIMENSIONS.map((dimension) => dimension.name);
  assert.equal(new Set(names).size, names.length);
});

test("a vector is aligned to DIMENSIONS", () => {
  assert.equal(rawVector(summary()).length, DIMENSIONS.length);
});

test("chroma fills the harmony group verbatim", () => {
  const chroma = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.05, 0.15];
  assert.deepEqual(rawVector(summary({ chroma })).slice(0, 12), chroma);
});

test("MFCC coefficient 0 is skipped because it tracks loudness, not timbre", () => {
  const timbre = [-700, 40, -12, 8, -4, 3, -2, 1, -1, 0.5, -0.3, 0.2, -0.1];
  assert.deepEqual(rawVector(summary({ timbre })).slice(12, 24), timbre.slice(1));
});

test("brightness, onset density and tempo are log-scaled", () => {
  const vector = rawVector(summary({ centroidHz: 800, onsetsPerSecond: 4, bpm: 120 }));
  assert.equal(vector[indexOf("brightness")], Math.log2(800));
  assert.equal(vector[indexOf("onset density")], Math.log2(5));
  assert.equal(vector[indexOf("tempo")], Math.log2(120));
});

test("zero onset density survives as a real value", () => {
  // A drone genuinely has no onsets. log2(0) is -Infinity, which is why the
  // transform is log2(1 + x) and not log2(x).
  assert.equal(rawVector(summary({ onsetsPerSecond: 0 }))[indexOf("onset density")], 0);
});

test("a tempo below MIN_BPM_CONFIDENCE reads as not measured", () => {
  // Essentia returns a plausible BPM at confidence 0 for unrhythmic audio. Half
  // the library is like that, and scoring it would be inventing a measurement.
  assert.equal(rawVector(summary({ bpm: 153, bpmConfidence: 0 }))[indexOf("tempo")], null);
});

test("a missing measurement is null, never zero", () => {
  const vector = rawVector(summary({ chroma: null, timbre: null, centroidHz: null, flatness: null, bpm: null }));
  assert.equal(vector.slice(0, 24).every((value) => value === null), true);
  assert.equal(vector[indexOf("brightness")], null);
  assert.equal(vector[indexOf("flatness")], null);
});

test("a short chroma or timbre array is refused rather than padded", () => {
  // Padding would invent pitch classes that were never measured.
  assert.equal(rawVector(summary({ chroma: [0.1, 0.2] })).slice(0, 12).every((v) => v === null), true);
  assert.equal(rawVector(summary({ timbre: [-700, 40] })).slice(12, 24).every((v) => v === null), true);
});

test("loudness and level are excluded: they describe the session, not the music", () => {
  const names = DIMENSIONS.map((dimension) => dimension.name);
  assert.equal(names.includes("loudness"), false);
  assert.equal(names.includes("rms"), false);
  assert.equal(names.includes("duration"), false);
});
