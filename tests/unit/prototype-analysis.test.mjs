import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const payload = JSON.parse(await readFile(new URL("../../app/prototype-analysis.json", import.meta.url), "utf8"));

test("every seed fragment has a measured summary", () => {
  const ids = Object.keys(payload.fragments);
  assert.equal(ids.length, 28);
  for (let index = 1; index <= 28; index++) {
    assert.equal(ids.includes(`f${String(index).padStart(2, "0")}`), true);
  }
});

test("the summaries carry the two vectors the projection needs", () => {
  for (const [id, summary] of Object.entries(payload.fragments)) {
    assert.equal(summary.chroma?.length, 12, `${id} chroma`);
    assert.equal(summary.timbre?.length, 13, `${id} timbre`);
    assert.equal(typeof summary.centroidHz, "number", `${id} centroid`);
  }
});

test("nothing was invented: every summary says it was measured", () => {
  for (const [id, summary] of Object.entries(payload.fragments)) {
    assert.equal(summary.origin, "measured", `${id} origin`);
  }
});

test("the corpus has real spread, so a projection has something to find", () => {
  // If these all measured the same, the map would be a single point and the
  // problem would be the audio, not the maths.
  const centroids = Object.values(payload.fragments).map((summary) => summary.centroidHz);
  assert.equal(Math.max(...centroids) / Math.min(...centroids) > 1.5, true);
});
