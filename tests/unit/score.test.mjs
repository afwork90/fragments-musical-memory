import assert from "node:assert/strict";
import test from "node:test";

import { scoreRelationship, similarityOf } from "../../electron-dist/lib/affinity/score.js";

const WEIGHTS = { rhythm: 54, harmony: 72, timbre: 36 };

/** A relationship with every axis measured, unless overridden. */
function relationship(metrics = {}, extra = {}) {
  return {
    id: "r1",
    source: "a",
    target: "b",
    base: 0.8,
    transformationCost: 0,
    reason: "",
    metrics: {
      rhythm: 0.5,
      harmony: 0.5,
      timbre: 0.5,
      tempo: 0.5,
      pitch: 0.5,
      brightness: 0.5,
      ...metrics,
    },
    ...extra,
  };
}

test("similarity of uniformly similar axes is that similarity, whatever the weights", () => {
  const similarity = similarityOf(relationship(), WEIGHTS, "whole");
  assert.ok(Math.abs(similarity - 0.5) < 1e-12);
});

test("an unmeasured axis is excluded rather than counted as zero", () => {
  // The whole point of nullable metrics: dropping tempo must not move the score,
  // because every remaining axis still reads 0.5. If null were coerced to 0 the
  // similarity would fall instead.
  const measured = similarityOf(relationship(), WEIGHTS, "whole");
  const missingTempo = similarityOf(relationship({ tempo: null }), WEIGHTS, "whole");

  assert.ok(Math.abs(measured - missingTempo) < 1e-12);

  const zeroTempo = similarityOf(relationship({ tempo: 0 }), WEIGHTS, "whole");
  assert.ok(zeroTempo < missingTempo, "a measured zero must cost more than an absent measurement");
});

test("a strong axis still counts when a weak one is merely absent", () => {
  const both = similarityOf(relationship({ harmony: 1, tempo: 0 }), WEIGHTS, "whole");
  const onlyHarmony = similarityOf(relationship({ harmony: 1, tempo: null }), WEIGHTS, "whole");
  assert.ok(onlyHarmony > both);
});

test("nothing measured is null, not zero", () => {
  const nothing = similarityOf(
    relationship({ rhythm: null, harmony: null, timbre: null, tempo: null, pitch: null, brightness: null }),
    WEIGHTS,
    "whole",
  );
  assert.equal(nothing, null);
});

test("context emphasis reweights the steerable axes", () => {
  // Rhythm-heavy audio should rank higher under the rhythm context than the
  // harmony one, given identical metrics.
  const strongRhythm = relationship({ rhythm: 1, harmony: 0 });
  const asRhythm = similarityOf(strongRhythm, WEIGHTS, "rhythm");
  const asHarmony = similarityOf(strongRhythm, WEIGHTS, "harmony");
  assert.ok(asRhythm > asHarmony);
});

test("scores are whole numbers inside 0..99", () => {
  const perfect = scoreRelationship(
    relationship({ rhythm: 1, harmony: 1, timbre: 1, tempo: 1, pitch: 1, brightness: 1 }, { base: 1 }),
    WEIGHTS,
    "whole",
    "reasonable",
  );
  assert.equal(Number.isInteger(perfect), true);
  assert.ok(perfect <= 99 && perfect > 90);

  const floored = scoreRelationship(
    relationship({ rhythm: 0, harmony: 0, timbre: 0, tempo: 0, pitch: 0, brightness: 0 }, { base: 0, transformationCost: 5 }),
    WEIGHTS,
    "whole",
    "reasonable",
  );
  assert.equal(floored, 0, "a heavy transformation penalty must not produce a negative score");
});

test("a relationship with nothing measured scores zero rather than throwing", () => {
  const blind = relationship(
    { rhythm: null, harmony: null, timbre: null, tempo: null, pitch: null, brightness: null },
    { base: 0 },
  );
  assert.equal(scoreRelationship(blind, WEIGHTS, "whole", "reasonable"), 0);
});

test("experimental mode forgives transformation cost", () => {
  const costly = relationship({}, { transformationCost: 0.3 });
  const reasonable = scoreRelationship(costly, WEIGHTS, "whole", "reasonable");
  const experimental = scoreRelationship(costly, WEIGHTS, "whole", "experimental");
  assert.ok(experimental > reasonable);
});
