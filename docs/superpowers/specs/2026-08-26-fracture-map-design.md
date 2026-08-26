# Fracture map — a map placed by measured features

A second map tab, beside the existing one, where every audio asset in the library
is a point whose position comes from what analysis measured rather than from a
hand-written table of roles.

The existing Map stays exactly as it is. It places fragments by a `ROLE_TONAL`
lookup on the X axis and a spectral centroid — or, for the seed data, a
hand-written `brightness` number — on the Y axis. That was the right thing for a
demo. It is not a similarity map, and nothing about it should be edited to become
one.

The tab is called **Fracture map**, which also names the eventual visual: cells,
like fragments of something broken apart.

## Scope

In scope, in this order:

1. Library-shaped documents for the seed audio, and MFCC reaching the renderer.
2. A feature vector and a 2D projection, with a verification report.
3. The Fracture map tab: a labelled scatter with clickable nodes.
4. Click a node, the bottom panel shows its card and plays it.

Deliberately deferred, and not designed here beyond the hooks that make them
easy later:

- **Voronoi cells.** The visual goal, but it depends on the layout being good
  first, and a labelled scatter answers that question. Section 9 records what the
  layout work must leave in place so the cells can be added without rework.
- **Affinity edges as an overlay.** The existing Map already draws them; nothing
  is learned by drawing them twice before the layout is settled.
- **Pan and zoom.** `app/map-layout.mjs` already has `fitMapCamera`,
  `zoomMapCameraAt`, `panMapCamera` and `clampMapCamera`, written and tested but
  never wired to any UI. If this map wants a camera, that is where it comes from —
  do not write a second one.

## Why PCA, and not the UMAP pipeline in `docs/audio-map-prototype.md`

That document specifies `features → robust scaling → PCA → UMAP → 2D`. The
feature and scaling stages are sound and are reused here. UMAP is dropped, for
two reasons.

The corpus is too small for it. With about 55 assets, `nNeighbors` has to be
around 6, `minDist` is guesswork, and the likeliest outcome is a single blob that
took a day to tune.

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

An asset is anything playable, and **sources and fragments are treated without
distinction** — both are audio files as far as this map is concerned. Both carry a
`MeasuredAnalysis` on disk and a `MeasuredSummary` in the view types, and both
already have a `PreviewScope` builder.

`lib/map/asset.ts` declares the one type the rest of the slice consumes:

```ts
export type MapAsset = {
  /** PreviewScope id: a fragment id, or `source:<id>`. */
  id: string;
  label: string;
  /** Only ever used to pick a PreviewScope builder. Never affects position or appearance. */
  kind: "source" | "fragment";
  analysis: MeasuredSummary;
  /** Seconds. Not a feature — a fragment's length is not a property of its sound. */
  duration: number;
};
```

There is no `role` field, for reasons in section 3, and nothing about a point's
appearance depends on `kind`.

### Whole-take collapse

**A fragment covering 98% or more of its source's duration replaces that source,
rather than sitting beside it.** They are the same audio, so they measure almost
identically, and two points on top of each other is a redundant cell in the
eventual Voronoi and an unclickable dot before that.

This is not an edge case. Two of the four library sources are exactly this
(`synth-rec_OBX.wav` at 9.5s and `song1.wav` at 56.6s, each with one fragment
spanning 100%), and every one of the 28 seed files will be too, since each becomes
a source with a single whole-take fragment (section 2).

The fragment is kept and the source dropped, because fragments are what
affinities, transforms and renders attach to throughout the app.

| Origin | Points |
|---|---:|
| Library sources, less two collapsed | 2 |
| Library fragments | 25 |
| Seed audio, one per file after collapse | 28 |
| **Total** | **55** |

Archived assets are excluded, and so are fragments in `duplicateExclusions`,
matching what the existing map already filters. Relationship status is irrelevant
here because no edges are drawn.

## 2. The seed audio becomes library-shaped data

The 28 files in `public/audio/f*.wav` are real, distinct audio: 6 seconds each,
mono 16-bit at 22050 Hz, spanning RMS 0.04 to 0.33 and zero-crossing rate 187 to
10,348 per second. They can be measured rather than guessed, which means the map
has exactly one way of placing a point and no invented coordinates anywhere.

They are linear-PCM WAV, which is what the Node decoder in `lib/analysis/wav.ts`
handles, so no ffmpeg is required.

Rather than invent a bespoke seed format, **the script emits real
`SourceDocument`s** — one per wav, each with a single whole-take fragment,
measured by the same `extractFeatures` the library uses. This is the point of
doing it this way: the seed data stops being a special case, and retiring it later
is a file move rather than a refactor.

**`scripts/compute-prototype-sources.mjs`**, registered as `npm run seed-docs`,
writes two things:

- `public/audio/library-ready/<id>/source.json` — one directory per file, in
  exactly the library's on-disk layout, so the whole tree can be dropped into
  `~/Documents/Fragments Library/sources/`. A `--install` flag does that move
  directly, copying the wav in alongside its document.
- `app/prototype-sources.json` — the same documents as one array, imported at
  build time by the renderer. One bundled import rather than 28 runtime fetches,
  which is how `prototype-waveforms.json` already works.

Both outputs are generated together, committed together, and deleted together.
The script builds Electron first because it imports from `electron-dist/`, the
same as `analyze` and `affinities`, and it borrows its essentia and WAV-decoding
setup from `scripts/analyze-library.mjs`, which already does exactly this against
the library.

**The generated documents contain nothing invented.** Measured analysis, the
filename, duration, sample rate, content hash, and a waveform thumbnail — all
derived from the file. None of the seed fragments' fake display metadata (their
hand-written names, keys, BPMs, or roles) is written. `AGENTS.md` forbids writing
seed data to `source.json` because Task 4a had to remove a path that persisted
invented BPM and key derived from a hash; measured values are the opposite case,
and these documents are valid library documents precisely because nothing in them
is made up.

### Keeping the app's seed identities intact

The app's seed fragments (`f01`…`f28`) carry fake `name`, `key`, `bpm` and `role`
fields, and those are what the Library list, the table, the filters and the cards
render today. The generated documents do not replace them. `prototype-data.ts`
exports a mapping from seed fragment id to its generated document, and the map
resolves analysis through one fallback:

```ts
const analysis = fragment.measured ?? SEED_ANALYSIS[fragment.id] ?? null;
```

Attaching the real measurements to the seed `Fragment` objects instead would make
a card read "A minor · 92 BPM" while its detail panel reported something else
measured from the same file — two views of one fragment disagreeing, which is the
exact failure mode `docs/handoff-context.md` records for key labels.

This is one step short of the end state, which is importing these 28 documents for
real and deleting `prototype-data.ts` entirely — the second half of Task 4b. The
`--install` flag exists so that step is a single command when you want it.

### `timbre` on `MeasuredSummary`

**The 13 MFCC means are already persisted.** Every fragment and every source in
the library carries a 13-element `timbre` array in `source.json`; `extractFeatures`
has been writing it all along. Nothing needs to be written back.

The gap is in the view layer. `MeasuredSummary` omits `timbre` on purpose — its
own comment explains that the coefficients are a direction in a space with no
names for its axes, so there is no honest way to print them. That reasoning holds
for printing. This map projects them rather than printing them, and MFCC is the
strongest timbre evidence in the analysis, so it has to reach the renderer.

Add one optional field to `lib/view/analysis.ts`, amend the file comment to say
why it is carried but never shown, and pass it through `measuredSummaryFrom` in
`app/fragments-app.tsx` (line 117). Both `Fragment.measured` and
`SourceFile.measured` then have what the map needs, so **no new state is added to
`fragments-app.tsx`**.

This change is safe because every existing consumer reads named fields —
`source.measured?.centroidHz` in `source-table.tsx` and `source-list.ts`,
`matchesMeasuredFilters` in `library-list.ts`, `MeasuredBlock` in
`source-detail-panel.tsx`, `fragment.measured.bpmConfidence` in
`library-card.tsx`. Nothing enumerates the type's keys, so no table column,
filter, sort, or panel row changes behaviour.

## 3. Why not colour by role

`role` is not measured, and for real library data it is not even varied. All 25
fragments on disk have `primaryRole: "Unclassified"`, and `displayRole()` in
`app/fragments-app.tsx` (line 105) renders that as `"Texture"`. So every real
fragment is one colour, while the 28 seed fragments have hand-written roles spread
across all six values.

Colouring by role would therefore make the fake data look structured and the real
data look uniform — precisely backwards, and it would be read as a finding about
the audio.

**Colour comes from the strongest chroma pitch class instead**: measured, twelve
distinct hues, musically legible, and `strongestPitchClassIndex` already exists in
`app/features/sources/source-list.ts`. An asset with no chroma gets a neutral
colour rather than a guessed hue.

Size encodes nothing in pass 3. Duration is on `MapAsset` for labelling, not for
geometry — how long a fragment is is not a property of how it sounds, and letting
it drive size would say otherwise.

## 4. The feature vector

`lib/map/feature-vector.ts` turns one `MeasuredSummary` into a `number[]` and
exposes the dimension names alongside it, so the report in section 5 and the axis
labels in section 7 can say which measurement drove what.

Three groups, following `docs/audio-map-prototype.md`, which is right that
grouping is not optional: without it the 24 harmony-and-timbre dimensions
silently drown the 8 that describe character.

| Group | Dimensions | Count | Weight |
|---|---|---:|---:|
| Harmony | `chroma`, all 12 bins | 12 | 1.0 |
| Timbre | `timbre` coefficients 1–12 | 12 | 1.0 |
| Character | log2 `centroidHz`, `flatness`, `dynamicComplexity`, log2(1 + `onsetsPerSecond`), log2 `bpm`, `keyStrength`, `intensity`, `loudnessRange` | 8 | 1.5 |

32 dimensions. The weights live as three named constants in one place so they can
be moved against the section 5 report. They are inherited from the older document
and are untuned against real data — expect to change them.

MFCC coefficient 0 is skipped because it tracks loudness rather than timbre,
which is the same reason `timbreSimilarity` in `lib/affinity/compare.ts` skips it,
and it is worth seeing why in the data: across the library it runs about −600 to
−870 while every other coefficient is inside ±200.

`centroidHz`, `onsetsPerSecond` and `bpm` are log-scaled because all three are
heard ratiometrically — the same argument `compare.ts` makes for comparing them in
octaves.

Onset density uses `log2(1 + x)` rather than `log2(x)` for a specific reason: 8 of
the 25 library fragments have an empty `onsets` array, so their density is
genuinely 0, and `log2(0)` is `-Infinity`. Zero onsets is a real measurement — a
drone — not a missing one, so it must not be imputed, and it must not be given an
arbitrary floor either. `log2(1 + x)` is monotone, maps 0 to 0, and invents
nothing.

**Excluded, and why.** `lufs` and `rms` are the gain something was recorded at,
which a fader fixes; placing two assets near each other because they were recorded
at the same level is a claim about the session and not about the music. This
mirrors the axes `compare.ts` measures but refuses to score. `key` and `scale` are
categorical, and `chroma` already carries the harmony without committing to a
label. Duration is excluded per section 3.

### Nulls

A metric axis is nullable and null is not zero — but PCA cannot take a hole.

After centering, a missing dimension is imputed with the corpus median for that
dimension, which is the origin of that axis. The asset then contributes nothing to
that direction, rather than asserting a value it does not have. Zero-filling
before centering would instead place it at an arbitrary extreme.

This matters most for tempo: 13 of 25 library fragments have a `bpmConfidence`
below `MIN_BPM_CONFIDENCE`, so their BPM is not trustworthy. `bpm` is read as null
whenever confidence is below that threshold, which is the same gate
`tempoSimilarity` applies. Import the threshold from `lib/analysis/features`; do
not mirror the number.

Each asset records how many of its 32 dimensions were imputed. The map dims a node
whose vector was mostly imputed, so a point placed on thin evidence does not look
as settled as one placed on a full measurement.

### Scaling, and the invariant that protects the rest of the app

Per dimension, across the corpus: subtract the median, divide by the IQR, clip to
±4. Robust scaling rather than z-scoring, because these distributions are skewed
and two outliers would otherwise flatten everything else. Then L2-normalise within
each group and multiply by the group weight.

**A dimension whose IQR is zero is dropped, not divided by.** This is not
hypothetical: `intensity` takes only the three values −1, 0 and 1, so if most
assets share one value its IQR is 0 and dividing produces `Infinity` or `NaN`
across the whole matrix. A constant dimension carries no information anyway, so
dropping it loses nothing — and the section 5 report names which dimensions were
dropped, because one that keeps getting dropped should be reconsidered rather than
silently tolerated.

**Scaling never leaves `lib/map/`.** It runs on a numeric copy built from
`MeasuredSummary` and is never written back to a `Fragment`, a `SourceFile`, a
`MeasuredSummary`, or anything on disk. The only change to a shared type in this
whole design is the additive optional `timbre` field. Table columns, filters,
sorts, and the detail panel keep reading the same unscaled values they read today.

## 5. Projection

`lib/map/projection.ts`. PCA to two components, hand-rolled in about 60 lines:
covariance matrix of the scaled matrix, then power iteration with deflation for the
top two eigenvectors. No new numeric dependency, deterministic, and testable
against a matrix with a known answer. `ml-pca` is the fallback if this misbehaves;
it is pure JS and would be a drop-in.

Two details that are cheap and prevent real ugliness:

**Sign-fix each component** by forcing its largest-magnitude loading positive. An
eigenvector's sign is arbitrary, so without this the map can mirror itself between
runs for no reason at all — which would throw away the stability that motivated
choosing PCA.

**No RNG anywhere.** Power iteration starts from a fixed deterministic vector, not
a random one. Same assets in, identical coordinates out, verified by a test that
projects twice and asserts exact equality.

The basis is recomputed from the whole corpus every time the map opens. It is not
persisted. Adding an asset therefore nudges every position slightly rather than
leaving them untouched; that was chosen over freezing the basis, and the sign fix
is what keeps the nudge small instead of catastrophic. Freezing remains available
later — it is the mean vector plus two loading vectors, and `projectOne(vector,
basis)` is the function that would consume it, so the projection module should
expose the basis as a value rather than hiding it.

### `npm run fracture` — the verification report

A Node script, alongside `npm run analyze` and `npm run affinities` and built the
same way, that prints:

- Explained variance for the first several components. If PC1 and PC2 together
  hold more than 80%, the feature set is under-diversified and the report says so.
- The top loadings of PC1 and PC2 by dimension name — which measurement is
  actually driving each axis.
- The five nearest neighbours of five assets, by name, in feature space. Reading
  this by eye catches what no metric will: if a drone's nearest neighbours are all
  drums, the bug is in section 4, not in the projection.
- The count of imputed dimensions per asset, the range each raw dimension
  occupies, and any dimension dropped for having a zero IQR. An axis whose spread
  is tiny is a constant dressed as evidence — the same problem
  `FLATNESS_TOLERANCE` exists to solve in `compare.ts`.

This runs before any UI is built. It is how we find out whether the vector is
worth plotting.

## 6. Layout

`lib/map/spread.ts` takes raw projected coordinates and returns screen
coordinates.

**De-collision.** Points closer than a small epsilon are separated by a tiny
offset derived from a hash of the asset id, reusing the `stableHash` approach
already in `app/map-layout.mjs`. Deterministic, so it is stable across runs. This
is needed for the scatter, not only for the eventual cells: two dots at the same
pixel means one of them cannot be clicked. The whole-take collapse in section 1
removes the systematic duplicates; this handles whatever remains.

**Fit to bounds** with padding, reusing `MAP_WORLD`'s dimensions and padding so
the two maps share a coordinate space and the existing camera helpers stay
applicable.

Relaxation is deferred with the cells (section 9).

## 7. The Fracture map tab

Three edits to `app/fragments-app.tsx`, and nothing more:

1. `View` gains `"fracture"` (line 69).
2. A nav button beside Map (line 1199), labelled "Fracture map".
3. A render block mounting `<FractureMapView>`, beside the existing
   `view === "map"` block.

`navigate()` needs no change: it already clears overlays and stops audio, and this
view keeps its selection in its own state.

Everything else is new, under `app/features/fracture-map/`. The old map is inline
in a 1400-line file, which is the reason it cannot be extended and the reason this
one is not built the same way.

`FractureMapView` takes props only — `assets`, the selected id, and the preview
handle from section 8. It does not call `getFragmentsBridge()` itself.

`fracture-map-assets.ts` builds the `MapAsset[]` from the abstractions
`fragments-app.tsx` already maintains — `activeFragments` and `sourceFiles` —
which is what keeps the seed data and the library data on one path. It applies the
whole-take collapse and is the single place the `SEED_ANALYSIS` fallback appears.
It lives under `app/` rather than `lib/map/` precisely because it is the one module
that touches seed data.

Pass 3 renders: a dot per asset, coloured by strongest chroma pitch class, labelled
with the asset name, dimmed when its vector was mostly imputed. Axis captions
derived from the top loadings, so PC1 reads as something like "darker ← → brighter"
rather than "PC1". A node is a `<button>` so it is reachable by keyboard, like the
existing map's nodes.

Styling goes in a new section of `app/globals.css` beside the existing `.map-*`
rules, matching how the app already works — there are no CSS modules in this repo.

## 8. Click to play

Clicking a node selects the asset and shows the existing `LibraryCard` in a bottom
panel, the way the current map's `.map-inspector` does.

`AGENTS.md` is explicit that the preview machinery is inlined in three components
already — `fragments-app.tsx`, the workbench, and the affinities modal — and that
a fourth means extracting the hook first. This is the fourth. So this pass extracts
`usePreviewScope` from `fragments-app.tsx`, covering `previewingId`,
`previewProgress`, `previewAudio`, `previewScopeRef`, `previewSessionRef`,
`startPreviewScope` and `stopAllAudio`, and the Fracture map is its first
consumer.

The other three call sites are migrated to the hook in the same pass, or the
extraction has made things worse rather than better.

Playback keys on `PreviewScope.id`, never on a fragment id. Fragment assets go
through `buildFragmentPreviewScope`, source assets through
`buildSourcePreviewScope`, which returns `source:<id>` — this is exactly the case
that type exists for, and it is why sources and fragments can be treated as one
kind of thing. Seed assets have a `/audio/` URL, so they are already a slice and
`sourceSupportsSlicing` refuses to clip into them; the builders handle that and
this map must not second-guess them.

## 9. What the deferred Voronoi pass needs

Recorded so the layout work does not have to be redone.

`d3-delaunay` is the intended library — pure JS, one dependency plus its own
`delaunator`. `Delaunay.from(points).voronoi([0, 0, w, h]).cellPolygon(i)` returns
polygons already clipped to the bounds, which is the border-cell problem that
should not be reinvented. Cells render as SVG `<path>`, filled with the pitch-class
colour from pass 3.

Two things pass 3 must leave in place:

- **De-collision and whole-take collapse must already be done**, because
  coincident points produce degenerate cells. Both are in scope above for their own
  reasons.
- **`spread.ts` must be able to iterate.** If the scatter shows the assets
  clumping — plausible, since the 28 seed files may occupy a small region while the
  library sources sit outside it — cell areas will be wildly uneven. The fix is a
  fixed, small number of damped Lloyd relaxation iterations, each point moving a
  fraction of the way toward its cell centroid, which evens out areas without
  tearing neighbourhoods and stays deterministic. Whether it is needed is a
  question the scatter answers, which is the reason the scatter comes first.

## Testing

`lib/map/` is pure, which is the one category `AGENTS.md` permits unit tests for,
and these run in milliseconds:

- `feature-vector`: dimension count and order are stable; a null field is imputed
  to the axis origin rather than to zero; a BPM below `MIN_BPM_CONFIDENCE` is read
  as absent; zero onset density survives as a real value; a zero-IQR dimension is
  dropped; the imputed count is right.
- `projection`: exact determinism across two runs; a known-answer check on a small
  matrix with obvious principal axes; the sign fix produces the same orientation
  from a sign-flipped input.
- `spread`: no two outputs coincide; everything lands inside the bounds; the same
  input gives the same output.

The whole-take collapse is tested where it lives, in `fracture-map-assets.ts` — it
is a pure function over `MapAsset[]` and worth one test, because it silently halves
the point count if it is wrong in either direction.

No component tests, no hook tests, and no assertions on the text of source files.
Whether the map looks good is verified by looking at it, and whether the
neighbours make sense is verified by the section 5 report.

`npm run check` must stay fast.

## Files

New:

```
lib/map/asset.ts
lib/map/feature-vector.ts
lib/map/projection.ts
lib/map/spread.ts
app/features/fracture-map/fracture-map-assets.ts
app/features/fracture-map/fracture-map-view.tsx
app/prototype-sources.json                    (generated, committed)
public/audio/library-ready/<id>/source.json   (generated, committed, 28 of them)
scripts/compute-prototype-sources.mjs
scripts/fracture-report.mjs
tests/unit/map-feature-vector.test.mjs
tests/unit/map-projection.test.mjs
tests/unit/map-spread.test.mjs
tests/unit/fracture-map-assets.test.mjs
```

Changed:

```
lib/view/analysis.ts        + optional `timbre`, amended comment
app/fragments-app.tsx       View union, nav button, render block,
                            measuredSummaryFrom passes timbre,
                            preview machinery extracted to a hook
app/prototype-data.ts       + SEED_ANALYSIS export
app/globals.css             + .fracture-* rules
package.json                + seed-docs and fracture scripts
```

Untouched, on purpose: `app/map-layout.mjs`, the existing Map render block, and
every affinity module.

## Modules under `lib/map/`

These are pure and will be compiled twice — by `tsc -p electron/tsconfig.json` for
the report script and by Vite for the renderer — so the dually-compiled rules in
`AGENTS.md` apply: relative specifiers rather than the `@/` alias, no file
extensions, no `node:*`, no DOM globals. Neither typecheck nor lint catches these;
the unit tests, which import from `electron-dist/`, do.
