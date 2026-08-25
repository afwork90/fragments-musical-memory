import assert from "node:assert/strict";
import test from "node:test";

import {
  brightnessSimilarity,
  compareFragments,
  harmonySimilarity,
  pitchSimilarity,
  rhythmSimilarity,
  tempoSimilarity,
  timbreSimilarity,
} from "../../electron-dist/lib/affinity/compare.js";
import {
  generateRelationships,
  generationSimilarity,
  relationshipIdFor,
  transformationCostFor,
} from "../../electron-dist/lib/affinity/generate.js";

/** A confidently measured analysis, unless overridden. */
function analysis(fields = {}) {
  return {
    bpm: 120,
    bpmConfidence: 3,
    key: "C",
    scale: "major",
    keyStrength: 85,
    chroma: [1, 0, 0.2, 0, 0.6, 0, 0, 0.8, 0, 0, 0.1, 0],
    timbre: [-700, 40, -12, 8, -4, 3, -2, 1, -1, 0.5, -0.3, 0.2, -0.1],
    centroidHz: 900,
    onsets: [0, 0.5, 1, 1.5],
    featureSampleRate: 22050,
    ...fields,
  };
}

function fragment(id, sourceId, fields = {}, measuredSeconds = 2) {
  return { id, sourceId, measuredSeconds, analysis: analysis(fields) };
}

test("an unconfident tempo is not compared at all", () => {
  const confident = analysis();
  const unconfident = analysis({ bpmConfidence: 0 });

  assert.equal(tempoSimilarity(confident, confident), 1);
  assert.equal(tempoSimilarity(confident, unconfident), null);
  assert.equal(tempoSimilarity(unconfident, unconfident), null);
});

test("half and double time are the same pulse", () => {
  const slow = analysis({ bpm: 70 });
  const fast = analysis({ bpm: 140 });
  assert.equal(tempoSimilarity(slow, fast), 1);

  // A tempo that is neither close nor a clean ratio is not a match.
  assert.equal(tempoSimilarity(analysis({ bpm: 100 }), analysis({ bpm: 137 })), 0);
});

test("key similarity follows the circle of fifths", () => {
  const cMajor = analysis({ key: "C", scale: "major" });
  const gMajor = analysis({ key: "G", scale: "major" });
  const fsMajor = analysis({ key: "F#", scale: "major" });
  const aMinor = analysis({ key: "A", scale: "minor" });

  assert.equal(pitchSimilarity(cMajor, cMajor), 1);
  // Relative minor outranks the neighbouring fifth.
  assert.ok(pitchSimilarity(cMajor, aMinor) > pitchSimilarity(cMajor, gMajor));
  assert.ok(pitchSimilarity(cMajor, gMajor) > pitchSimilarity(cMajor, fsMajor));
});

test("enharmonic spellings are the same key", () => {
  assert.equal(pitchSimilarity(analysis({ key: "C#" }), analysis({ key: "Db" })), 1);
});

test("a weakly detected key is not compared", () => {
  const weak = analysis({ keyStrength: 10 });
  assert.equal(pitchSimilarity(weak, analysis()), null);
  assert.equal(pitchSimilarity(analysis({ key: null }), analysis()), null);
});

test("harmony compares chroma and ignores overall level", () => {
  const quiet = analysis({ chroma: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  const loud = analysis({ chroma: [8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  // Cosine similarity is scale-invariant: same notes, different level, same result.
  assert.ok(Math.abs(harmonySimilarity(quiet, loud) - 1) < 1e-12);

  const other = analysis({ chroma: [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  assert.equal(harmonySimilarity(quiet, other), 0);
});

test("silence has no harmony to compare", () => {
  const silent = analysis({ chroma: new Array(12).fill(0) });
  assert.equal(harmonySimilarity(silent, analysis()), null);
});

test("timbre ignores the loudness coefficient", () => {
  // Coefficient 0 differs wildly; the rest are identical. Skipping it is what makes
  // these read as the same timbre rather than as different recordings.
  const quiet = analysis({ timbre: [-900, 40, -12, 8, -4, 3, -2, 1, -1, 0.5, -0.3, 0.2, -0.1] });
  const loud = analysis({ timbre: [-100, 40, -12, 8, -4, 3, -2, 1, -1, 0.5, -0.3, 0.2, -0.1] });
  assert.ok(timbreSimilarity(quiet, loud) > 0.999);
});

test("brightness is compared in octaves", () => {
  assert.equal(brightnessSimilarity(analysis({ centroidHz: 800 }), analysis({ centroidHz: 800 })), 1);
  // One octave apart, over a two-octave tolerance, is half.
  assert.ok(Math.abs(brightnessSimilarity(analysis({ centroidHz: 400 }), analysis({ centroidHz: 800 })) - 0.5) < 1e-9);
  // Two octaves is the floor.
  assert.equal(brightnessSimilarity(analysis({ centroidHz: 200 }), analysis({ centroidHz: 800 })), 0);
});

test("two fragments with no onsets are rhythmically alike, not unmeasured", () => {
  const pad = fragment("a", "s1", { onsets: [] });
  const otherPad = fragment("b", "s2", { onsets: [] });
  const busy = fragment("c", "s3", { onsets: [0, 0.1, 0.2, 0.3, 0.4, 0.5] });

  assert.equal(rhythmSimilarity(pad, otherPad), 1);
  assert.equal(rhythmSimilarity(pad, busy), 0);
  // Absent onsets are a different thing from an empty list.
  assert.equal(rhythmSimilarity(fragment("d", "s4", { onsets: null }), busy), null);
});

test("identical audio compares as identical on every axis", () => {
  const metrics = compareFragments(fragment("a", "s1"), fragment("b", "s2"));
  for (const [axis, score] of Object.entries(metrics)) {
    assert.ok(score !== null, `${axis} should be measured`);
    assert.ok(score > 0.999, `${axis} should be ~1, got ${score}`);
  }
});

test("generation refuses to judge a pair on a single axis", () => {
  const onlyBrightness = {
    rhythm: null, harmony: null, timbre: null, tempo: null, pitch: null, brightness: 1,
  };
  assert.equal(generationSimilarity(onlyBrightness), null);

  const two = { ...onlyBrightness, harmony: 1 };
  assert.equal(generationSimilarity(two), 1);
});

test("transformation cost counts only what a user would have to change", () => {
  const free = { rhythm: 0, harmony: 0, timbre: 0, tempo: 1, pitch: 1, brightness: 0 };
  assert.equal(transformationCostFor(free), 0);

  // A timbre mismatch is the point of a match, not a cost.
  const timbreDiffers = { ...free, timbre: 0 };
  assert.equal(transformationCostFor(timbreDiffers), 0);

  const stretchNeeded = { ...free, tempo: 0 };
  assert.ok(transformationCostFor(stretchNeeded) > 0);
});

test("relationship ids do not depend on pair order", () => {
  assert.equal(relationshipIdFor("b", "a"), relationshipIdFor("a", "b"));
});

test("fragments of the same source are never related to each other", () => {
  const sameSource = [fragment("a", "s1"), fragment("b", "s1"), fragment("c", "s1")];
  assert.deepEqual(generateRelationships(sameSource), []);
});

test("generation is deterministic regardless of input order", () => {
  const fragments = [
    fragment("a", "s1"),
    fragment("b", "s2", { key: "G" }),
    fragment("c", "s3", { centroidHz: 500 }),
  ];
  const forward = generateRelationships(fragments);
  const reversed = generateRelationships([...fragments].reverse());

  assert.deepEqual(forward, reversed);
  assert.ok(forward.length > 0);
});

test("the per-fragment cap trims without starving a fragment", () => {
  // Ten mutually similar fragments, each in its own source, capped at two apiece.
  const fragments = Array.from({ length: 10 }, (_, i) => fragment(`f${i}`, `s${i}`));
  const capped = generateRelationships(fragments, { maxPerFragment: 2 });

  const counts = new Map();
  for (const relationship of capped) {
    for (const id of [relationship.source, relationship.target]) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  for (const id of fragments.map((f) => f.id)) {
    assert.ok((counts.get(id) ?? 0) > 0, `${id} should keep at least one relationship`);
  }
  assert.ok(capped.length < 45, "the cap should trim the complete graph");
});

test("generated relationships carry the shape the library expects", () => {
  const [relationship] = generateRelationships([fragment("a", "s1"), fragment("b", "s2")]);

  assert.equal(relationship.origin, "algorithmic");
  assert.notEqual(relationship.source, relationship.target);
  assert.ok(relationship.base > 0 && relationship.base <= 1);
  assert.ok(relationship.reason.length > 0);
});

test("the reason names what was measured and what was not", () => {
  const [relationship] = generateRelationships([
    fragment("a", "s1", { bpmConfidence: 0 }),
    fragment("b", "s2", { bpmConfidence: 0 }),
  ]);
  assert.match(relationship.reason, /Not measured: tempo/);
});
