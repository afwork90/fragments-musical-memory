import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SENSITIVITY,
  SCHEMA_VERSION,
  normalizeSourceDocument,
} from "../../electron-dist/lib/domain/source-document.js";

function rawDocument(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "abc",
    originalName: "take.wav",
    audioFile: "original.wav",
    contentHash: "hash",
    importedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    duration: 12,
    format: "WAV",
    sampleRate: 48000,
    waveform: { version: 1, count: 1, peaks: [4] },
    analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    fragments: [],
    relationships: [],
    ...overrides,
  };
}

test("defaults sourceTypes and sensitivity when absent on disk", () => {
  const document = normalizeSourceDocument(rawDocument());
  assert.deepEqual(document.sourceTypes, []);
  assert.equal(document.sensitivity, DEFAULT_SENSITIVITY);
});

test("preserves sourceTypes and sensitivity when present on disk", () => {
  const document = normalizeSourceDocument(
    rawDocument({ sourceTypes: ["Voice memo"], sensitivity: 68 }),
  );
  assert.deepEqual(document.sourceTypes, ["Voice memo"]);
  assert.equal(document.sensitivity, 68);
});

test("rejects a schema version newer than this build understands", () => {
  assert.throws(
    () => normalizeSourceDocument(rawDocument({ schemaVersion: SCHEMA_VERSION + 1 })),
    /schemaVersion/,
  );
});

test("treats a missing schemaVersion as version 1", () => {
  const raw = rawDocument();
  delete raw.schemaVersion;
  assert.equal(normalizeSourceDocument(raw).schemaVersion, 1);
});

test("defaults a missing fragments array to empty", () => {
  const raw = rawDocument();
  delete raw.fragments;
  assert.deepEqual(normalizeSourceDocument(raw).fragments, []);
});

test("defaults a missing relationships array to empty", () => {
  const raw = rawDocument();
  delete raw.relationships;
  assert.deepEqual(normalizeSourceDocument(raw).relationships, []);
});

test("substitutes an empty analysis when the field is missing or not an object", () => {
  const missing = rawDocument();
  delete missing.analysis;
  assert.deepEqual(normalizeSourceDocument(missing).analysis, {
    bpm: null,
    key: null,
    scale: null,
    keyStrength: null,
  });
  assert.deepEqual(normalizeSourceDocument(rawDocument({ analysis: "nope" })).analysis, {
    bpm: null,
    key: null,
    scale: null,
    keyStrength: null,
  });
});

// Analysis is additively extensible: batch Essentia extraction will add fields,
// and a normalize pass must never silently drop one it does not know about.
test("preserves extra analysis fields it does not model", () => {
  const document = normalizeSourceDocument(
    rawDocument({
      analysis: {
        bpm: 120,
        key: "C",
        scale: "minor",
        keyStrength: 80,
        sonogram: { bands: 2, frames: [[1, 2]] },
        loudness: -14.2,
      },
    }),
  );
  assert.equal(document.analysis.bpm, 120);
  assert.deepEqual(document.analysis.sonogram, { bands: 2, frames: [[1, 2]] });
  assert.equal(document.analysis.loudness, -14.2);
});

test("round-trips analysis provenance", () => {
  const provenance = { origin: "edited", extractor: null, at: "2026-02-02T00:00:00.000Z" };
  const document = normalizeSourceDocument(
    rawDocument({ analysis: { bpm: 90, key: "A", scale: "major", keyStrength: 70, provenance } }),
  );
  assert.deepEqual(document.analysis.provenance, provenance);
});

test("leaves provenance absent when disk has none, rather than inventing one", () => {
  const document = normalizeSourceDocument(rawDocument());
  assert.equal(document.analysis.provenance, undefined);
});

test("rejects a non-object document", () => {
  assert.throws(() => normalizeSourceDocument(null), /must be an object/);
  assert.throws(() => normalizeSourceDocument([]), /must be an object/);
});

// The real library contains hand-placed source folders that never went through
// beginImport, so reads must tolerate documents missing optional fields.
test("normalizes a sparse hand-placed document without throwing", () => {
  const document = normalizeSourceDocument({
    id: "hand-placed",
    originalName: "song1.wav",
    audioFile: "original.wav",
  });
  assert.equal(document.schemaVersion, 1);
  assert.deepEqual(document.fragments, []);
  assert.deepEqual(document.relationships, []);
  assert.deepEqual(document.sourceTypes, []);
  assert.equal(document.sensitivity, DEFAULT_SENSITIVITY);
});
