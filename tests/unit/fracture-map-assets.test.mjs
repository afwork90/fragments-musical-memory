import assert from "node:assert/strict";
import test from "node:test";

import { WHOLE_TAKE_RATIO, collapseWholeTakes } from "../../electron-dist/lib/map/collapse.js";

function asset(id, kind, duration, sourceId) {
  return { id, kind, duration, sourceId, label: id, analysis: {} };
}

test("a fragment spanning its whole source replaces that source", () => {
  // Two library sources are exactly this, and all 28 seed files will be once
  // they become source documents. Two points on the same audio is a redundant
  // cell and an unclickable dot.
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 10, "s1"),
    asset("s1-whole", "fragment", 10, "s1"),
  ]);
  assert.deepEqual(kept.map((entry) => entry.id), ["s1-whole"]);
});

test("the fragment is kept, not the source", () => {
  // Affinities, transforms and renders all attach to fragments.
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 10, "s1"),
    asset("s1-whole", "fragment", 10, "s1"),
  ]);
  assert.equal(kept[0].kind, "fragment");
});

test("a source cut into real fragments keeps its own point", () => {
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 100, "s1"),
    asset("s1-a", "fragment", 30, "s1"),
    asset("s1-b", "fragment", 40, "s1"),
  ]);
  assert.deepEqual(kept.map((entry) => entry.id).sort(), ["s1-a", "s1-b", "source:s1"]);
});

test("the threshold is a ratio, not an exact match", () => {
  // A fragment trimmed of a little silence is still the whole take.
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 100, "s1"),
    asset("s1-whole", "fragment", 100 * WHOLE_TAKE_RATIO, "s1"),
  ]);
  assert.deepEqual(kept.map((entry) => entry.id), ["s1-whole"]);
});

test("a fragment just under the threshold does not collapse its source", () => {
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 100, "s1"),
    asset("s1-most", "fragment", 90, "s1"),
  ]);
  assert.equal(kept.length, 2);
});

test("one source collapsing does not affect another", () => {
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 10, "s1"),
    asset("s1-whole", "fragment", 10, "s1"),
    asset("source:s2", "source", 100, "s2"),
    asset("s2-a", "fragment", 20, "s2"),
  ]);
  assert.deepEqual(kept.map((entry) => entry.id).sort(), ["s1-whole", "s2-a", "source:s2"]);
});

test("a zero-duration source is never collapsed away", () => {
  // Dividing by it would be a NaN comparison, which is always false, but relying
  // on that is not a decision.
  const kept = collapseWholeTakes([
    asset("source:s1", "source", 0, "s1"),
    asset("s1-whole", "fragment", 0, "s1"),
  ]);
  assert.equal(kept.length, 2);
});

test("a fragment with no source in the list is kept", () => {
  // The seed fragments have no source asset at all until the library-ready
  // documents are installed.
  const kept = collapseWholeTakes([asset("f01", "fragment", 6, "seed:f01")]);
  assert.deepEqual(kept.map((entry) => entry.id), ["f01"]);
});
