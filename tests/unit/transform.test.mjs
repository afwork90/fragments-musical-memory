import assert from "node:assert/strict";
import test from "node:test";

import {
  describeMatch,
  isAudibleTransform,
  matchTransform,
  renderFileName,
} from "../../electron-dist/lib/affinity/transform.js";
import { tempoSimilarity } from "../../electron-dist/lib/affinity/compare.js";

/** A confidently measured tempo and key, unless overridden. */
function measured(fields = {}) {
  return {
    bpm: 120,
    bpmConfidence: 3,
    key: "C",
    scale: "major",
    keyStrength: 85,
    ...fields,
  };
}

test("matching a tempo is a ratio the candidate can be played at", () => {
  const transform = matchTransform(measured({ bpm: 126 }), measured({ bpm: 120 }));

  assert.equal(transform.tempoRatio, 1.05);
  assert.equal(transform.fromBpm, 120);
  assert.equal(transform.matchedBpm, 126);
  assert.equal(transform.timing, "normal");
});

test("an untrusted tempo yields no ratio rather than a fabricated one", () => {
  const unconfident = measured({ bpmConfidence: 0 });

  assert.equal(matchTransform(measured(), unconfident).tempoRatio, null);
  assert.equal(matchTransform(unconfident, measured()).tempoRatio, null);
  assert.equal(matchTransform(measured(), measured({ bpm: null })).tempoRatio, null);

  // And nothing is claimed about it.
  assert.deepEqual(describeMatch(matchTransform(measured(), unconfident)), []);
});

test("half and double time are reinterpreted, not stretched", () => {
  // 70 against 147: stretching by 2.1 would be destructive, so the pulse is
  // counted double and only the 5% remainder is stretched.
  const doubled = matchTransform(measured({ bpm: 147 }), measured({ bpm: 70 }));
  assert.equal(doubled.timing, "double-time");
  assert.equal(doubled.tempoRatio, 1.05);
  assert.equal(doubled.matchedBpm, 73.5);

  const halved = matchTransform(measured({ bpm: 70 }), measured({ bpm: 147 }));
  assert.equal(halved.timing, "half-time");
  assert.equal(halved.tempoRatio, 0.9524);

  // Whichever interpretation wins, the offered stretch stays within the quality
  // bound, in both directions.
  for (const anchorBpm of [70, 96, 120, 139]) {
    for (const bpm of [40, 63, 70, 88, 100, 110, 120, 126, 137, 147, 180, 220]) {
      const { tempoRatio } = matchTransform(measured({ bpm: anchorBpm }), measured({ bpm }));
      if (tempoRatio === null) continue;
      assert.ok(tempoRatio <= 1.25 && tempoRatio >= 0.8, `${anchorBpm}/${bpm} gave ${tempoRatio}`);
    }
  }
});

test("a stretch past a quarter is refused rather than applied", () => {
  // 40 against 120 is 3:1: the closest doubling still needs a 1.5x stretch, which is
  // a wholesale transformation and not a match. 101 against 140 is the real case in
  // the library, arriving as 39%.
  for (const [anchorBpm, bpm] of [[120, 40], [140, 101], [101, 140]]) {
    const refused = matchTransform(measured({ bpm: anchorBpm }), measured({ bpm }));
    assert.equal(refused.tempoRatio, null, `${anchorBpm} against ${bpm} was matched`);
    assert.equal(refused.matchedBpm, null);
    // The candidate's own tempo was measured, and saying so is what lets the console
    // offer a manual stretch rather than disabling the field.
    assert.equal(refused.fromBpm, bpm);
    assert.deepEqual(describeMatch(refused), []);
  }

  // The other library pair, just inside the bound, is matched.
  const matched = matchTransform(measured({ bpm: 120 }), measured({ bpm: 101 }));
  assert.equal(matched.tempoRatio, 1.1881);
  assert.equal(matched.matchedBpm, 120);
});

test("a tempo relationship the scorer denies can still be adapted", () => {
  // The two bounds are different questions. 101 against 120 scores zero on the
  // tempo axis — they are not at the same tempo — and that is exactly the pair
  // worth offering to stretch.
  const anchor = measured({ bpm: 120 });
  const candidate = measured({ bpm: 101 });

  assert.equal(tempoSimilarity(anchor, candidate), 0);
  assert.notEqual(matchTransform(anchor, candidate).tempoRatio, null);
});

test("pitch matching takes the shortest chromatic path", () => {
  // C up to D is two semitones; C down to A is three, not nine.
  assert.equal(matchTransform(measured({ key: "D" }), measured({ key: "C" })).semitones, 2);
  assert.equal(matchTransform(measured({ key: "A" }), measured({ key: "C" })).semitones, -3);
  assert.equal(matchTransform(measured({ key: "C" }), measured({ key: "C" })).semitones, 0);

  // A tritone is six either way; up is as good an answer as down.
  assert.equal(matchTransform(measured({ key: "F#" }), measured({ key: "C" })).semitones, 6);
});

test("a weak or missing key is not shifted", () => {
  assert.equal(matchTransform(measured(), measured({ keyStrength: 20 })).semitones, null);
  assert.equal(matchTransform(measured({ key: null }), measured()).semitones, null);
  assert.equal(matchTransform(measured({ key: "H" }), measured()).semitones, null);
});

test("a mode clash is reported rather than silently shifted away", () => {
  const clash = matchTransform(measured({ scale: "minor" }), measured({ scale: "major" }));
  assert.equal(clash.sameScale, false);
  assert.equal(clash.semitones, 0);

  assert.equal(matchTransform(measured(), measured()).sameScale, true);
  assert.equal(matchTransform(measured(), measured({ keyStrength: 10 })).sameScale, null);
});

test("labels describe only what was established", () => {
  assert.deepEqual(
    describeMatch(matchTransform(measured({ bpm: 126, key: "A" }), measured())),
    ["+6 BPM", "−3 st"],
  );

  // Same tempo and key: nothing to say.
  assert.deepEqual(describeMatch(matchTransform(measured(), measured())), []);

  assert.deepEqual(
    describeMatch(matchTransform(measured({ bpm: 147 }), measured({ bpm: 70 }))),
    ["2× time", "+4 BPM"],
  );
});

test("an inaudible transform is not worth rendering", () => {
  assert.equal(isAudibleTransform(1, 0), false);
  assert.equal(isAudibleTransform(1.001, 0), false);
  assert.equal(isAudibleTransform(1.05, 0), true);
  assert.equal(isAudibleTransform(1, -3), true);
});

test("render filenames are deterministic, legible, and safe", () => {
  const name = renderFileName("frag-7", 1.5, 3.25, 1.05, -3);

  assert.equal(name, "frag-7_1500-3250_t1050_p-30_v1.wav");
  assert.equal(renderFileName("frag-7", 1.5, 3.25, 1.05, -3), name);
  assert.notEqual(name, renderFileName("frag-7", 1.5, 3.25, 1.06, -3));

  // Nothing a caller supplies can escape the renders directory.
  assert.ok(!renderFileName("../../etc/passwd", 0, 1, 1, 0).includes("/"));
});
