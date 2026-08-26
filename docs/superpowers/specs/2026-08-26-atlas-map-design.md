# Atlas — a map placed by measured features

A second map tab, beside the existing one, where every audio asset in the library
is a point whose position comes from what analysis measured rather than from a
hand-written table of roles.

The existing Map stays exactly as it is. It places fragments by a `ROLE_TONAL`
lookup on the X axis and a spectral centroid — or, for the seed data, a
hand-written `brightness` number — on the Y axis. That was the right thing for a
demo. It is not a similarity map, and nothing about it should be edited to become
one.

## Scope

In scope, in this order:

1. Real measurements for the seed audio, and MFCC reaching the renderer.
2. A feature vector and a 2D projection, with a verification report.
3. The Atlas tab: a labelled scatter with clickable nodes.
4. Click a node, the bottom panel shows its card and plays it.

Deliberately deferred, and not designed here beyond the hooks that make them
easy later:

- **Voronoi cells.** The visual goal, but it depends on the layout being good
  first, and a labelled scatter answers that question. Section 8 records what the
  layout work must leave in place so the cells can be added without rework.
- **Affinity edges as an overlay.** The existing Map already draws them; nothing
  is learned by drawing them twice before the layout is settled.
- **Pan and zoom.** `app/map-layout.mjs` already has `fitMapCamera`,
  `zoomMapCameraAt`, `panMapCamera` and `clampMapCamera`, written and tested but
  never wired to any UI. If the Atlas wants a camera, that is where it comes
  from — do not write a second one.

## Why PCA, and not the UMAP pipeline in `docs/audio-map-prototype.md`

That document specifies `features → robust scaling → PCA → UMAP → 2D`. The
feature and scaling stages are sound and are reused here. UMAP is dropped, for
two reasons.

The corpus is too small for it. With 57 assets, `nNeighbors` has to be around 6,
`minDist` is guesswork, and the likeliest outcome is a single blob that took a
day to tune.

More importantly, PCA delivers layout stability for free, and that was the
explicit requirement. PCA is a linear projection: a mean vector and two loading
vectors. `umap-js` has no `transform()`, so any change to the corpus forces a
full re-fit, and a fresh UMAP layout is arbitrarily rotated, reflected and scaled
relative to the old one. Correcting that is the entire Procrustes-alignment stage
of the older document. PCA deletes that stage.

The cost is real and accepted: PCA finds only linear structure, so clusters will
be less crisply separated than UMAP's. For a map whose job is to be navigable and
to look like something, that is the right trade.

The affinity graph was also considered as the layout and rejected. There are 34
relationships across 25 real fragments, 30 of them inside a single source, and
same-source pairs are excluded from generation by design — so several fragments
are isolated vertices and a graph layout would fling the components apart. The
edges are a good overlay. They are not a position.

## 1. Assets

An asset is anything playable: **a source or a fragment, treated alike**. Both
carry a `MeasuredAnalysis` on disk and a `MeasuredSummary` in the view types, and
both already have a `PreviewScope` builder.

| Origin | Count today | Analysis comes from |
|---|---:|---|
| Library sources | 4 | `SourceDocument.analysis`, via `SourceFile.measured` |
| Library fragments | 25 | `FragmentDocument.analysis`, via `Fragment.measured` |
| Seed fragments | 28 | `SEED_ANALYSIS`, new (section 2) |

About 57 points. A source and a fragment that spans its whole take measure almost
identically, and two of the four library sources are like that, so the layout
must handle near-coincident points (section 5).

`lib/map/asset.ts` declares the one type the rest of the slice consumes:

```ts
export type AtlasAsset = {
  id: string;            // PreviewScope id: fragment id, or `source:<id>`
  label: string;
  kind: "source" | "fragment";
  role: MusicalRole | null;  // for colour only, never for position
  analysis: MeasuredSummary;
};
```

Position never reads `role`. That is the difference between this map and the old
one.

`role` is null for sources: `SourceFile` has no `MusicalRole` — a whole recording
is not one part — it has `sourceTypes` instead. Sources render in a neutral
colour, slightly larger than a fragment, which also reads as the useful
distinction of "the whole take" against "a slice of it".

Archived assets are excluded, and so are fragments in `duplicateExclusions`,
matching what the existing map already filters. Relationship status is irrelevant
here because no edges are drawn.

## 2. Real measurements for the seed audio

The 28 files in `public/audio/f*.wav` are real, distinct audio: 6 seconds each,
mono 16-bit at 22050 Hz, spanning RMS 0.04 to 0.33 and zero-crossing rate 187 to
10,348 per second. They can be measured rather than guessed, which means the
Atlas has exactly one way of placing a point and no invented coordinates
anywhere.

They are linear-PCM WAV, which is what the Node decoder in `lib/analysis/wav.ts`
handles, so no ffmpeg is required.

**`scripts/compute-prototype-analysis.mjs`** decodes each file, resamples to
`FEATURE_SAMPLE_RATE`, runs the same `extractFeatures` the library uses, and
writes `app/prototype-analysis.json` as `Record<string, MeasuredSummary>` keyed
by seed fragment id. It borrows its file-walking and JSON-writing shape from
`scripts/compute-prototype-waveforms.mjs` and its essentia and WAV-decoding setup
from `scripts/analyze-library.mjs`, which already does exactly this against the
library. Registered as `npm run compute-analysis`, which builds Electron first
because it imports from `electron-dist/`, the same as `analyze` and `affinities`.
It is run by hand and its output is committed, exactly like the waveforms.

`extractFeatures` returns the disk shape, `MeasuredAnalysis`, and the file needs
the view shape — they differ in that the summary carries `onsetsPerSecond` where
the analysis carries an `onsets` array, and flattens `provenance`. The renderer's
`measuredSummaryFrom` does that conversion but lives in `app/fragments-app.tsx`
and cannot be imported by a Node script. The script therefore repeats that small
mapping rather than moving a function out of a shared file for the sake of seed
data that is being retired. The duplication is deliberate and is deleted with the
script.

`app/prototype-data.ts` exports it as `SEED_ANALYSIS`.

**It is deliberately not attached to `Fragment.measured`.** A seed fragment's
`bpm`, `key` and `brightness` fields are fake and are shown on its card, in the
table, and in the filters. Attaching real measurements to the same objects would
make a card read "A minor · 92 BPM" while its detail panel reported something
else measured from the same file — two views of one fragment disagreeing, which
is the exact failure mode `docs/handoff-context.md` records for key labels. So
the Atlas resolves analysis through one fallback:

```ts
const analysis = fragment.measured ?? SEED_ANALYSIS[fragment.id] ?? null;
```

Retiring the seed data later means deleting the script, the JSON, that line, and
the `SEED_ANALYSIS` export. Nothing else.

### `timbre` on `MeasuredSummary`

`MeasuredSummary` omits the 13 MFCC means on purpose — its own comment explains
that they are a direction in a space with no names for its axes, so there is no
honest way to print them. That reasoning holds for printing. The Atlas projects
them rather than printing them, and MFCC is the strongest timbre evidence in the
analysis, so it has to reach the renderer.

Add one optional field to `lib/view/analysis.ts`, amend the file comment to say
why it is carried but never shown, and pass it through `measuredSummaryFrom` in
`app/fragments-app.tsx` (line 117). Both `Fragment.measured` and
`SourceFile.measured` then have what the Atlas needs, so **no new state is added
to `fragments-app.tsx`**.

This change is safe because every existing consumer reads named fields —
`source.measured?.centroidHz` in `source-table.tsx` and `source-list.ts`,
`matchesMeasuredFilters` in `library-list.ts`, `MeasuredBlock` in
`source-detail-panel.tsx`, `fragment.measured.bpmConfidence` in
`library-card.tsx`. Nothing enumerates the type's keys, so no table column,
filter, sort, or panel row changes.

## 3. The feature vector

`lib/map/feature-vector.ts` turns one `MeasuredSummary` into a `number[]` and
exposes the dimension names alongside it, so the report in section 4 and the axis
labels in section 6 can say which measurement drove what.

Three groups, following `docs/audio-map-prototype.md`, which is right that
grouping is not optional: without it the 24 harmony-and-timbre dimensions
silently drown the 8 that describe character.

| Group | Dimensions | Count | Weight |
|---|---|---:|---:|
| Harmony | `chroma`, all 12 bins | 12 | 1.0 |
| Timbre | `timbre` coefficients 1–12 | 12 | 1.0 |
| Character | log2 `centroidHz`, `flatness`, `dynamicComplexity`, log2(1 + `onsetsPerSecond`), log2 `bpm`, `keyStrength`, `intensity`, `loudnessRange` | 8 | 1.5 |

32 dimensions. The weights live as three named constants in one place so they can
be moved against the section 4 report.

MFCC coefficient 0 is skipped because it tracks loudness rather than timbre,
which is the same reason `timbreSimilarity` in `lib/affinity/compare.ts` skips
it, and it is worth seeing why in the data: across the library it runs about −600
to −870 while every other coefficient is inside ±200.

`centroidHz`, `onsetsPerSecond` and `bpm` are log-scaled because all three are
heard ratiometrically — the same argument `compare.ts` makes for comparing them
in octaves.

Onset density uses `log2(1 + x)` rather than `log2(x)` for a specific reason: 8
of the 25 library fragments have an empty `onsets` array, so their density is
genuinely 0, and `log2(0)` is `-Infinity`. Zero onsets is a real measurement — a
drone — not a missing one, so it must not be imputed, and it must not be given an
arbitrary floor either. `log2(1 + x)` is monotone, maps 0 to 0, and invents
nothing.

**Excluded, and why.** `lufs` and `rms` are the gain something was recorded at,
which a fader fixes; placing two assets near each other because they were
recorded at the same level is a claim about the session and not about the music.
This mirrors the axes `compare.ts` measures but refuses to score. `key` and
`scale` are categorical, and `chroma` already carries the harmony without
committing to a label.

### Nulls

A metric axis is nullable and null is not zero — but PCA cannot take a hole.

After centering, a missing dimension is imputed with the corpus median for that
dimension, which is the origin of that axis. The asset then contributes nothing
to that direction, rather than asserting a value it does not have. Zero-filling
before centering would instead place it at an arbitrary extreme.

This matters most for tempo: 13 of 25 library fragments have a `bpmConfidence`
below `MIN_BPM_CONFIDENCE`, so their BPM is not trustworthy. `bpm` is read as
null whenever confidence is below that threshold, which is the same gate
`tempoSimilarity` applies. Import the threshold from `lib/analysis/features`;
do not mirror the number.

Each asset records how many of its 32 dimensions were imputed. The Atlas dims a
node whose vector was mostly imputed, so a point placed on thin evidence does not
look as settled as one placed on a full measurement.

### Scaling, and the invariant that protects the rest of the app

Per dimension, across the corpus: subtract the median, divide by the IQR, clip to
±4. Robust scaling rather than z-scoring, because these distributions are skewed
and two outliers would otherwise flatten everything else. Then L2-normalise
within each group and multiply by the group weight.

**A dimension whose IQR is zero is dropped, not divided by.** This is not
hypothetical: `intensity` takes only the three values −1, 0 and 1, so if most
assets share one value its IQR is 0 and dividing produces `Infinity` or `NaN`
across the whole matrix. A constant dimension carries no information anyway, so
dropping it loses nothing — and the section 4 report names which dimensions were
dropped, because a dimension that keeps getting dropped should be reconsidered
rather than silently tolerated.

**Scaling never leaves `lib/map/`.** It runs on a numeric copy built from
`MeasuredSummary` and is never written back to a `Fragment`, a `SourceFile`, a
`MeasuredSummary`, or anything on disk. The only change to a shared type in this
whole design is the additive optional `timbre` field. Table columns, filters,
sorts, and the detail panel keep reading the same unscaled values they read
today.

## 4. Projection

`lib/map/projection.ts`. PCA to two components, hand-rolled in about 60 lines:
covariance matrix of the scaled matrix, then power iteration with deflation for
the top two eigenvectors. No new numeric dependency, deterministic, and testable
against a matrix with a known answer. `ml-pca` is the fallback if this
misbehaves; it is pure JS and would be a drop-in.

Two details that are cheap and prevent real ugliness:

**Sign-fix each component** by forcing its largest-magnitude loading positive. An
eigenvector's sign is arbitrary, so without this the map can mirror itself
between runs for no reason at all — which would throw away the stability that
motivated choosing PCA.

**No RNG anywhere.** Power iteration starts from a fixed deterministic vector,
not a random one. Same assets in, identical coordinates out, verified by a test
that projects twice and asserts exact equality.

The basis is recomputed from the whole corpus every time the Atlas opens. It is
not persisted. Adding an asset therefore nudges every position slightly rather
than leaving them untouched; that was chosen over freezing the basis, and the
sign fix is what keeps the nudge small instead of catastrophic. Freezing remains
available later — it is the mean vector plus two loading vectors, and
`projectOne(vector, basis)` is the function that would consume it, so the
projection module should expose the basis as a value rather than hiding it.

### `npm run atlas` — the verification report

A Node script, alongside `npm run analyze` and `npm run affinities` and built the
same way, that prints:

- Explained variance for the first several components. If PC1 and PC2 together
  hold more than 80%, the feature set is under-diversified and the report says
  so.
- The top loadings of PC1 and PC2 by dimension name — which measurement is
  actually driving each axis.
- The five nearest neighbours of five assets, by name, in feature space. Reading
  this by eye catches what no metric will: if a drone's nearest neighbours are
  all drums, the bug is in section 3, not in the projection.
- The count of imputed dimensions per asset, the range each raw dimension
  occupies, and any dimension dropped for having a zero IQR. An axis whose spread
  is tiny is a constant dressed as evidence — the same problem
  `FLATNESS_TOLERANCE` exists to solve in `compare.ts`.

This runs before any UI is built. It is how we find out whether the vector is
worth plotting.

## 5. Layout

`lib/map/spread.ts` takes raw projected coordinates and returns screen
coordinates.

**De-collision.** Points closer than a small epsilon are separated by a tiny
offset derived from a hash of the asset id, reusing the `stableHash` approach
already in `app/map-layout.mjs`. Deterministic, so it is stable across runs. This
is needed for the scatter, not only for the eventual cells: two dots at the same
pixel means one of them cannot be clicked. It is also what a source and its
whole-take fragment will hit.

**Fit to bounds** with padding, reusing `MAP_WORLD`'s dimensions and padding so
the two maps share a coordinate space and the existing camera helpers stay
applicable.

Relaxation is deferred with the cells (section 8).

## 6. The Atlas tab

Three edits to `app/fragments-app.tsx`, and nothing more:

1. `View` gains `"atlas"` (line 69).
2. A nav button beside Map (line 1199), labelled "Atlas".
3. A render block mounting `<AtlasView>`, beside the existing `view === "map"`
   block.

`navigate()` needs no change: it already clears overlays and stops audio, and the
Atlas keeps its selection in its own state.

Everything else is new: `app/features/atlas/atlas-view.tsx`. The old map is
inline in a 1400-line file, which is the reason it cannot be extended and the
reason this one is not built the same way.

`AtlasView` takes props only — `assets`, the selected id, and the preview
handle from section 7. It does not call `getFragmentsBridge()` itself.

`app/features/atlas/atlas-assets.ts` builds that `AtlasAsset[]` from the
abstractions `fragments-app.tsx` already maintains — `activeFragments` and
`sourceFiles` — which is what keeps the seed data and the library data on one
path. It is also the single place the `SEED_ANALYSIS` fallback appears, and it
lives under `app/` rather than `lib/map/` precisely because it is the one module
that touches seed data.

Pass 3 renders: a dot per asset, coloured by role using the existing `.role-*`
classes, sized by nothing yet, labelled with the asset name, dimmed when its
vector was mostly imputed. Axis captions derived from the top loadings, so PC1
reads as something like "darker ← → brighter" rather than "PC1". A node is a
`<button>` so it is reachable by keyboard, like the existing map's nodes.

Styling goes in a new section of `app/globals.css` beside the existing `.map-*`
rules, matching how the app already works — there are no CSS modules in this
repo.

## 7. Click to play

Clicking a node selects the asset and shows the existing `LibraryCard` in a
bottom panel, the way the current map's `.map-inspector` does.

`AGENTS.md` is explicit that the preview machinery is inlined in three components
already — `fragments-app.tsx`, the workbench, and the affinities modal — and that
a fourth means extracting the hook first. The Atlas is the fourth. So this pass
extracts `usePreviewScope` from `fragments-app.tsx`, covering `previewingId`,
`previewProgress`, `previewAudio`, `previewScopeRef`, `previewSessionRef`,
`startPreviewScope` and `stopAllAudio`, and the Atlas is its first consumer.

The other three call sites are migrated to the hook in the same pass, or the
extraction has made things worse rather than better.

Playback keys on `PreviewScope.id`, never on a fragment id. Fragment assets go
through `buildFragmentPreviewScope`, source assets through
`buildSourcePreviewScope`, which returns `source:<id>` — this is exactly the case
that type exists for, and it is why the Atlas can treat sources and fragments as
one kind of thing. Seed assets have a `/audio/` URL, so they are already a slice
and `sourceSupportsSlicing` refuses to clip into them; the builders handle that
and the Atlas must not second-guess them.

## 8. What the deferred Voronoi pass needs

Recorded so the layout work does not have to be redone.

`d3-delaunay` is the intended library — pure JS, one dependency plus its own
`delaunator`. `Delaunay.from(points).voronoi([0, 0, w, h]).cellPolygon(i)`
returns polygons already clipped to the bounds, which is the border-cell problem
that should not be reinvented. Cells render as SVG `<path>` filled by role,
reusing the colours from pass 3.

Two things pass 3 must leave in place:

- **De-collision must already be done**, because coincident points produce
  degenerate cells. It is in scope above for its own reasons.
- **`spread.ts` must be able to iterate.** If the scatter shows the assets
  clumping — plausible, since the 28 seed files may occupy a small region while
  the 4 library sources sit outside it — cell areas will be wildly uneven. The
  fix is a fixed, small number of damped Lloyd relaxation iterations, each point
  moving a fraction of the way toward its cell centroid, which evens out areas
  without tearing neighbourhoods and stays deterministic. Whether it is needed is
  a question the scatter answers, which is the reason the scatter comes first.

## Testing

`lib/map/` is pure, which is the one category `AGENTS.md` permits unit tests for,
and these run in milliseconds:

- `feature-vector`: dimension count and order are stable; a null field is imputed
  to the axis origin rather than to zero; a BPM below `MIN_BPM_CONFIDENCE` is
  read as absent; the imputed count is right.
- `projection`: exact determinism across two runs; a known-answer check on a
  small matrix with obvious principal axes; the sign fix produces the same
  orientation from a sign-flipped input.
- `spread`: no two outputs coincide; everything lands inside the bounds; the same
  input gives the same output.

No component tests, no hook tests, and no assertions on the text of source files.
Whether the map looks good is verified by looking at it, and whether the
neighbours make sense is verified by the section 4 report.

`npm run check` must stay fast.

## Files

New:

```
lib/map/asset.ts
lib/map/feature-vector.ts
lib/map/projection.ts
lib/map/spread.ts
app/features/atlas/atlas-assets.ts
app/features/atlas/atlas-view.tsx
app/prototype-analysis.json          (generated, committed)
scripts/compute-prototype-analysis.mjs
scripts/atlas-report.mjs
tests/unit/map-feature-vector.test.mjs
tests/unit/map-projection.test.mjs
tests/unit/map-spread.test.mjs
```

Changed:

```
lib/view/analysis.ts        + optional `timbre`, amended comment
app/fragments-app.tsx       View union, nav button, render block,
                            measuredSummaryFrom passes timbre,
                            preview machinery extracted to a hook
app/prototype-data.ts       + SEED_ANALYSIS export
app/globals.css             + .atlas-* rules
package.json                + compute-analysis and atlas scripts
```

Untouched, on purpose: `app/map-layout.mjs`, the existing Map render block, and
every affinity module.

## Modules under `lib/map/`

These are pure and will be compiled twice — by `tsc -p electron/tsconfig.json`
for the report script and by Vite for the renderer — so the dually-compiled rules
in `AGENTS.md` apply: relative specifiers rather than the `@/` alias, no file
extensions, no `node:*`, no DOM globals. Neither typecheck nor lint catches these;
the unit tests, which import from `electron-dist/`, do.
