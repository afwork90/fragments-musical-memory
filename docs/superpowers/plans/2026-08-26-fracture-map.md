# Fracture Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second map tab where every audio asset in the library is a clickable, playable point positioned by a PCA of its measured audio features, instead of by the existing map's hand-written role table.

**Architecture:** Four pure modules under `lib/map/` turn a `MeasuredSummary` into a 32-dimension feature vector, scale the corpus robustly, project it to two dimensions with a hand-rolled PCA, and lay the result out in screen space. A Node script measures the 28 bundled seed WAVs with the real extractor so seed and library assets travel one code path. A new `app/features/fracture-map/` component renders the scatter and reuses the app's existing centralized playback handlers.

**Tech Stack:** TypeScript 5.9, React 19, Vite (vinext), Electron 43, essentia.js 0.1.3 for the offline seed measurement, `node --test` for unit tests. **No new npm dependencies** — PCA is hand-rolled.

## Global Constraints

- `npm run check` (typecheck + lint + unit tests) must pass at the end of every task, and must stay fast.
- Modules under `lib/map/` and `lib/domain/` are compiled twice (by `tsc -p electron/tsconfig.json` into `electron-dist/`, and by Vite into the renderer). Therefore: **relative specifiers, never the `@/` alias**; **no file extensions** in relative imports; **no `node:*` imports**; **no DOM globals**. Neither typecheck nor lint catches these — the unit tests, which import from `electron-dist/`, do.
- **`electron/tsconfig.json` has an explicit `include` list, and `lib/map/` is a new directory.** Add `"../lib/map/**/*.ts"` to it beside `../lib/affinity/**/*.ts` before running any test that imports from `electron-dist/lib/map/`. Without it the build silently emits nothing for the directory and every test fails with "cannot find module", which looks like a missing file rather than a missing config line. Done as part of Task 2.
- Inside `app/`, the `@/` alias is normal and correct. Inside `electron/`, keep the `.js` suffix.
- No `any` and no `@ts-nocheck` anywhere in `app/`, `lib/`, `electron/`, `types/`. At an untrusted boundary take `unknown` and narrow.
- **No invented data.** If a measurement is absent, it is `null` and renders `—`. Never synthesise a plausible value.
- **Never write seed display data to a `source.json`.** Measured values are fine; the seed fragments' hand-written names, keys, BPMs and roles are not.
- Unit-test pure modules only. **No component tests, no hook tests, no assertions on the text of source files.**
- UI copy addresses whoever is using the app. No npm commands, script names, or file paths in the interface.
- Tests import from `electron-dist/`, so `npm run build:electron` must run before them. `npm run test:unit` already does this; do not optimise it away.
- Commit after every task.

## Correction to the spec

`docs/superpowers/specs/2026-08-26-fracture-map-design.md` section 8 calls for extracting a `usePreviewScope` hook, citing the `AGENTS.md` rule that the preview machinery is inlined in three components and a fourth requires extraction first. **That extraction is not needed and is not in this plan.**

The rule targets components that build their own `new Audio()` element. The Fracture map does not: it renders inside `FragmentsApp` and receives the existing centralized handlers as props, exactly as `LibraryView` already does at `app/fragments-app.tsx:1254-1257` (`onPreviewFragment={previewSingle}`, `onPreviewSource={previewSource}`, `previewingId`, `previewProgress`) and `SourcesView` does at lines 1314-1315. Reusing one state machine through props is the opposite of a fourth inlining.

Task 10 wires those props. If a future standalone map window needs its own audio element, the extraction becomes real then.

## Refinement to the spec

Spec section 2 says the script emits `app/prototype-sources.json` as an array of `SourceDocument`s for the renderer to import. It cannot be used directly that way: a `SourceDocument` carries `MeasuredAnalysis` (disk shape, with an `onsets` array), while the renderer and the map need `MeasuredSummary` (view shape, with `onsetsPerSecond`), and the converter has to run somewhere.

Task 1 solves this properly by moving the converter to one definition site that all three consumers can reach. The script therefore emits **two** artifacts:

- `public/audio/library-ready/<uuid>/source.json` — valid `SourceDocument`s, for moving into the library.
- `app/prototype-analysis.json` — `Record<seedFragmentId, MeasuredSummary>`, for the renderer.

## File Structure

**New pure modules (dually compiled):**

| File | Responsibility |
|---|---|
| `lib/domain/measured-summary.ts` | The one `MeasuredAnalysis` → `MeasuredSummary` converter |
| `lib/map/asset.ts` | The `MapAsset` type |
| `lib/map/feature-vector.ts` | One asset → 32 raw dimensions, with names and groups |
| `lib/map/matrix.ts` | Corpus-wide robust scaling, imputation, zero-IQR drop |
| `lib/map/projection.ts` | PCA fit, project, top loadings |
| `lib/map/spread.ts` | Projected coordinates → screen coordinates, de-collided |

**New app modules:**

| File | Responsibility |
|---|---|
| `app/features/fracture-map/fracture-map-assets.ts` | Build `MapAsset[]` from view types; whole-take collapse; the one seed fallback |
| `app/features/fracture-map/fracture-map-view.tsx` | The scatter, axis captions, selection, inspector slot |

**New scripts:**

| File | Responsibility |
|---|---|
| `scripts/compute-prototype-sources.mjs` | Measure the 28 seed WAVs; emit both artifacts |
| `scripts/fracture-report.mjs` | Verification report over the real library |

**Modified:**

| File | Change |
|---|---|
| `lib/view/analysis.ts` | `+ timbre?: number[] \| null`, amended comment |
| `app/fragments-app.tsx` | Delete local `measuredSummaryFrom`, import it; `View` union; nav button; render block; selection state |
| `app/prototype-data.ts` | `+ SEED_ANALYSIS` export |
| `app/globals.css` | `+ .fracture-*` rules |
| `package.json` | `+ seed-docs`, `+ fracture` scripts |

---

### Task 1: One definition site for `measuredSummaryFrom`, and `timbre` on the summary

Three consumers now need the disk→view conversion: the renderer, the seed script, and the report script. It currently lives as a private function in `app/fragments-app.tsx`, which a Node script cannot import. Move it, and add the one field the map needs.

**Files:**
- Create: `lib/domain/measured-summary.ts`
- Modify: `lib/view/analysis.ts`
- Modify: `app/fragments-app.tsx` (delete lines 108-147, add an import)
- Test: `tests/unit/measured-summary.test.mjs`

**Interfaces:**
- Consumes: `MeasuredAnalysis` from `lib/domain/source-document`, `MeasuredSummary` from `lib/view/analysis`, `FEATURE_MAX_SECONDS` from `lib/analysis/features`.
- Produces: `measuredSummaryFrom(analysis: MeasuredAnalysis | undefined, seconds: number): MeasuredSummary | undefined`. `MeasuredSummary` gains `timbre: number[] | null`.

- [ ] **Step 1: Add `timbre` to the view type**

In `lib/view/analysis.ts`, amend the file's header comment. It currently reads:

```ts
// A pure type with no imports, like the rest of `lib/view/`. It mirrors the subset
// of `MeasuredAnalysis` worth showing a person, and that subset is smaller than
// what the scorer uses: the 13 MFCC means are a direction in a space with no names
// for its axes, so there is no honest way to print them. Chroma survives because a
// bar per pitch class is readable as a shape even unlabelled.
```

Replace the MFCC sentence so it explains why the field is carried but never printed:

```ts
// A pure type with no imports, like the rest of `lib/view/`. It mirrors the subset
// of `MeasuredAnalysis` worth showing a person. The 13 MFCC means are a direction
// in a space with no names for its axes, so nothing prints them — but the Fracture
// map projects them, which is why they are carried here. Chroma survives because a
// bar per pitch class is readable as a shape even unlabelled.
```

Then add the field immediately after `chroma`:

```ts
  /** The 12 pitch classes starting at A, averaged over frames. Drawn, not read. */
  chroma: number[] | null;
  /**
   * The 13 MFCC means. Never displayed — see the note at the top of this file —
   * but projected by the Fracture map, which is the only reason it is here.
   */
  timbre: number[] | null;
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/measured-summary.test.mjs`:

```js
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
```

Note the fifth test: the existing implementation returns `null` for an empty onset array because `analysis.onsets && ...` is truthy but the guard is on `measuredSeconds > 0`. Re-read it — `[]` is truthy, so `0 / 10 = 0` is returned. The test asserts the correct behaviour and should pass; if it fails, the move introduced a regression.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run build:electron && node --test tests/unit/measured-summary.test.mjs`
Expected: FAIL — `Cannot find module '.../electron-dist/lib/domain/measured-summary.js'`

- [ ] **Step 4: Create the module**

Create `lib/domain/measured-summary.ts`. This is the body currently at `app/fragments-app.tsx:117-147`, moved verbatim except for the added `timbre` line:

```ts
// The one place a disk-shaped `MeasuredAnalysis` becomes a display-shaped
// `MeasuredSummary`.
//
// It lives here rather than in the renderer because three callers need it: the app,
// `scripts/compute-prototype-sources.mjs`, and `scripts/fracture-report.mjs`. A
// Node script cannot import from a `.tsx` file, and a second copy of this mapping
// is how two views of one fragment start disagreeing.

import { FEATURE_MAX_SECONDS } from "../analysis/features";
import type { MeasuredSummary } from "../view/analysis";
import type { MeasuredAnalysis } from "./source-document";

/**
 * The measured fields worth showing a person, straight off the document.
 *
 * `seconds` is what the measurements cover, which is the shorter of the audio and
 * the analysis window — onset density is meaningless against the wrong denominator,
 * and it must match what `rhythmSimilarity` divided by or the panel would disagree
 * with the affinities it explains.
 */
export function measuredSummaryFrom(
  analysis: MeasuredAnalysis | undefined,
  seconds: number,
): MeasuredSummary | undefined {
  if (!analysis) return undefined;

  const measuredSeconds = Math.min(seconds, FEATURE_MAX_SECONDS);
  const origin = analysis.provenance?.origin;
  return {
    bpm: analysis.bpm ?? null,
    bpmConfidence: analysis.bpmConfidence ?? null,
    key: analysis.key ?? null,
    scale: analysis.scale ?? null,
    keyStrength: analysis.keyStrength ?? null,
    centroidHz: analysis.centroidHz ?? null,
    onsetsPerSecond: analysis.onsets && measuredSeconds > 0
      ? analysis.onsets.length / measuredSeconds
      : null,
    flatness: analysis.flatness ?? null,
    lufs: analysis.lufs ?? null,
    loudnessRange: analysis.loudnessRange ?? null,
    dynamicComplexity: analysis.dynamicComplexity ?? null,
    intensity: analysis.intensity ?? null,
    leadingSilence: analysis.leadingSilence ?? null,
    trailingSilence: analysis.trailingSilence ?? null,
    chroma: analysis.chroma?.length ? analysis.chroma : null,
    timbre: analysis.timbre?.length ? analysis.timbre : null,
    origin: origin === "measured" || origin === "edited" ? origin : null,
    extractor: analysis.provenance?.extractor ?? null,
    measuredAt: analysis.provenance?.at ?? null,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build:electron && node --test tests/unit/measured-summary.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 6: Point the renderer at the moved function**

In `app/fragments-app.tsx`, delete the whole block from the comment at line 109 (`/**` above `measuredSummaryFrom`) through the closing brace at line 147, leaving the `/** Rebuilds an in-memory Fragment... */` comment on line 108 attached to `fragmentFromDocument`. Add to the imports:

```ts
import { measuredSummaryFrom } from "@/lib/domain/measured-summary";
```

If `FEATURE_MAX_SECONDS` and `MeasuredSummary` are now unused in that file, remove them from their import statements — lint will say so.

- [ ] **Step 7: Verify nothing regressed**

Run: `npm run check`
Expected: PASS. The typechecker will flag every place a `MeasuredSummary` object literal is built without the new required `timbre` field. There should be exactly one such place (the moved function). If there are others, add `timbre: null` — do not make the field optional, because an optional field is how a caller silently forgets it.

- [ ] **Step 8: Commit**

```bash
git add lib/domain/measured-summary.ts lib/view/analysis.ts app/fragments-app.tsx tests/unit/measured-summary.test.mjs
git commit -m "Move measuredSummaryFrom to lib/domain and carry MFCC means

Two Node scripts need the disk-to-view conversion and cannot import a .tsx
file. The MFCC means are already persisted on every fragment; the view type
dropped them, which is the only thing that kept them from the renderer."
```

---

### Task 2: The feature vector

One asset's `MeasuredSummary` becomes 32 raw numbers, some of which may be `null`. No scaling here — that is corpus-wide and belongs in Task 3.

**Files:**
- Create: `lib/map/asset.ts`
- Create: `lib/map/feature-vector.ts`
- Test: `tests/unit/map-feature-vector.test.mjs`

**Interfaces:**
- Consumes: `MeasuredSummary` from `lib/view/analysis`, `MIN_BPM_CONFIDENCE` from `lib/analysis/features`.
- Produces:
  - `type MapAsset = { id: string; label: string; kind: "source" | "fragment"; analysis: MeasuredSummary; duration: number }`
  - `type DimensionGroup = "harmony" | "timbre" | "character"`
  - `const GROUP_WEIGHTS: Record<DimensionGroup, number>`
  - `const DIMENSIONS: readonly { name: string; group: DimensionGroup }[]` — length 32
  - `function rawVector(analysis: MeasuredSummary): (number | null)[]` — length 32, aligned to `DIMENSIONS`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/map-feature-vector.test.mjs`:

```js
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
  const at = (name) => vector[DIMENSIONS.findIndex((dimension) => dimension.name === name)];
  assert.equal(at("brightness"), Math.log2(800));
  assert.equal(at("onset density"), Math.log2(5));
  assert.equal(at("tempo"), Math.log2(120));
});

test("zero onset density survives as a real value", () => {
  // A drone genuinely has no onsets. log2(0) is -Infinity, which is why the
  // transform is log2(1 + x) and not log2(x).
  const vector = rawVector(summary({ onsetsPerSecond: 0 }));
  assert.equal(vector[DIMENSIONS.findIndex((d) => d.name === "onset density")], 0);
});

test("a tempo below MIN_BPM_CONFIDENCE reads as not measured", () => {
  // Essentia returns a plausible BPM at confidence 0 for unrhythmic audio. Half
  // the library is like that, and scoring it would be inventing a measurement.
  const vector = rawVector(summary({ bpm: 153, bpmConfidence: 0 }));
  assert.equal(vector[DIMENSIONS.findIndex((d) => d.name === "tempo")], null);
});

test("a missing measurement is null, never zero", () => {
  const vector = rawVector(summary({ chroma: null, timbre: null, centroidHz: null, flatness: null, bpm: null }));
  assert.equal(vector.slice(0, 24).every((value) => value === null), true);
  assert.equal(vector[DIMENSIONS.findIndex((d) => d.name === "brightness")], null);
  assert.equal(vector[DIMENSIONS.findIndex((d) => d.name === "flatness")], null);
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build:electron && node --test tests/unit/map-feature-vector.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/map/asset.ts`**

```ts
// What the Fracture map plots. A source and a fragment are the same kind of thing
// here — both are audio, both are measured, both are playable.

import type { MeasuredSummary } from "../view/analysis";

export type MapAsset = {
  /**
   * A `PreviewScope` id: a fragment id, or `source:<id>`. Playback keys on this,
   * never on a fragment id, which is what lets one selection mean either.
   */
  id: string;
  label: string;
  /**
   * Only ever used to pick a `PreviewScope` builder. It must not affect position
   * or appearance: this map treats sources and fragments without distinction.
   */
  kind: "source" | "fragment";
  analysis: MeasuredSummary;
  /**
   * Seconds. Carried for labelling only. Deliberately not a feature — how long a
   * fragment is is not a property of how it sounds.
   */
  duration: number;
};
```

- [ ] **Step 4: Create `lib/map/feature-vector.ts`**

```ts
// One asset's measurements as 32 raw numbers, some of which may be absent.
//
// Grouping is not cosmetic. Harmony and timbre contribute 24 dimensions between
// them and character only 8, so without per-group normalisation and a weight,
// timbre silently decides every position and the character of the playing
// contributes almost nothing.

import { MIN_BPM_CONFIDENCE } from "../analysis/features";
import type { MeasuredSummary } from "../view/analysis";

export type DimensionGroup = "harmony" | "timbre" | "character";

export const GROUP_WEIGHTS: Record<DimensionGroup, number> = {
  harmony: 1,
  timbre: 1,
  character: 1.5,
};

const CHROMA_BINS = 12;
/** MFCC means, minus coefficient 0. */
const TIMBRE_COEFFICIENTS = 12;

/** Chroma starts at A, matching what `HPCP` writes and what `MeasuredSummary` documents. */
const PITCH_CLASSES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];

export const DIMENSIONS: readonly { name: string; group: DimensionGroup }[] = [
  ...PITCH_CLASSES.map((pitch) => ({ name: `chroma ${pitch}`, group: "harmony" as const })),
  ...Array.from({ length: TIMBRE_COEFFICIENTS }, (_, index) => ({
    // Named by their real coefficient number, which starts at 1 here.
    name: `mfcc ${index + 1}`,
    group: "timbre" as const,
  })),
  { name: "brightness", group: "character" },
  { name: "flatness", group: "character" },
  { name: "dynamics", group: "character" },
  { name: "onset density", group: "character" },
  { name: "tempo", group: "character" },
  { name: "key strength", group: "character" },
  { name: "intensity", group: "character" },
  { name: "loudness range", group: "character" },
];

/** Positive-only quantities are compared ratiometrically, so they enter as logs. */
function logOf(value: number | null): number | null {
  return value === null || value <= 0 ? null : Math.log2(value);
}

/**
 * A vector of exactly one number or `null` per entry in `DIMENSIONS`.
 *
 * `null` means not measured. It is never a zero: zero flatness is a pure tone and
 * zero onsets is a drone, both of which are findings, and conflating them with
 * "we do not know" is the mistake this whole slice is built to avoid.
 */
export function rawVector(analysis: MeasuredSummary): (number | null)[] {
  // Short vectors are refused rather than padded. A 2-bin chroma is a bug
  // upstream, and padding it would invent ten pitch classes.
  const chroma = analysis.chroma?.length === CHROMA_BINS ? analysis.chroma : null;
  const timbre = analysis.timbre?.length === TIMBRE_COEFFICIENTS + 1 ? analysis.timbre : null;

  // Essentia returns a plausible tempo at confidence 0 for short or unrhythmic
  // audio, which is 13 of the library's 25 fragments. The same gate
  // `tempoSimilarity` applies, imported rather than mirrored.
  const trustedBpm = analysis.bpm !== null && (analysis.bpmConfidence ?? 0) >= MIN_BPM_CONFIDENCE
    ? analysis.bpm
    : null;

  const onsets = analysis.onsetsPerSecond;

  return [
    ...Array.from({ length: CHROMA_BINS }, (_, index) => chroma?.[index] ?? null),
    // Coefficient 0 tracks loudness rather than timbre — across this library it
    // runs about -600 to -870 while every other coefficient is inside +-200.
    ...Array.from({ length: TIMBRE_COEFFICIENTS }, (_, index) => timbre?.[index + 1] ?? null),
    logOf(analysis.centroidHz),
    analysis.flatness,
    analysis.dynamicComplexity,
    // log2(1 + x), not log2(x): eight library fragments have no onsets at all, and
    // that is a measurement, so it must survive as 0 rather than become -Infinity.
    onsets === null ? null : Math.log2(1 + onsets),
    logOf(trustedBpm),
    analysis.keyStrength,
    analysis.intensity,
    analysis.loudnessRange,
  ];
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run build:electron && node --test tests/unit/map-feature-vector.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/map/asset.ts lib/map/feature-vector.ts tests/unit/map-feature-vector.test.mjs
git commit -m "Add the Fracture map feature vector

32 dimensions in three weighted groups. Absent measurements stay null so the
matrix can impute them to the axis origin; zero onset density is a drone and
survives as a real value."
```

---

### Task 3: Corpus scaling

Turn a list of raw vectors into a numeric matrix PCA can take: robustly scaled, imputed, with dead dimensions removed.

**Files:**
- Create: `lib/map/matrix.ts`
- Test: `tests/unit/map-matrix.test.mjs`

**Interfaces:**
- Consumes: `DIMENSIONS`, `GROUP_WEIGHTS`, `DimensionGroup` from `lib/map/feature-vector`.
- Produces:
  - `type FeatureMatrix = { rows: number[][]; dimensions: string[]; dropped: string[]; imputed: number[] }`
  - `function buildFeatureMatrix(vectors: (number | null)[][]): FeatureMatrix`
  - `function median(values: number[]): number` (exported for the report)

`rows[i]` has one entry per `dimensions[j]`. `imputed[i]` counts how many of asset `i`'s dimensions were absent, counted before any dropping, so it reflects the asset and not the corpus.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/map-matrix.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { DIMENSIONS } from "../../electron-dist/lib/map/feature-vector.js";
import { buildFeatureMatrix, median } from "../../electron-dist/lib/map/matrix.js";

/** A vector where every dimension holds the same value, so tests can vary one. */
function flat(value) {
  return DIMENSIONS.map(() => value);
}

test("median of an even-length list averages the middle pair", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

test("rows line up with the surviving dimensions", () => {
  const built = buildFeatureMatrix([flat(1), flat(2), flat(3), flat(4)]);
  for (const row of built.rows) assert.equal(row.length, built.dimensions.length);
});

test("a dimension with no spread is dropped, not divided by", () => {
  // intensity is -1/0/1, so a corpus that agrees on it has an IQR of 0. Dividing
  // would put Infinity or NaN through every row.
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  const intensity = DIMENSIONS.findIndex((dimension) => dimension.name === "intensity");
  for (const vector of vectors) vector[intensity] = 0;

  const built = buildFeatureMatrix(vectors);
  assert.deepEqual(built.dropped, ["intensity"]);
  assert.equal(built.dimensions.includes("intensity"), false);
  for (const row of built.rows) {
    for (const value of row) assert.equal(Number.isFinite(value), true);
  }
});

test("an absent dimension is imputed to the axis origin, not to zero", () => {
  // Two assets differ only in tempo, and one has no trustworthy tempo. The one
  // without must sit at the centre of the tempo axis, contributing nothing --
  // not at an extreme, which is what a zero fill would do.
  const tempo = DIMENSIONS.findIndex((dimension) => dimension.name === "tempo");
  const vectors = [flat(1), flat(1), flat(1), flat(1)];
  vectors[0][tempo] = 10;
  vectors[1][tempo] = 20;
  vectors[2][tempo] = 30;
  vectors[3][tempo] = null;

  const built = buildFeatureMatrix(vectors);
  const column = built.dimensions.indexOf("tempo");
  assert.notEqual(column, -1);
  assert.equal(built.rows[3][column], 0);
});

test("imputed counts describe the asset, not the corpus", () => {
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  vectors[2][0] = null;
  vectors[2][1] = null;
  const built = buildFeatureMatrix(vectors);
  assert.deepEqual(built.imputed, [0, 0, 2, 0]);
});

test("an all-absent dimension is dropped rather than imputed everywhere", () => {
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  const column = DIMENSIONS.findIndex((dimension) => dimension.name === "key strength");
  for (const vector of vectors) vector[column] = null;
  assert.equal(buildFeatureMatrix(vectors).dropped.includes("key strength"), true);
});

test("an outlier is clipped rather than allowed to flatten the corpus", () => {
  const vectors = [flat(1), flat(2), flat(3), flat(1e9)];
  const built = buildFeatureMatrix(vectors);
  for (const row of built.rows) {
    for (const value of row) assert.equal(Math.abs(value) <= 4, true);
  }
});

test("the character group is weighted above harmony and timbre", () => {
  // Equal raw spread in each group must not mean equal influence: character has
  // 8 dimensions against 24, so per-group L2 plus a weight is what keeps it heard.
  const vectors = [flat(1), flat(2), flat(3), flat(4)];
  const built = buildFeatureMatrix(vectors);
  const norm = (row, group) => Math.hypot(
    ...built.dimensions
      .map((name, index) => [DIMENSIONS.find((d) => d.name === name).group, row[index]])
      .filter(([g]) => g === group)
      .map(([, value]) => value),
  );
  const row = built.rows[0];
  assert.equal(Math.abs(norm(row, "character") - 1.5) < 1e-9, true);
  assert.equal(Math.abs(norm(row, "harmony") - 1) < 1e-9, true);
});

test("an empty corpus produces an empty matrix rather than throwing", () => {
  const built = buildFeatureMatrix([]);
  assert.deepEqual(built.rows, []);
  assert.deepEqual(built.dimensions, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build:electron && node --test tests/unit/map-matrix.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/map/matrix.ts`**

```ts
// A corpus of raw vectors becomes the matrix PCA takes.
//
// Robust scaling, not z-scoring: these distributions are skewed, and two outlying
// recordings would otherwise compress everything else into a point.

import { DIMENSIONS, GROUP_WEIGHTS, type DimensionGroup } from "./feature-vector";

export type FeatureMatrix = {
  /** One row per asset, one column per surviving dimension. */
  rows: number[][];
  /** The surviving dimension names, in column order. */
  dimensions: string[];
  /** Names dropped for having no spread. */
  dropped: string[];
  /** Per asset, how many of its dimensions were absent. Counted before dropping. */
  imputed: number[];
};

/** How far a scaled value may travel from the median before it is clipped. */
const CLIP = 4;

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function buildFeatureMatrix(vectors: (number | null)[][]): FeatureMatrix {
  if (vectors.length === 0) return { rows: [], dimensions: [], dropped: [], imputed: [] };

  const imputed = vectors.map((vector) => vector.filter((value) => value === null).length);

  const kept: { name: string; group: DimensionGroup; scaled: number[] }[] = [];
  const dropped: string[] = [];

  DIMENSIONS.forEach((dimension, column) => {
    const present = vectors
      .map((vector) => vector[column])
      .filter((value): value is number => value !== null && Number.isFinite(value));

    // Nothing measured this anywhere, so there is nothing to scale against.
    if (present.length === 0) {
      dropped.push(dimension.name);
      return;
    }

    const sorted = [...present].sort((a, b) => a - b);
    const centre = median(present);
    const spread = quantile(sorted, 0.75) - quantile(sorted, 0.25);

    // A constant dimension carries no information, and its IQR is 0 — dividing by
    // it would put Infinity or NaN through every row. `intensity` is the realistic
    // case: it only ever takes -1, 0 or 1.
    if (spread === 0) {
      dropped.push(dimension.name);
      return;
    }

    kept.push({
      name: dimension.name,
      group: dimension.group,
      // An absent value becomes 0, which after centring *is* the axis origin: the
      // asset contributes nothing to this direction rather than asserting a value.
      scaled: vectors.map((vector) => {
        const value = vector[column];
        if (value === null || !Number.isFinite(value)) return 0;
        return Math.max(-CLIP, Math.min(CLIP, (value - centre) / spread));
      }),
    });
  });

  const groups = Object.keys(GROUP_WEIGHTS) as DimensionGroup[];

  const rows = vectors.map((_, row) => {
    const values = kept.map((dimension) => dimension.scaled[row]);

    // Per-group L2 then a weight. Without this the 24 harmony and timbre
    // dimensions decide every position on their own.
    for (const group of groups) {
      const columns = kept.reduce<number[]>((found, dimension, index) => {
        if (dimension.group === group) found.push(index);
        return found;
      }, []);
      const norm = Math.hypot(...columns.map((column) => values[column]));
      if (norm === 0) continue;
      const factor = GROUP_WEIGHTS[group] / norm;
      for (const column of columns) values[column] *= factor;
    }

    return values;
  });

  return { rows, dimensions: kept.map((dimension) => dimension.name), dropped, imputed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:electron && node --test tests/unit/map-matrix.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/map/matrix.ts tests/unit/map-matrix.test.mjs
git commit -m "Add robust scaling for the Fracture map feature matrix

Median/IQR with clipping, per-group L2 and weights. A dimension with a zero IQR
is dropped rather than divided by, which is what intensity would otherwise do to
every row."
```

---

### Task 4: PCA

**Files:**
- Create: `lib/map/projection.ts`
- Test: `tests/unit/map-projection.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ProjectionBasis = { mean: number[]; components: number[][]; eigenvalues: number[]; totalVariance: number }`
  - `function fitProjection(rows: number[][], componentCount?: number): ProjectionBasis` — default 4, so the report can show more than it plots
  - `function projectOne(row: number[], basis: ProjectionBasis): { x: number; y: number }`
  - `function projectAll(rows: number[][], basis: ProjectionBasis): { x: number; y: number }[]`
  - `function explainedVariance(basis: ProjectionBasis): number[]` — one ratio per component
  - `function topLoadings(basis: ProjectionBasis, dimensions: string[], component: number, count: number): { name: string; weight: number }[]`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/map-projection.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  explainedVariance,
  fitProjection,
  projectAll,
  projectOne,
  topLoadings,
} from "../../electron-dist/lib/map/projection.js";

/** Points spread widely along dimension 0, narrowly along 1, not at all along 2. */
const OBVIOUS = [
  [-10, -1, 5],
  [-5, 1, 5],
  [0, -1, 5],
  [5, 1, 5],
  [10, -1, 5],
];

test("the first component follows the widest direction", () => {
  const basis = fitProjection(OBVIOUS, 2);
  assert.equal(Math.abs(basis.components[0][0]) > 0.9, true);
  assert.equal(Math.abs(basis.components[0][1]) < 0.2, true);
});

test("the mean is the corpus centroid", () => {
  const basis = fitProjection(OBVIOUS, 2);
  assert.equal(basis.mean[0], 0);
  assert.equal(basis.mean[2], 5);
});

test("components are unit length and mutually orthogonal", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const [first, second] = basis.components;
  assert.equal(Math.abs(Math.hypot(...first) - 1) < 1e-6, true);
  assert.equal(Math.abs(Math.hypot(...second) - 1) < 1e-6, true);
  const dot = first.reduce((sum, value, index) => sum + value * second[index], 0);
  assert.equal(Math.abs(dot) < 1e-6, true);
});

test("projecting twice gives byte-identical coordinates", () => {
  // No RNG anywhere. Users navigate by spatial memory, so a layout that moves
  // between runs for no reason is worse than a slightly worse layout.
  const first = projectAll(OBVIOUS, fitProjection(OBVIOUS, 2));
  const second = projectAll(OBVIOUS, fitProjection(OBVIOUS, 2));
  assert.deepEqual(first, second);
});

test("component signs are fixed, so the map cannot mirror itself between runs", () => {
  // An eigenvector's sign is arbitrary. Negating the input must not flip the
  // basis: the largest-magnitude loading is forced positive either way.
  const flipped = OBVIOUS.map((row) => row.map((value) => -value));
  const basis = fitProjection(OBVIOUS, 2);
  const other = fitProjection(flipped, 2);
  const dominant = (component) => component.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
  assert.equal(dominant(basis.components[0]) > 0, true);
  assert.equal(dominant(other.components[0]) > 0, true);
});

test("explained variance is a descending set of ratios summing to at most one", () => {
  const ratios = explainedVariance(fitProjection(OBVIOUS, 3));
  assert.equal(ratios[0] >= ratios[1], true);
  assert.equal(ratios[1] >= ratios[2], true);
  assert.equal(ratios.reduce((sum, value) => sum + value, 0) <= 1 + 1e-9, true);
  assert.equal(ratios[0] > 0.9, true);
});

test("projectOne agrees with projectAll", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const all = projectAll(OBVIOUS, basis);
  assert.deepEqual(projectOne(OBVIOUS[3], basis), all[3]);
});

test("a point at the centroid lands at the origin", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const point = projectOne(basis.mean, basis);
  assert.equal(Math.abs(point.x) < 1e-9, true);
  assert.equal(Math.abs(point.y) < 1e-9, true);
});

test("top loadings name the dimensions driving an axis", () => {
  const basis = fitProjection(OBVIOUS, 2);
  const loadings = topLoadings(basis, ["wide", "narrow", "flat"], 0, 2);
  assert.equal(loadings[0].name, "wide");
  assert.equal(loadings.length, 2);
});

test("a corpus too small to have a direction returns zero coordinates, not NaN", () => {
  const basis = fitProjection([[1, 2, 3]], 2);
  const point = projectOne([1, 2, 3], basis);
  assert.equal(Number.isFinite(point.x), true);
  assert.equal(Number.isFinite(point.y), true);
});

test("an empty corpus does not throw", () => {
  const basis = fitProjection([], 2);
  assert.deepEqual(projectAll([], basis), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build:electron && node --test tests/unit/map-projection.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/map/projection.ts`**

```ts
// PCA to a handful of components, by power iteration with deflation.
//
// Hand-rolled rather than pulled from a library because it is short, it must be
// exactly deterministic, and a linear basis is the whole reason PCA was chosen
// over UMAP: `umap-js` has no transform, so every corpus change means a re-fit and
// a Procrustes alignment to stop the map rotating. A basis is a mean and some
// vectors, and a new asset projects through it unchanged.

export type ProjectionBasis = {
  /** The corpus centroid. Subtracted before projecting. */
  mean: number[];
  /** Unit-length, orthogonal, descending by eigenvalue. */
  components: number[][];
  eigenvalues: number[];
  /** Trace of the covariance matrix: the total variance available to explain. */
  totalVariance: number;
};

const ITERATIONS = 200;
const TOLERANCE = 1e-10;

function covariance(rows: number[][], mean: number[]): number[][] {
  const width = mean.length;
  const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const left = row[i] - mean[i];
      for (let j = i; j < width; j++) {
        matrix[i][j] += left * (row[j] - mean[j]);
      }
    }
  }
  const divisor = Math.max(1, rows.length - 1);
  for (let i = 0; i < width; i++) {
    for (let j = i; j < width; j++) {
      matrix[i][j] /= divisor;
      matrix[j][i] = matrix[i][j];
    }
  }
  return matrix;
}

function multiply(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0));
}

/**
 * Forces the largest-magnitude loading positive.
 *
 * An eigenvector's sign is arbitrary, so without this the map can mirror itself
 * between runs for no reason at all — which throws away the stability that
 * motivated choosing PCA in the first place.
 */
function fixSign(vector: number[]): number[] {
  let dominant = 0;
  for (const value of vector) {
    if (Math.abs(value) > Math.abs(dominant)) dominant = value;
  }
  return dominant < 0 ? vector.map((value) => -value) : vector;
}

export function fitProjection(rows: number[][], componentCount = 4): ProjectionBasis {
  const width = rows[0]?.length ?? 0;
  const empty = { mean: new Array<number>(width).fill(0), components: [], eigenvalues: [], totalVariance: 0 };
  if (width === 0) return empty;

  const mean = Array.from({ length: width }, (_, column) =>
    rows.reduce((sum, row) => sum + row[column], 0) / rows.length);

  const matrix = covariance(rows, mean);
  const totalVariance = matrix.reduce((sum, row, index) => sum + row[index], 0);

  const components: number[][] = [];
  const eigenvalues: number[] = [];

  for (let index = 0; index < Math.min(componentCount, width); index++) {
    // A fixed deterministic start, not a random one. The 1/(i+1) ramp is only
    // there so the vector is not parallel to an axis, which would stall.
    let vector = Array.from({ length: width }, (_, i) => 1 / (i + 1));
    let eigenvalue = 0;

    for (let step = 0; step < ITERATIONS; step++) {
      let next = multiply(matrix, vector);

      // Deflate against the components already found, which keeps them orthogonal
      // without ever forming the deflated matrix.
      for (const found of components) {
        const overlap = next.reduce((sum, value, i) => sum + value * found[i], 0);
        next = next.map((value, i) => value - overlap * found[i]);
      }

      const norm = Math.hypot(...next);
      if (norm < TOLERANCE) {
        // No variance left in this direction. A constant corpus reaches this on
        // the first component, which is why callers must tolerate fewer
        // components than they asked for.
        vector = new Array<number>(width).fill(0);
        eigenvalue = 0;
        break;
      }

      next = next.map((value) => value / norm);
      const converged = Math.abs(norm - eigenvalue) < TOLERANCE;
      vector = next;
      eigenvalue = norm;
      if (converged) break;
    }

    if (eigenvalue === 0) break;
    components.push(fixSign(vector));
    eigenvalues.push(eigenvalue);
  }

  return { mean, components, eigenvalues, totalVariance };
}

/**
 * A row's position on the first two components.
 *
 * A basis with fewer than two components is normal — it happens when the corpus
 * has one asset, or none — and the missing axis reads 0 rather than NaN.
 */
export function projectOne(row: number[], basis: ProjectionBasis): { x: number; y: number } {
  const along = (component: number[] | undefined) => component
    ? component.reduce((sum, value, index) => sum + value * (row[index] - basis.mean[index]), 0)
    : 0;
  return { x: along(basis.components[0]), y: along(basis.components[1]) };
}

export function projectAll(rows: number[][], basis: ProjectionBasis): { x: number; y: number }[] {
  return rows.map((row) => projectOne(row, basis));
}

/** One ratio per component found. Sums to less than 1 unless every component was kept. */
export function explainedVariance(basis: ProjectionBasis): number[] {
  if (basis.totalVariance === 0) return basis.eigenvalues.map(() => 0);
  return basis.eigenvalues.map((value) => value / basis.totalVariance);
}

/** Which measurements drive an axis, strongest first. Used for the axis captions. */
export function topLoadings(
  basis: ProjectionBasis,
  dimensions: string[],
  component: number,
  count: number,
): { name: string; weight: number }[] {
  const loadings = basis.components[component];
  if (!loadings) return [];
  return loadings
    .map((weight, index) => ({ name: dimensions[index] ?? `dimension ${index}`, weight }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, count);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:electron && node --test tests/unit/map-projection.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/map/projection.ts tests/unit/map-projection.test.mjs
git commit -m "Add a deterministic PCA for the Fracture map

Power iteration with deflation, no RNG, and a sign fix so the layout cannot
mirror itself between runs. Exposes the basis as a value so a frozen basis
remains possible later."
```

---

### Task 5: Screen layout

**Files:**
- Create: `lib/map/spread.ts`
- Test: `tests/unit/map-spread.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Point = { x: number; y: number }`
  - `type Bounds = { width: number; height: number; padX: number; padY: number }`
  - `function spreadPoints(points: Point[], ids: string[], bounds: Bounds): Point[]`

`ids` is parallel to `points` and is used only to derive a deterministic offset when two points collide.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/map-spread.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { spreadPoints } from "../../electron-dist/lib/map/spread.js";

const BOUNDS = { width: 1280, height: 760, padX: 72, padY: 62 };

function inBounds(point) {
  return point.x >= BOUNDS.padX && point.x <= BOUNDS.width - BOUNDS.padX
    && point.y >= BOUNDS.padY && point.y <= BOUNDS.height - BOUNDS.padY;
}

test("everything lands inside the padded bounds", () => {
  const points = [{ x: -100, y: -100 }, { x: 0, y: 0 }, { x: 250, y: 3 }];
  const spread = spreadPoints(points, ["a", "b", "c"], BOUNDS);
  for (const point of spread) assert.equal(inBounds(point), true);
});

test("the extremes are pushed to opposite edges", () => {
  const spread = spreadPoints([{ x: 0, y: 0 }, { x: 1, y: 1 }], ["a", "b"], BOUNDS);
  assert.equal(Math.min(spread[0].x, spread[1].x), BOUNDS.padX);
  assert.equal(Math.max(spread[0].x, spread[1].x), BOUNDS.width - BOUNDS.padX);
});

test("coincident points are separated so both can be clicked", () => {
  // A source and a fragment spanning its whole take measure almost identically.
  const spread = spreadPoints(
    [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 100, y: 100 }],
    ["one", "two", "three", "far"],
    BOUNDS,
  );
  const seen = new Set(spread.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`));
  assert.equal(seen.size, 4);
  for (const point of spread) assert.equal(inBounds(point), true);
});

test("separation is deterministic and keyed on the id, not on order", () => {
  const points = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
  const first = spreadPoints(points, ["one", "two"], BOUNDS);
  const second = spreadPoints(points, ["one", "two"], BOUNDS);
  assert.deepEqual(first, second);
});

test("a corpus with no spread on one axis is centred rather than divided by zero", () => {
  const spread = spreadPoints([{ x: 3, y: 0 }, { x: 3, y: 1 }], ["a", "b"], BOUNDS);
  for (const point of spread) {
    assert.equal(Number.isFinite(point.x), true);
    assert.equal(inBounds(point), true);
  }
});

test("a single point sits in the middle", () => {
  const [point] = spreadPoints([{ x: 42, y: 42 }], ["only"], BOUNDS);
  assert.equal(point.x, BOUNDS.width / 2);
  assert.equal(point.y, BOUNDS.height / 2);
});

test("an empty list stays empty", () => {
  assert.deepEqual(spreadPoints([], [], BOUNDS), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build:electron && node --test tests/unit/map-spread.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/map/spread.ts`**

```ts
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
  const placed = xs.map((x, index) => ({ x, y: ys[index] }));

  // Nudge along a direction derived from the id, so the result is the same on
  // every run and does not depend on the order assets arrived in.
  for (let index = 0; index < placed.length; index++) {
    for (let other = 0; other < index; other++) {
      if (Math.hypot(placed[index].x - placed[other].x, placed[index].y - placed[other].y) >= MIN_SEPARATION) {
        continue;
      }
      const hash = stableHash(ids[index] ?? String(index));
      const angle = (hash % 360) * (Math.PI / 180);
      placed[index] = {
        x: Math.max(bounds.padX, Math.min(bounds.width - bounds.padX, placed[index].x + Math.cos(angle) * MIN_SEPARATION)),
        y: Math.max(bounds.padY, Math.min(bounds.height - bounds.padY, placed[index].y + Math.sin(angle) * MIN_SEPARATION)),
      };
      // Re-check against everything, because the nudge may have created a new
      // collision. Restarting the inner scan is enough at this corpus size.
      other = -1;
    }
  }

  return placed;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:electron && node --test tests/unit/map-spread.test.mjs`
Expected: PASS, 7 tests.

If the "coincident points are separated" test hangs, the restart loop is cycling: cap it by tracking an attempt count per index and accepting the position after 12 attempts. Add that only if it actually hangs.

- [ ] **Step 5: Commit**

```bash
git add lib/map/spread.ts tests/unit/map-spread.test.mjs
git commit -m "Add Fracture map screen layout with deterministic de-collision

Coincident points are real -- two library sources have a fragment spanning the
whole take -- and an unclickable dot is the mild version of the problem."
```

---

### Task 6: Measure the seed audio

**Files:**
- Create: `scripts/compute-prototype-sources.mjs`
- Create (generated): `app/prototype-analysis.json`
- Create (generated): `public/audio/library-ready/<uuid>/source.json` × 28
- Modify: `package.json`
- Test: `tests/unit/prototype-analysis.test.mjs`

**Interfaces:**
- Consumes: `decodeWav`, `resample`, `FEATURE_SAMPLE_RATE`, `extractFeatures`, `windowForFeatures`, `computePeaks`, `magnitudes` from `electron-dist/lib/analysis/*`; `measuredSummaryFrom` from Task 1; `SCHEMA_VERSION`, `normalizeSourceDocument` from `electron-dist/lib/domain/source-document.js`.
- Produces: `app/prototype-analysis.json`, shaped `{ version: 1, generatedAt: string, extractor: string, fragments: Record<string, MeasuredSummary> }`, keyed by seed fragment id (`f01`…`f28`).

- [ ] **Step 1: Write the script**

Create `scripts/compute-prototype-sources.mjs`:

```js
#!/usr/bin/env node
// Measures the bundled seed audio (public/audio/f01.wav..f28.wav) with the same
// extractor the library uses, and emits two things:
//
//   app/prototype-analysis.json                   what the renderer imports
//   public/audio/library-ready/<id>/source.json   valid library documents
//
//   npm run seed-docs              measure and write both artifacts
//   npm run seed-docs -- --install also copy the documents and audio into the
//                                  managed library, retiring the seed data for real
//
// Requires `npm run build:electron` first: the analysis modules are consumed from
// electron-dist, the same build the app uses, so a seed file and a library file
// cannot be measured differently.
//
// Nothing invented is written. The documents carry measured analysis, the
// filename, duration, sample rate, a content hash and a waveform thumbnail. The
// seed fragments' hand-written names, keys, BPMs and roles are not persisted --
// that is the path Task 4a had to remove.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWav } from "../electron-dist/lib/analysis/wav.js";
import { resample, FEATURE_SAMPLE_RATE } from "../electron-dist/lib/analysis/resample.js";
import { extractFeatures, windowForFeatures } from "../electron-dist/lib/analysis/features.js";
import { PEAKS_PER_SECOND, computePeaks, magnitudes, peaksForRange } from "../electron-dist/lib/analysis/peaks.js";
import { measuredSummaryFrom } from "../electron-dist/lib/domain/measured-summary.js";
import { SCHEMA_VERSION, normalizeSourceDocument } from "../electron-dist/lib/domain/source-document.js";
import { resolveLibraryRoot } from "../electron-dist/lib/domain/paths.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioDir = path.join(repoRoot, "public", "audio");
const readyDir = path.join(audioDir, "library-ready");
const analysisPath = path.join(repoRoot, "app", "prototype-analysis.json");

// The thumbnail that lives in source.json. High-resolution peaks belong in a
// waveform.bin sidecar, never in a document parsed on every listSources().
const THUMBNAIL_POINTS = 512;

const require = createRequire(import.meta.url);

function loadEssentia() {
  const wasm = require("essentia.js/dist/essentia-wasm.umd.js");
  return {
    arrayToVector: (array) => wasm.arrayToVector(array),
    vectorToArray: (vector) => wasm.vectorToArray(vector),
    algorithms: new wasm.EssentiaJS(false),
    version: "essentia.js@0.1.3",
  };
}

/**
 * A UUID derived from the filename, so re-running the script does not churn the
 * generated ids and the JSON diff stays empty when nothing changed.
 */
function stableUuid(name) {
  const hex = createHash("sha1").update(`fragments-seed:${name}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [hex.slice(0, 8), hex.slice(8, 12), `5${hex.slice(13, 16)}`, `${variant}${hex.slice(18, 20)}`, hex.slice(20, 32)].join("-");
}

async function main() {
  const install = process.argv.slice(2).includes("--install");
  const files = (await readdir(audioDir)).filter((name) => /^f\d{2}\.wav$/.test(name)).sort();
  if (files.length === 0) throw new Error(`No f??.wav files found in ${audioDir}`);

  const essentia = loadEssentia();
  const at = new Date().toISOString();
  const summaries = {};
  const documents = [];

  for (const name of files) {
    const seedId = name.replace(/\.wav$/, "");
    const filePath = path.join(audioDir, name);
    const bytes = new Uint8Array(await readFile(filePath));
    const decoded = decodeWav(bytes);
    const duration = decoded.signal.length / decoded.sampleRate;

    const prepared = windowForFeatures(
      resample(decoded.signal, decoded.sampleRate, FEATURE_SAMPLE_RATE),
      FEATURE_SAMPLE_RATE,
    );
    const analysis = {
      ...extractFeatures(essentia, prepared),
      provenance: { origin: "measured", extractor: essentia.version, at },
    };

    const sourceId = stableUuid(name);
    // Measured at the normal rate, then reduced to the thumbnail. `magnitudes`
    // takes a `PeakRange`, which is what `peaksForRange` returns — `computePeaks`
    // returns `WaveformPeaks` and cannot be passed to it directly.
    const thumbnail = magnitudes(
      peaksForRange(computePeaks(decoded.signal, decoded.sampleRate, PEAKS_PER_SECOND), 0, duration, THUMBNAIL_POINTS),
    );

    const document = {
      schemaVersion: SCHEMA_VERSION,
      id: sourceId,
      // The filename, not the seed fragment's hand-written title. Nothing
      // invented reaches a source.json.
      originalName: name,
      audioFile: name,
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      importedAt: at,
      deletedAt: null,
      duration,
      format: "wav",
      sampleRate: decoded.sampleRate,
      waveform: { version: 1, count: thumbnail.length, peaks: thumbnail },
      analysis,
      sourceTypes: [],
      sensitivity: 52,
      fragments: [{
        id: `${sourceId}-whole`,
        name: name,
        start: 0,
        end: duration,
        roles: [],
        // Nothing measures a musical role, so claiming one would be invention.
        primaryRole: "Unclassified",
        userTags: [],
        analysis,
        analysisRevision: 1,
        createdAt: at,
      }],
      relationships: [],
    };

    // Proves the document is a real library document and not merely
    // document-shaped. It throws rather than returning a verdict.
    normalizeSourceDocument(document);

    summaries[seedId] = measuredSummaryFrom(analysis, duration);
    documents.push({ seedId, sourceId, name, document });

    const bpm = analysis.bpm === null ? "—" : `${analysis.bpm} (confidence ${(analysis.bpmConfidence ?? 0).toFixed(2)})`;
    console.log(`${seedId}  ${duration.toFixed(2)}s  bpm ${bpm}  key ${analysis.key ?? "—"} ${analysis.scale ?? ""}  centroid ${analysis.centroidHz ?? "—"}Hz`);
  }

  await writeFile(
    analysisPath,
    `${JSON.stringify({ version: 1, generatedAt: at, extractor: essentia.version, fragments: summaries }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nWrote ${analysisPath} (${files.length} summaries)`);

  for (const { sourceId, document } of documents) {
    const dir = path.join(readyDir, sourceId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
  }
  console.log(`Wrote ${documents.length} library-ready documents to ${readyDir}`);

  if (!install) {
    console.log("\nPass --install to copy these into the managed library.");
    return;
  }

  const libraryRoot = path.join(resolveLibraryRoot(path.join(os.homedir(), "Documents")), "sources");
  for (const { sourceId, name, document } of documents) {
    const dir = path.join(libraryRoot, sourceId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "source.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await copyFile(path.join(audioDir, name), path.join(dir, name));
  }
  console.log(`Installed ${documents.length} sources into ${libraryRoot}`);
}

main().catch((error) => {
  // Emscripten throws bare numbers for C++ aborts, so this cannot assume an Error.
  console.error(typeof error === "number" ? `essentia aborted (${error})` : error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Register the script**

In `package.json`, add after the `compute-waveforms` line:

```json
    "seed-docs": "npm run build:electron && node scripts/compute-prototype-sources.mjs",
```

- [ ] **Step 3: Run it and read the output**

Run: `npm run seed-docs`
Expected: 28 lines, one per seed file, each with a real duration near 6.00s and a measured key. Then two "Wrote" lines.

The thumbnail must stay at 512 points. High-resolution peaks belong in a `waveform.bin` sidecar; a `source.json` is parsed for every source on every `listSources()` and rewritten whole on every metadata edit.

If `normalizeSourceDocument` throws, read its message and fix the document — that is the function doing its job, and a document that fails it would fail on import too.

- [ ] **Step 4: Write the test**

Create `tests/unit/prototype-analysis.test.mjs`:

```js
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
```

- [ ] **Step 5: Run the test**

Run: `node --test tests/unit/prototype-analysis.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/compute-prototype-sources.mjs app/prototype-analysis.json public/audio/library-ready package.json tests/unit/prototype-analysis.test.mjs
git commit -m "Measure the seed audio with the real extractor

The 28 bundled wavs are real, distinct audio, so the map can place them by
measurement instead of by their hand-written metadata -- one code path for seed
and library assets. Also emits library-ready source documents, so retiring the
seed data is a file move rather than a refactor."
```

---

### Task 7: Assemble the assets

**Files:**
- Create: `app/features/fracture-map/fracture-map-assets.ts`
- Modify: `app/prototype-data.ts`
- Test: `tests/unit/fracture-map-assets.test.mjs`

**Interfaces:**
- Consumes: `MapAsset` from `lib/map/asset`, `Fragment` from `lib/view/fragment`, `SourceFile` from `lib/view/source-file`, `MeasuredSummary` from `lib/view/analysis`.
- Produces:
  - `const WHOLE_TAKE_RATIO = 0.98`
  - `function collectMapAssets(sources: SourceFile[], fragments: Fragment[], seedAnalysis: Record<string, MeasuredSummary>): MapAsset[]`
  - From `app/prototype-data.ts`: `export const SEED_ANALYSIS: Record<string, MeasuredSummary>`

**The collapse logic lives in `lib/map/collapse.ts`, not in the `app/` module.** Nothing under `app/` is compiled into `electron-dist/`, so a test cannot import it, and this rule is worth a test: it silently halves or doubles the point count if the comparison is inverted. `fracture-map-assets.ts` is the thin adapter that knows about view types and seed data; `collapse.ts` is the pure rule.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fracture-map-assets.test.mjs`. Written against `lib/map/collapse.ts`, the fallback location, because that is the one guaranteed to be loadable:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build:electron && node --test tests/unit/fracture-map-assets.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/map/collapse.ts`**

```ts
// Which of a source's points survive.
//
// This map treats a source and a fragment as the same kind of thing, which makes
// a fragment spanning its whole take a duplicate of its source rather than a
// child of it: the same audio, so the same measurements, so the same position.

import type { MapAsset } from "./asset";

/** How much of a source a fragment must cover to *be* that source. */
export const WHOLE_TAKE_RATIO = 0.98;

/** A `MapAsset` plus the source it belongs to, which the collapse needs and the map does not. */
export type PlacedAsset = MapAsset & { sourceId: string };

export function collapseWholeTakes(assets: PlacedAsset[]): PlacedAsset[] {
  const covered = new Set<string>();

  for (const asset of assets) {
    if (asset.kind !== "fragment") continue;
    const source = assets.find((entry) => entry.kind === "source" && entry.sourceId === asset.sourceId);
    // A zero-length source cannot be covered — the ratio would be a division by
    // zero, and a NaN comparison quietly answering "no" is not a decision.
    if (!source || source.duration <= 0) continue;
    if (asset.duration / source.duration >= WHOLE_TAKE_RATIO) covered.add(source.id);
  }

  return assets.filter((asset) => !covered.has(asset.id));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:electron && node --test tests/unit/fracture-map-assets.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Export the seed analysis**

In `app/prototype-data.ts`, add the import beside the existing waveform import at line 17:

```ts
import prototypeAnalysis from "./prototype-analysis.json";
```

And add the export at the end of the file:

```ts
/**
 * What the seed audio actually measures, from `npm run seed-docs`.
 *
 * Deliberately NOT attached to the `Fragment` objects above. Their `bpm`, `key`
 * and `role` are hand-written and are what the cards, table and filters render;
 * attaching real measurements to the same objects would make a card read
 * "A minor · 92 BPM" while its detail panel reported something else measured from
 * the same file. Only the Fracture map reads this, through one fallback.
 *
 * Retiring the seed data means deleting this, `prototype-analysis.json`, the
 * script that writes it, and that fallback.
 */
export const SEED_ANALYSIS = prototypeAnalysis.fragments as Record<string, MeasuredSummary>;
```

Add `MeasuredSummary` to the type imports at the top of the file:

```ts
import type { MeasuredSummary } from "@/lib/view/analysis";
```

- [ ] **Step 6: Create `app/features/fracture-map/fracture-map-assets.ts`**

```ts
// Everything the Fracture map plots, from the abstractions the app already keeps.
//
// This is the one module that knows the seed data exists. When it is retired, the
// `seedAnalysis` parameter and its one lookup go with it and nothing else changes.

import { collapseWholeTakes, type PlacedAsset } from "@/lib/map/collapse";
import type { MeasuredSummary } from "@/lib/view/analysis";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";

export { WHOLE_TAKE_RATIO } from "@/lib/map/collapse";

export function collectMapAssets(
  sources: SourceFile[],
  fragments: Fragment[],
  seedAnalysis: Record<string, MeasuredSummary>,
): PlacedAsset[] {
  const assets: PlacedAsset[] = [];

  for (const source of sources) {
    if (!source.measured) continue;
    assets.push({
      // The `source:` prefix is what `buildSourcePreviewScope` returns, so one
      // selection can mean either a slice or a whole recording.
      id: `source:${source.id}`,
      sourceId: source.id,
      label: source.name,
      kind: "source",
      analysis: source.measured,
      duration: source.duration,
    });
  }

  for (const fragment of fragments) {
    // Disk beats the seed table: a real measurement is never overridden by one.
    const analysis = fragment.measured ?? seedAnalysis[fragment.id];
    if (!analysis) continue;
    assets.push({
      id: fragment.id,
      sourceId: fragment.sourceId,
      label: fragment.name,
      kind: "fragment",
      analysis,
      duration: fragment.end - fragment.start,
    });
  }

  return collapseWholeTakes(assets);
}
```

- [ ] **Step 7: Verify**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/map/collapse.ts app/features/fracture-map/fracture-map-assets.ts app/prototype-data.ts tests/unit/fracture-map-assets.test.mjs
git commit -m "Collect Fracture map assets and collapse whole-take duplicates

Sources and fragments are one kind of thing here, which makes a fragment
spanning its whole take a duplicate rather than a child. Two library sources and
all 28 seed files are exactly that."
```

---

### Task 8: The verification report — the checkpoint before any UI

This is the task that tells us whether the feature vector is worth plotting. **Do not proceed to Task 9 without reading its output.**

**Files:**
- Create: `scripts/fracture-report.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/fracture-report.mjs`:

```js
#!/usr/bin/env node
// What the Fracture map would plot, in text, before any of it is drawn.
//
//   npm run fracture
//
// Reads the managed library plus the measured seed audio, builds the same feature
// matrix and projection the app builds, and prints enough to judge them. If a
// drone's nearest neighbours are all drums, the bug is in the feature vector and
// no amount of layout work will hide it.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLibraryService } from "../electron-dist/lib/domain/library-service.js";
import { resolveLibraryRoot } from "../electron-dist/lib/domain/paths.js";
import { measuredSummaryFrom } from "../electron-dist/lib/domain/measured-summary.js";
import { DIMENSIONS, rawVector } from "../electron-dist/lib/map/feature-vector.js";
import { buildFeatureMatrix } from "../electron-dist/lib/map/matrix.js";
import { explainedVariance, fitProjection, projectAll, topLoadings } from "../electron-dist/lib/map/projection.js";
import { collapseWholeTakes } from "../electron-dist/lib/map/collapse.js";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const libraryRoot = resolveLibraryRoot(path.join(os.homedir(), "Documents"));
const service = createLibraryService(libraryRoot);
const assets = [];

for (const source of await service.listSources()) {
  const duration = source.duration ?? 0;
  const summary = measuredSummaryFrom(source.analysis, duration);
  if (summary) {
    assets.push({ id: `source:${source.id}`, sourceId: source.id, kind: "source", duration, label: source.originalName, analysis: summary });
  }
  for (const fragment of source.fragments ?? []) {
    const span = fragment.end - fragment.start;
    const fragmentSummary = measuredSummaryFrom(fragment.analysis, span);
    if (!fragmentSummary) continue;
    assets.push({ id: fragment.id, sourceId: source.id, kind: "fragment", duration: span, label: `${source.originalName} · ${fragment.name}`, analysis: fragmentSummary });
  }
}

const seed = JSON.parse(await readFile(path.join(repoRoot, "app", "prototype-analysis.json"), "utf8"));
for (const [id, summary] of Object.entries(seed.fragments)) {
  assets.push({ id, sourceId: `seed:${id}`, kind: "fragment", duration: 6, label: `seed ${id}`, analysis: summary });
}

const placed = collapseWholeTakes(assets);
console.log(`${assets.length} assets, ${placed.length} after collapsing whole takes\n`);

const vectors = placed.map((asset) => rawVector(asset.analysis));
const matrix = buildFeatureMatrix(vectors);

console.log(`dimensions kept ${matrix.dimensions.length} of ${DIMENSIONS.length}`);
if (matrix.dropped.length) console.log(`dropped (no spread) ${matrix.dropped.join(", ")}`);

console.log("\nraw spread per dimension");
DIMENSIONS.forEach((dimension, column) => {
  const present = vectors.map((vector) => vector[column]).filter((value) => value !== null);
  if (present.length === 0) {
    console.log(`  ${dimension.name.padEnd(16)} not measured anywhere`);
    return;
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  console.log(`  ${dimension.name.padEnd(16)} ${present.length}/${vectors.length} measured   ${min.toFixed(3)} .. ${max.toFixed(3)}`);
});

const worst = placed
  .map((asset, index) => ({ label: asset.label, imputed: matrix.imputed[index] }))
  .sort((a, b) => b.imputed - a.imputed)
  .slice(0, 5);
console.log("\nmost-imputed assets");
for (const entry of worst) console.log(`  ${entry.imputed}/${DIMENSIONS.length}   ${entry.label}`);

const basis = fitProjection(matrix.rows, 6);
const ratios = explainedVariance(basis);
console.log("\nexplained variance");
ratios.forEach((ratio, index) => console.log(`  PC${index + 1}  ${(ratio * 100).toFixed(1)}%`));
const firstTwo = (ratios[0] ?? 0) + (ratios[1] ?? 0);
console.log(`  PC1+PC2 ${(firstTwo * 100).toFixed(1)}%`);
if (firstTwo > 0.8) {
  console.log("  WARNING: two components hold over 80%. The feature set is under-diversified.");
}

for (const component of [0, 1]) {
  console.log(`\nPC${component + 1} top loadings`);
  for (const loading of topLoadings(basis, matrix.dimensions, component, 6)) {
    console.log(`  ${loading.weight >= 0 ? "+" : "-"}${Math.abs(loading.weight).toFixed(3)}  ${loading.name}`);
  }
}

const points = projectAll(matrix.rows, basis);
const distance = (a, b) => Math.hypot(
  ...matrix.rows[a].map((value, index) => value - matrix.rows[b][index]),
);

console.log("\nnearest neighbours in feature space");
// Evenly spaced through the list rather than random, so the report is the same
// on every run and two runs can be compared.
const step = Math.max(1, Math.floor(placed.length / 5));
for (let index = 0; index < placed.length && index < step * 5; index += step) {
  console.log(`  ${placed[index].label}`);
  const neighbours = placed
    .map((asset, other) => ({ label: asset.label, other, gap: distance(index, other) }))
    .filter((entry) => entry.other !== index)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 5);
  for (const neighbour of neighbours) {
    console.log(`      ${neighbour.gap.toFixed(3)}  ${neighbour.label}`);
  }
}

const xs = points.map((point) => point.x);
const ys = points.map((point) => point.y);
console.log(`\nprojected extent  x ${Math.min(...xs).toFixed(2)} .. ${Math.max(...xs).toFixed(2)}   y ${Math.min(...ys).toFixed(2)} .. ${Math.max(...ys).toFixed(2)}`);
```

- [ ] **Step 2: Register the script**

In `package.json`, beside `affinities`:

```json
    "fracture": "npm run build:electron && node scripts/fracture-report.mjs",
```

- [ ] **Step 3: Run it**

Run: `npm run fracture`
Expected: an asset count near 55, a dimension count, an explained-variance table, two loading lists, and five neighbour groups.

- [ ] **Step 4: Read the output and decide**

Stop and judge three things:

1. **Does PC1+PC2 exceed 80%?** If so, the feature set is under-diversified — say so and continue anyway for the hackathon, but note it.
2. **Do the neighbour groups make sense?** Seed files next to seed files is expected and fine. A library fragment whose five nearest neighbours are all from unrelated sources with obviously different character is a signal the group weights are wrong. Try `character: 2.5` and re-run before changing anything else.
3. **Is any dimension dropped every time?** If `intensity` is always dropped, that is worth knowing but not worth fixing now.

This is the only checkpoint where the feature design can still be changed cheaply.

- [ ] **Step 5: Commit, with the findings in the message**

The commit body must state three things from the run you just read: the PC1/PC2 split, whether the neighbour groups were musically sensible, and which dimensions were dropped. Write what the run actually said — this is the record of whether the feature vector works, and the next person has no other way to know.

```bash
git add scripts/fracture-report.mjs package.json
git commit -m "Add the Fracture map verification report

Prints explained variance, per-axis loadings, raw spread, imputation counts and
nearest neighbours before anything is drawn.

First run: PC1 <n>%, PC2 <n>%. <What the neighbour groups looked like.>
Dropped: <dimensions, or none>."
```

---

### Task 9: The tab and the scatter

**Files:**
- Create: `app/features/fracture-map/fracture-map-view.tsx`
- Modify: `app/fragments-app.tsx` (line 69, line 491, line 1199, and a new render block after the `view === "map"` block ending around line 1364)
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `collectMapAssets` from Task 7, `rawVector`/`DIMENSIONS` from Task 2, `buildFeatureMatrix` from Task 3, `fitProjection`/`projectAll`/`topLoadings` from Task 4, `spreadPoints` from Task 5, `MAP_WORLD` from `app/map-layout.mjs`, `strongestPitchClassIndex` from `@/lib/audio/chroma-sparkline`.
- Produces: `<FractureMapView>` with props `{ sources, fragments, seedAnalysis, selectedId, onSelect, inspector }`.

- [ ] **Step 1: Create the view component**

Create `app/features/fracture-map/fracture-map-view.tsx`:

```tsx
"use client";

import { useMemo } from "react";

import { collectMapAssets } from "./fracture-map-assets";
import { MAP_WORLD } from "@/app/map-layout.mjs";
import { strongestPitchClassIndex } from "@/lib/audio/chroma-sparkline";
import { DIMENSIONS, rawVector } from "@/lib/map/feature-vector";
import { buildFeatureMatrix } from "@/lib/map/matrix";
import { fitProjection, projectAll, topLoadings } from "@/lib/map/projection";
import { spreadPoints } from "@/lib/map/spread";
import type { MeasuredSummary } from "@/lib/view/analysis";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";

type FractureMapViewProps = {
  sources: SourceFile[];
  fragments: Fragment[];
  seedAnalysis: Record<string, MeasuredSummary>;
  selectedId: string | null;
  onSelect: (assetId: string) => void;
  /** The card for the selected asset, supplied by the app so playback stays in one place. */
  inspector: React.ReactNode;
};

/** Above this share of imputed dimensions, a point is drawn as unsettled. */
const MOSTLY_IMPUTED = 0.5;

export function FractureMapView({ sources, fragments, seedAnalysis, selectedId, onSelect, inspector }: FractureMapViewProps) {
  const layout = useMemo(() => {
    const assets = collectMapAssets(sources, fragments, seedAnalysis);
    if (assets.length === 0) return null;

    const matrix = buildFeatureMatrix(assets.map((asset) => rawVector(asset.analysis)));
    const basis = fitProjection(matrix.rows, 2);
    const points = spreadPoints(
      projectAll(matrix.rows, basis),
      assets.map((asset) => asset.id),
      MAP_WORLD,
    );

    return {
      nodes: assets.map((asset, index) => ({
        id: asset.id,
        label: asset.label,
        point: points[index],
        pitchClass: strongestPitchClassIndex(asset.analysis.chroma),
        unsettled: matrix.imputed[index] / DIMENSIONS.length > MOSTLY_IMPUTED,
      })),
      captions: [0, 1].map((component) => topLoadings(basis, matrix.dimensions, component, 2)
        .map((loading) => loading.name)
        .join(" · ")),
    };
  }, [sources, fragments, seedAnalysis]);

  return (
    <section className="page-view fracture-page">
      <div className="panel-titlebar fracture-heading">
        <div className="fracture-legend">
          <span>Position · what analysis measured</span>
          <span>Colour · the pitch class it leans on</span>
          <span>Faded · little was measurable</span>
        </div>
      </div>

      <div className="fracture-board" role="region" aria-label="Fragments placed by measured character">
        {!layout
          ? <p className="fracture-empty">Nothing here has been measured yet. Once your audio is analysed, it will appear here arranged by how it sounds.</p>
          : <div className="fracture-canvas" style={{ aspectRatio: `${MAP_WORLD.width} / ${MAP_WORLD.height}` }}>
            <span className="fracture-axis fracture-axis-x">{layout.captions[0]}</span>
            <span className="fracture-axis fracture-axis-y">{layout.captions[1]}</span>

            {layout.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`fracture-node${selectedId === node.id ? " is-selected" : ""}${node.unsettled ? " is-unsettled" : ""}`}
                style={{
                  left: `${(node.point.x / MAP_WORLD.width) * 100}%`,
                  top: `${(node.point.y / MAP_WORLD.height) * 100}%`,
                  // A hue per pitch class, and no hue at all when nothing was
                  // measured -- a colour would be a claim about the harmony.
                  ["--fracture-hue" as string]: node.pitchClass === null ? "none" : `${node.pitchClass * 30}deg`,
                }}
                aria-pressed={selectedId === node.id}
                onClick={() => onSelect(node.id)}
              >
                <span className="fracture-node-dot" aria-hidden="true" />
                <span className="fracture-node-label">{node.label}</span>
              </button>
            ))}
          </div>}

        {selectedId && inspector ? <section className="fracture-inspector">{inspector}</section> : null}
      </div>
    </section>
  );
}
```

`strongestPitchClassIndex` is at `lib/audio/chroma-sparkline.tsx:11` with the signature `(chroma: number[] | null | undefined) => number | null`. It returns `null` for an empty vector *and* for an all-zero one, which is why a null hue is handled rather than assumed away.

`app/fragments-app.tsx:61` already imports `MAP_WORLD` from `app/map-layout.mjs`; copy that specifier exactly rather than inventing one.

- [ ] **Step 2: Add the styles**

Append to `app/globals.css`, after the existing `.map-*` blocks:

```css
/* Fracture map. Positions come from lib/map/, so nothing here encodes meaning
   except colour, which is the measured pitch class. */
.fracture-page { display:flex; flex-direction:column; gap:12px; min-height:0; }
.fracture-legend { display:flex; gap:18px; font-size:11px; color:var(--muted-foreground); }
.fracture-board { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; padding:16px; }
.fracture-canvas { position:relative; width:100%; max-height:100%; border:1px solid var(--border); border-radius:14px;
  background:radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--card) 88%, transparent), var(--background)); }
.fracture-empty { max-width:34ch; text-align:center; color:var(--muted-foreground); font-size:13px; }

.fracture-axis { position:absolute; font-size:10px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted-foreground); }
.fracture-axis-x { bottom:8px; left:50%; transform:translateX(-50%); }
.fracture-axis-y { left:8px; top:50%; transform:translateY(-50%) rotate(-90deg); transform-origin:center; }

.fracture-node { position:absolute; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:3px;
  background:none; border:none; padding:2px; cursor:pointer; }
.fracture-node-dot { width:13px; height:13px; border-radius:50%;
  background:hsl(var(--fracture-hue,0deg) 62% 58%); box-shadow:0 0 0 1px color-mix(in oklab, var(--background) 70%, transparent); transition:transform .12s ease; }
.fracture-node[style*="none"] .fracture-node-dot { background:var(--muted-foreground); }
.fracture-node-label { font-size:9px; max-width:96px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--muted-foreground); opacity:0; transition:opacity .12s ease; }
.fracture-node:hover .fracture-node-label,
.fracture-node:focus-visible .fracture-node-label,
.fracture-node.is-selected .fracture-node-label { opacity:1; }
.fracture-node:hover .fracture-node-dot { transform:scale(1.35); }
.fracture-node.is-selected .fracture-node-dot { transform:scale(1.5); box-shadow:0 0 0 2px var(--foreground); }
.fracture-node.is-unsettled .fracture-node-dot { opacity:.4; }

.fracture-inspector { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); width:min(520px, calc(100% - 48px));
  background:var(--card); border:1px solid var(--border); border-radius:12px; padding:10px; box-shadow:0 12px 40px rgba(0,0,0,.35); }
```

- [ ] **Step 3: Wire the tab**

In `app/fragments-app.tsx`:

At line 69, extend the union:

```ts
type View = "library" | "source" | "map" | "archive" | "fracture";
```

Add the import beside the other feature imports:

```ts
import { FractureMapView } from "@/app/features/fracture-map/fracture-map-view";
import { SEED_ANALYSIS } from "./prototype-data";
```

(`SEED_ANALYSIS` may be added to the existing `prototype-data` import instead.)

Beside `mapSelectedId`, add:

```ts
  const [fractureSelectedId,setFractureSelectedId] = useState<string|null>(null);
```

In `navigate()` at line 491, beside the existing map reset, add:

```ts
if (next !== "fracture") setFractureSelectedId(null);
```

In the nav at line 1199, after the Map button:

```tsx
          <button className={view === "fracture" ? "nav-active" : ""} onClick={() => navigate("fracture")}>Fracture map</button>
```

- [ ] **Step 4: Add the render block**

After the closing of the `view === "map"` section (around line 1364), add — for now with no inspector, which Task 10 fills in:

```tsx
      {!combineCandidates && view === "fracture" && <FractureMapView
        sources={sources}
        fragments={fractureFragments}
        seedAnalysis={SEED_ANALYSIS}
        selectedId={fractureSelectedId}
        onSelect={(assetId) => setFractureSelectedId(assetId)}
        inspector={null}
      />}
```

`filterableFragments` only excludes archived fragments. The map must also exclude the duplicate-group exclusions, matching what the existing map filters, so add this memo beside it (near line 561):

```tsx
  // Archived *and* duplicate-excluded. `filterableFragments` drops only the first,
  // and a fragment the user excluded from its duplicate group should not reappear
  // here as its own point.
  const fractureFragments = useMemo(
    () => activeFragments.filter((fragment) => !archived.has(fragment.id) && !duplicateExclusions.has(fragment.id)),
    [activeFragments, archived, duplicateExclusions],
  );
```

- [ ] **Step 5: Look at it**

Run: `npm run dev:all`
Open the app, click "Fracture map".

Expected: roughly 55 dots spread across the panel, coloured across a range of hues, labels appearing on hover, a selected dot growing when clicked. Two axis captions naming real measurements.

Judge the layout now, since this is what the Voronoi will be built on:
- **If the dots clump into one dense knot with a few outliers**, the deferred relaxation from spec section 9 is needed. Note it; do not build it yet.
- **If the dots form a ring or a cross**, that is usually one dimension dominating. Re-run `npm run fracture` and look at the PC1 loadings.
- **If everything is one colour**, `strongestPitchClassIndex` is being handed nulls — check that `analysis.chroma` survived `collectMapAssets`.

- [ ] **Step 6: Verify and commit**

Run: `npm run check`
Expected: PASS. `jsx-a11y` may object to something in the new component; fix it properly rather than adding a suppression — `eslint.config.mjs` suppressions must name the task that removes them, and this task does not own any.

The commit body must say how the layout actually looked — evenly spread, clumped with outliers, or dominated by one axis. That is the finding that decides whether the deferred relaxation is needed before the Voronoi pass.

```bash
git add app/features/fracture-map/fracture-map-view.tsx app/globals.css app/fragments-app.tsx
git commit -m "Add the Fracture map tab with a measured-feature scatter

Positions come from a PCA of what analysis measured; colour is the pitch class
each asset leans on. The existing Map is untouched.

Layout on the current library: <spread / clumped with N outliers / one dominant
axis>, which means relaxation is <needed / not needed> before cells."
```

---

### Task 10: Click to play

**Files:**
- Modify: `app/fragments-app.tsx` (the render block from Task 9)

No new machinery: the handlers already exist and are already passed to `LibraryView` this way. See "Correction to the spec" above.

- [ ] **Step 1: Resolve the selected asset**

In `app/fragments-app.tsx`, near the other map-related memos around line 1159, add:

```tsx
  // A Fracture map selection is a PreviewScope id, so it is either `source:<id>`
  // or a fragment id — which is exactly what lets one selection mean either.
  const fractureSource = fractureSelectedId?.startsWith("source:")
    ? sources.find((source) => source.id === fractureSelectedId.slice("source:".length))
    : undefined;
  const fractureFragment = fractureSelectedId && !fractureSelectedId.startsWith("source:")
    ? activeFragments.find((fragment) => fragment.id === fractureSelectedId)
    : undefined;
```

- [ ] **Step 2: Build the inspector**

Replace `inspector={null}` in the Task 9 render block with a `LibraryCard`, mirroring how the existing map inspector at lines 1342-1362 builds one.

Note the `item` shape: `LibraryItem` in `app/features/library/library-items.ts:13-15` is `{ kind: "source"; id: string; source: SourceFile }` or `{ kind: "fragment"; id: string; fragment: Fragment }` — **the `id` field is required and is easy to omit**. For a source it is `` `source:${source.id}` ``, matching `libraryItemsFrom` at line 23 and matching the `PreviewScope` id, which is why the same string works as both.

```tsx
        inspector={fractureFragment
          ? <LibraryCard
              item={{ kind:"fragment", id:fractureFragment.id, fragment:fractureFragment }}
              isSelected
              isPreviewing={previewingId === fractureFragment.id}
              previewProgress={previewingId === fractureFragment.id ? previewProgress : null}
              sourceNameFor={sourceNameFor}
              sourceForId={sourceForId}
              linkSummaryFor={linkSummaryFor}
              fragmentAudioFor={fragmentAudioFor}
              onSelect={() => {}}
              onPreview={() => previewSingle(fractureFragment)}
              onSeek={(ratio) => previewSingle(fractureFragment, ratio)}
              onOpenMatches={() => openMatchesForFragment(fractureFragment.id)}
              onOpenInfo={() => openLibraryInfo(fractureFragment.id)}
            />
          : fractureSource
            ? <LibraryCard
                item={{ kind:"source", id:`source:${fractureSource.id}`, source:fractureSource }}
                isSelected
                isPreviewing={previewingId === `source:${fractureSource.id}`}
                previewProgress={previewingId === `source:${fractureSource.id}` ? previewProgress : null}
                sourceNameFor={sourceNameFor}
                sourceForId={sourceForId}
                linkSummaryFor={linkSummaryFor}
                fragmentAudioFor={fragmentAudioFor}
                onSelect={() => {}}
                onPreview={() => previewSource(fractureSource)}
                onSeek={(ratio) => previewSource(fractureSource, ratio)}
                onOpenMatches={() => openMatchesForSource(fractureSource.id)}
                onOpenInfo={() => openLibraryInfo(fractureSource.id)}
              />
            : null}
```

The prop names must match `app/features/library/library-card.tsx:22-46`. If they differ from the above, the file wins — read it and match it.

Selection deliberately does not stop playback: `onSelect` in Task 9 only sets state, so clicking a neighbouring dot swaps the card while the current audio keeps going, which is what makes comparing two nearby assets possible. `navigate()` stops audio on leaving the view and `Escape` stops it on demand.

- [ ] **Step 3: Test by hand**

Run: `npm run dev:all`

Verify all five:
1. Click a dot from a library source → the card appears and Play plays that slice.
2. Click a dot for a whole source → Play plays the recording, not its first fragment.
3. Click a seed dot → Play plays that seed file.
4. Click a second dot while the first is playing → the card swaps and playback continues until the new Play is pressed.
5. Switch to Library and back → audio stopped, selection cleared.

Point 2 is the one that has broken three times before, for three different reasons. If it plays the wrong audio, read the `sourceSupportsSlicing` note in `AGENTS.md` before changing anything.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add app/fragments-app.tsx
git commit -m "Play a Fracture map asset from its card

Reuses the app's existing centralized playback handlers through props, the way
LibraryView already does, so there is no fourth copy of the preview machinery."
```

---

## What is deliberately not built

- **Voronoi cells.** The visual goal. Spec section 9 records the plan: `d3-delaunay`, `voronoi([0,0,w,h]).cellPolygon(i)` for clipped border cells, filled with the pitch-class colour. Tasks 5 and 7 have already done the de-collision and whole-take collapse the cells depend on.
- **Damped Lloyd relaxation.** Only if Task 9 Step 5 shows clumping.
- **Affinity edges as an overlay.** The existing Map already draws them.
- **Pan and zoom.** `app/map-layout.mjs` has the camera helpers, written and tested but unwired.
- **A frozen projection basis.** `fitProjection` returns the basis as a value and `projectOne` consumes it, so persisting it later is a storage decision and not a rewrite.
