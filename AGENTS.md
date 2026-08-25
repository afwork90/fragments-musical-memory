# Working in this repository

Fragments is an Electron desktop app for slicing recordings into a musical
fragment library. The renderer is React 19 built by vinext/Vite. There is no
database: every source is a directory on disk holding the copied audio plus a
`source.json`.

## The loop

```bash
npm run check      # typecheck + lint + unit tests. Run this before you finish.
npm run dev:all    # renderer + Electron with hot reload
npm test           # unit + packaged-HTML smoke test. Slower; run before packaging.
```

`npm run check` must pass and must stay fast. If you make it slow, that is a
regression.

## Where the work is planned

This repository is mid-refactor. Two documents govern:

- `docs/superpowers/plans/2026-08-24-modular-refactor-and-agent-readiness.md` —
  the task-by-task refactor plan.
- `docs/operation-plan.md` — the verified baseline, corrections to that plan,
  decisions taken, and the wave order. **Read this one first**; where the two
  disagree, the operation plan wins.

`docs/handoff-context.md` is institutional memory: what broke and what was
decided while building the library. Read it before changing persistence,
affinities, key/BPM display, or playback.

## Conventions

- **One definition site.** A type describing something on disk lives in
  `lib/domain/`. A type describing something a component renders lives in
  `lib/view/`. Do not redeclare either.

 `lib/view/` is `vocabulary.ts` (the shared closed unions), `fragment.ts`,
 `source-file.ts`, `relationship.ts`, `analysis.ts` (`MeasuredSummary`, the
 display-shaped subset of `MeasuredAnalysis`), and `search.ts` (weights and
 tolerances plus their defaults). They are pure types with no imports beyond
 each other.
  The two forms are deliberately separate rather than duplicated: the disk allows
  a `MusicalRole` of `"Unclassified"`, which the UI translates before display, and
  view types are display-shaped (`duration` is a formatted string, `key` is a
  human label like "Likely C minor").
- **Types are plain.** Prefer `type X = { ... }` and explicit unions. No
  generics, conditional types, branded types, or `satisfies` acrobatics. If a
  type takes more than a few seconds to read, simplify it.
- **Validation is hand-rolled and lives beside the type.** No schema library.
- **No invented data.** If analysis did not produce a BPM or key, persist
 `null` and render `—`. Never synthesise a plausible-looking value.
- **UI copy addresses whoever is using the app, not whoever is building it.** No
 `npm` commands, script names, or file paths in the interface. Two empty states
 told a musician to run `npm run analyze -- --write`; the commands live in this
 file and in `docs/`, and the UI says what is true of their audio instead.
- **`any` is a bug at the IPC boundary.** Use the typed `window.fragments`
  declaration, not a cast.
- **Disk beats cache.** Persisted `source.json` analysis is authoritative;
  preview/quick analysis in the renderer cache is not. Never let the cache
  overwrite a hand-corrected value.

### Imports in dually-compiled modules

Modules under `lib/domain/`, `lib/ipc/`, `lib/view/`, and `lib/affinity/` are
compiled twice: by `tsc -p electron/tsconfig.json` into `electron-dist/`
(CommonJS, run by Node) and by Vite into the renderer bundle. Therefore:

1. **Use relative specifiers, not the `@/` alias**, for any *value* import.
   `tsc` does not rewrite path aliases, so `@/lib/view/source-view` emits a
   specifier Node cannot resolve.
2. **Omit file extensions** in relative imports. Vite will not resolve
   `./paths.js` to `paths.ts`.
3. **No `node:*` imports** (they reach the browser bundle) and **no DOM
   globals** (they reach Node).

These mistakes fail at runtime only — neither typecheck nor lint catches them.
The unit tests import from `electron-dist/`, which is what actually catches them.

## Tests: thin on purpose

Unit-test pure modules only — `lib/domain/`, `lib/view/`, `lib/affinity/`,
`app/map-layout.mjs`. These run in about a second and are worth keeping green.
`npm run test:unit` builds Electron first because those tests import from
`electron-dist/`; do not optimise that away.

Do **not** add component tests, hook tests, or an Electron end-to-end harness,
and do not assert on the text of source files. A test that reads
`app/fragments-app.tsx` and regex-matches it was deleted for breaking on every
rename while asserting nothing about behaviour. Interactive behaviour is
verified by running the app.

## Temporary lint suppressions

`eslint.config.mjs` carries scoped, commented suppressions, each naming the task
that removes it. They exist so `npm run check` is a trustworthy gate today
without hand-fixing code that a scheduled task deletes. **Do not add one without
the same treatment**, and do not let one outlive its task. Task 3 removed the
`no-explicit-any` and `ban-ts-comment` entries by making them unnecessary; the
remainder are `react-hooks/*` and `jsx-a11y/*`, owned by Tasks 5, 6, and 10.

## The domain and IPC boundary

`lib/domain/source-document.ts` is the on-disk contract and **must import
nothing** — it is compiled for Electron and bundled into the renderer, so no
`node:*` and no DOM. `paths.ts`, `atomic-write.ts`, and `library-service.ts`
alongside it are main-process only. Inside `lib/`, use extensionless relative
imports; inside `electron/`, keep the `.js` suffix.

**The preload is bundled, and it has to be.** The window is created with
`sandbox: true`, and a sandboxed preload does not get Node's module resolver — its
`require` serves `electron` and a few built-ins, so a relative specifier fails with
`module not found: ../lib/ipc/contract.js`. The failure is nearly invisible: one line
in the Electron log, the window opens regardless, `window.fragments` is never
defined, and `getFragmentsBridge()` falls back to the HTTP bridge meant for the
browser. Under `dev:all` that bridge loads the real library from the dev server, so
the app looks completely normal while every write silently does nothing — which is
how it went unnoticed from the Task 3 refactor until a delete button refused to
appear. `electron/bundle-preload.mjs` runs after `tsc` in `build:electron` and emits
one self-contained file; `tests/unit/preload-bundle.test.mjs` asserts nothing else
crept into it. Do not "fix" a preload import error by turning the sandbox off.

Renderer/main traffic goes through `lib/ipc/contract.ts`. Adding a call means
adding it to `FragmentsBridge`, wiring it in `electron/preload.ts` (typed as
`FragmentsBridge`, so a mismatch is a compile error), handling the channel in
`electron/persistence.ts`, **and** implementing it in
`lib/web/library-bridge.ts` — the compiler will tell you if you forget.

There are two hosts behind that one contract:

- **Electron**, over IPC, with everything enabled.
- **The browser**, over HTTP, served by the Vite plugin in
  `lib/dev/library-dev-server.ts`, which reads the *same* library folder using the
  *same* `createLibraryService`. Read-only.

Get the bridge from `getFragmentsBridge()` in `lib/web/bridge.ts`, never from
`window.fragments` directly, and **branch on `bridge.capabilities`, not on whether
a bridge exists**. `import`, `persist`, and `drag` are separate capabilities.
Treating presence as "we are in Electron" is what forced the prototype dataset to
double as the web build's data source.

`lib/web/` and `lib/dev/` are outside the Electron build on purpose: one uses DOM
globals, the other `node:*`. Do not import either from `lib/ipc/` or `lib/domain/`.

There is currently **no `any` and no `@ts-nocheck`** in `app/`, `lib/`,
`electron/`, or `types/`. Keep it that way: at an untrusted boundary take
`unknown` and narrow. `MeasuredAnalysis` has no index signature on purpose, so
reading a new extractor feature means declaring it there first.

## Measuring audio

`lib/analysis/` is host-agnostic and compiled twice, like `lib/domain/`: no
`node:*`, no DOM, extensionless relative imports.

- `wav.ts` decodes linear PCM (16/24/32-bit, any channel count) to a mono
 `Float32Array`. It takes bytes, so every host can use it. It walks the chunk
 list rather than assuming a 44-byte header — real recordings carry `bext` and
 `junk` chunks before `data`. Its 24-bit path shifted the low byte away for
 months, a quiet 0.8% error that nothing caught because the only test used values
 whose low bytes were zero; a round trip through `wav-encode.ts` found it.
- `resample.ts` brings everything to `FEATURE_SAMPLE_RATE` (22050).
  **This is mandatory, not tidiness.** Mel filterbanks and chroma bins are defined
  in terms of the sample rate, so identical audio at 48kHz and 22.05kHz yields
  different MFCC and HPCP numbers. The library mixes rates. Features are only
  comparable when they were measured at the same rate, which is why
  `featureSampleRate` is persisted alongside them.
- `features.ts` owns the essentia parameters and framing, with essentia
  **injected** — Node and the browser load different bundles.

Both hosts run `extractFeatures`, so the app and `npm run analyze` cannot report
different numbers for the same audio; verified by measuring one recording through
each path and comparing. The renderer needs no extra bundle: `EssentiaExtractor`
extends `Essentia`, so the instance it already loads exposes the whole core
algorithm surface as `.algorithms`. The browser decodes via `decodeAudioData`,
which is what makes MP3, M4A, and FLAC work in the app; the Node script handles
WAV only and says so rather than guessing.

Run a batch pass with `npm run analyze` (reports, writes nothing) or
`node scripts/analyze-library.mjs --write`. It writes through
`updateSourceAnalysis`, the same path the app uses, and refuses to overwrite an
analysis whose `provenance.origin` is `"edited"` unless given `--force`.

**ffmpeg is an optional dependency of that script.** With it on PATH the script
decodes every format; without it, WAV only, and it says so per file rather than
guessing. Do not make it required — the app must work without it.

Measured on 90 seconds at 22050Hz, the whole pass is about 7.5 seconds, and it is
worth knowing where that goes before adding a descriptor: the framewise loop
(MFCC, HPCP, centroid, flatness) 2.9s, `RhythmExtractor2013` 2.3s,
`SuperFluxExtractor` 1.0s, `LoudnessEBUR128` 0.7s, `Intensity` 0.4s,
`KeyExtractor` 0.14s, `DynamicComplexity` 0.04s, `RMS` 0.01s. Anything that needs a
spectrum belongs **inside** the existing loop, where the spectrum already exists —
flatness there is a few milliseconds, and 0.4s as a separate pass.

Never hand essentia an unbounded signal. `windowForFeatures` caps at
`FEATURE_MAX_SECONDS` (90) and both hosts use it, so they cannot report different
numbers for the same file. It returns a **copy**, not a `subarray`: a view keeps its
whole backing buffer alive. Exceeding the WASM heap gets the process `SIGKILL`ed —
exit 137, no stack, nothing to catch, because an Emscripten abort is not a JS
exception.

Essentia's own type declarations are misleading in ways that only fail at runtime.
`types/essentia.d.ts` is hand-written for this reason — do not replace it with
`any`:

- **Pass every parameter.** The bindings have no defaults despite `core_api.d.ts`
  marking them optional. `Windowing(frame, true, 2048, "hann")` throws.
- **`vectorToArray` throws on an empty vector,** so "found no onsets" is
  indistinguishable from a crash unless guarded.
- **The `.es.js` bundles cannot load in Node** (they reference `__dirname`); use
  `essentia-wasm.umd.js`, which *is* the Emscripten module — vector helpers on the
  module, algorithms on its `EssentiaJS` class. There is no `FrameGenerator`
  there, so frame by hand.
- **Emscripten throws bare numbers** for C++ aborts, so catch clauses cannot
  assume an `Error`.
- **Use `RhythmExtractor2013`, not `PercivalBpmEstimator`.** Percival octave-errors
  badly: 198.8 against a true 100 on a library recording, and a repeated 215.3
  across unrelated files.
- **Check `bpmConfidence` before trusting a BPM.** Short or unrhythmic audio
  characteristically returns a plausible tempo at confidence 0.
- **`LoudnessVickers` and `ReplayGain` abort at anything but 44100Hz,** so they are
  unusable here: the pipeline resamples to 22050. `LoudnessEBUR128` works, and takes
  two channels — ours is mono into both, which reads about 3dB hot but is consistent
  across every fragment, which is what comparison needs.
- **`StartStopSilence` returns an empty object** — no `start`, no `stop`. Trimming is
  hand-rolled in `features.ts` for that reason.
- **`GapsDetector` finds nothing.** It is documented as framewise with state carried
  across calls via `configure()`/`reset()`, which the JS bindings do not expose, so
  every call starts over and no gap ever spans frames: zero gaps on every recording
  in the library. A hand-rolled envelope count is not the answer either — it swung
  from 0 to 17 gaps on one recording across a 10dB span of threshold, which makes it
  a knob, not a measurement. Leading and trailing silence is the part that holds
  still, and that is what is measured and shown.

## Waveforms

`lib/analysis/peaks.ts` measures peaks **per second** (`PEAKS_PER_SECOND`, 200),
never a fixed count per file. A fixed count — the old scheme stored 512 — makes
resolution fall as duration rises, so a two-second fragment of a six-minute
recording resolved to two points while the same cut from a ten-second take got
forty. Since this app is mostly used on fragments, that is the difference between
a waveform and a smear.

Peaks are **min/max pairs**, not absolute magnitude. Real waveforms are not
symmetric about zero, and the renderer will eventually draw both extremes; the
file already carries what it needs, so that change requires no regeneration.
`magnitudes()` collapses a range to the 0–100 values today's components draw.

There are three places peaks come from, and callers should prefer them in this
order — `useSourceWaveform` and the audio cache are interchangeable, both being
whole-source at the same rate, so either can be sliced to a fragment:

1. **Decoded audio in the renderer cache** (`ProcessedAudio.peaks`). Exact, but
   the file has to be decoded first.
2. **The sidecar** (`useSourceWaveform`). One small fetch, no decode.
3. **`source.json`'s 512-point thumbnail.** The only form small enough to live in
   a document that is parsed for every source on every `listSources()` and
   rewritten whole on every metadata edit. Never persist high-resolution peaks
   there — persist `ProcessedAudio.thumbnail`.

The sidecar is `sources/<id>/waveform.bin`: a 16-byte header (magic `FRWV`,
version, peaks-per-second, point count, sample rate) then interleaved Int16
min/max, written with the same rename-into-place discipline as `source.json`. At
roughly 800 bytes per second of audio, a six-minute recording costs ~140KB.
**A missing sidecar is normal, not an error** — return `null` and fall back.

Both hosts generate it, because neither can do it alone. `scripts/analyze-library.mjs`
writes one for every WAV it decodes, but Node has no MP3 decoder, so
**a source with no sidecar measures its own on first display**: `loadSourceWaveform`
decodes the audio through `decodeAudioData` — the only decoder in the stack that
handles every format the app accepts — writes the result, and never repeats it.

Do not put that backfill on an import-only path. Playback uses an `<audio>`
element, not Web Audio, so nothing else ever decodes an already-imported source;
a backfill hanging off `bindSourceAudio` alone reaches new imports only and leaves
every existing source pinned to its thumbnail. Decodes are serialised through one
queue so a library with no sidecars yet does not open an `AudioContext` per card.

Do not add a `Math.max(floor, ...)` to peak values. Drawing silence as a small
non-zero bar is the same invented data as a fabricated BPM, in visual form.

## Affinities

`lib/affinity/` is pure and compiled twice, like `lib/domain/`. `compare.ts` scores
one pair of fragments axis by axis, `generate.ts` decides which pairs are worth
recording, and `score.ts` ranks them for display.

**A metric axis is nullable, and `null` is not zero.** This is the rule the whole
slice is built around. Essentia returns a plausible BPM at `bpmConfidence` 0 for
unrhythmic audio, and 12 of the library's 26 fragments come back exactly that way,
so for them the tempo relationship is genuinely unknown. Scoring it 0 asserts
"completely different tempo", which is false and drags the pair down; scoring it
high is invented. Both `generationSimilarity` and `similarityOf` take a weighted
mean over the axes that are present and shrink the denominator to match. Never
coerce an absent axis to a number, and never filter on one without a null check —
the match filter did read `metrics.pitch` as 0 and silently hid every candidate
whose key was not measurable.

There is **no `melody` axis**. Nothing in `lib/analysis/` extracts pitch contour,
so it could only ever have held a fabricated number. Add it back when something
measures it, and not before.

Each axis compares one measurement, and the reasoning is in the comments beside it:
chroma by cosine (scale-invariant, so voicing and level do not matter), MFCC by
cosine **skipping coefficient 0** because it tracks loudness rather than timbre,
centroid and onset density in **octaves** because both are heard ratiometrically,
key on the circle of fifths, tempo allowing **half and double time** because that is
the same pulse and essentia octave-errors in exactly that way.

**Not everything measured is an axis, and that is deliberate.** Spectral flatness and
dynamic complexity are axes: one is where a sound sits between tonal and noise-like,
the other is whether a performance breathes, and both are properties of the playing.
Loudness, intensity, and silence are measured and shown but **not** scored — loudness
is the gain something was recorded at, which a fader fixes, so ranking fragments as
related because they were recorded at the same level is a claim about the session and
not about the music.

An axis has to be scaled to the range the data occupies or it is a constant bonus
dressed up as evidence. Flatness is already 0..1, but real recordings only use about
0.16 to 0.30 of it, so a raw difference put every pair above 0.86; `FLATNESS_TOLERANCE`
is what makes it discriminate. Check the spread before adding an axis.

**Fragments must be measured individually.** `FragmentDocument.analysis` exists for
this. If fragments inherit their source's features, every fragment of one recording
carries identical numbers and scores as a perfect match for its siblings — which is
indistinguishable from a working scorer until you read the output.
`scripts/analyze-library.mjs` slices each fragment from the decoded signal at the
native rate and resamples per fragment.

**And they must be *displayed* individually**, which is a separate bug with the same
shape. `fragmentKeyLabels` reads the fragment's own key and falls back to its source
only when the fragment was never measured; it used to be the other way round, so a
card, the search text, the key filter, and the sort all showed every fragment of a
D major recording as D major while the transform console — measuring per fragment —
correctly called one of them F# minor. Two views of the same fragment disagreeing is
how it was found. Route any new key display through that helper.

A card also **dims a BPM whose `bpmConfidence` is below `MIN_BPM_CONFIDENCE`**, with a
tooltip, for the same reason: nothing matches tempo to it, so presenting it like a
measurement makes the console's refusal look arbitrary. Import the threshold from
`lib/analysis/features`; do not mirror it. That module is already in the renderer
bundle and pulls in nothing essentia-facing.

Generation is **deterministic**: same fragments in, same relationships out, with the
same ids. `relationshipIdFor` sorts the pair, because ids are what the user's
auditioned/preferred/rejected marks hang off and renumbering them on a rebuild
would reassign somebody's judgement to a different pair. For the same reason
`build-affinities.mjs` only replaces relationships whose `origin` is
`"algorithmic"`.

Same-source pairs are never related — two slices of one take are trivially similar
and would fill every list. A pair needs at least `MIN_MEASURED_AXES` measured axes,
because one axis is not evidence.

Thresholds are set against the measured spread, not chosen as round numbers.
Cross-source similarities run 0.36 to 1.00 with a median of 0.66, so
`MIN_SIMILARITY` is 0.70: about a quarter survive, which is few enough that a
relationship existing is itself information. Re-derive it if the library changes
character rather than nudging it.

```bash
npm run analyze -- --write      # measure sources and fragments
npm run affinities              # report what would be generated
npm run affinities -- --write   # persist
```

Note that a generated relationship joins two library fragment ids, so
`isLibraryRelationship` treats it as curated and the tolerance sliders do **not**
filter it further. The generation threshold is the only filter it passes.

## Matching a candidate to an anchor

`lib/affinity/transform.ts` turns two measured fragments into the change that would
let one sit with the other: a tempo ratio, a semitone shift, both nullable. It is
the only place those numbers come from. Before it existed the transform console
showed hand-written values from `app/prototype-data.ts` and moved no audio at all.

- **Essentia cannot stretch or shift.** Its JS surface has `Resample` and
 `ResampleFFT`, which move pitch and duration together, and the spectral-model
 analysis/synthesis pairs (`SprModelAnal`/`Synth`, `HpsModelAnal`). There is no
 `PitchShift` and no `TimeStretch`. Building one on the sinusoidal model needs
 framewise state across calls, which these bindings do not expose — the same
 limitation that made `GapsDetector` useless.
- **Tempo matching in playback is free.** Playback is an `<audio>` element, and
 Chromium's `preservesPitch` defaults to true, so `playbackRate` time-stretches at
 good quality with no library and nothing cached. This is why auditioning a tempo
 match needs no render. It has no equivalent offline:
 `AudioBufferSourceNode.playbackRate` is varispeed, with no `preservesPitch`, so
 an `OfflineAudioContext` cannot reuse that stretcher.
- **Half and double time are folded out before stretching**, matching
 `TEMPO_RATIOS` in `compare.ts`, so a 70 against a 147 is a 5% nudge and not a
 doubling. What remains is capped by `MAX_STRETCH` (1.25) and refused beyond it: 40
 against 120 is 3:1, where the closest doubling still needs a 1.5× stretch.
 **That cap is not `TEMPO_TOLERANCE`**, and reusing it was a mistake worth not
 repeating — the axis asks whether two fragments are already at the same tempo,
 while a match exists to bring them there, so gating the match on the axis is
 circular and left the library with zero matches. The cap is a quality limit:
 where a stretch stops sounding like the same performance. The library has two
 pairs with a trustworthy tempo at both ends, 19% and 39% apart, and it admits the
 first.
- **Pitch is computed but off by default.** Shifting a candidate to the anchor's key
 changes the harmonic relationship the pair was ranked on, so the console opens at
 zero and offers the shift; it does not apply it. The shift is the shortest chromatic
 path (±6), not the circle-of-fifths distance `pitchSimilarity` scores: a fifth is a
 *near* relationship, but moving seven semitones is a bigger move than five down.
 A mode clash is reported, because no shift fixes it.
- **`MAX_SHIFT` (4) is where a shift stops being advice**, the pitch counterpart to
 `MAX_STRETCH`, and quality-based for a related reason: SoundTouch shifts by
 resampling and stretching back, so formants travel with the note and a large move
 is heard as processing. Past the bound `pitchRecommended` is false while `semitones`
 stays put — the console says "not recommended", explains itself, and still lets
 someone apply it. Across the library the shortest paths are 0(×9) 1(×4) 2(×2) 3(×2)
 4(×2) 5(×6), so this advises nineteen pairs and declines six.

The console is two rows, each `from → to` with the change between them as the only
editable number, because a measurement and the control that moves it are one thing.
There is no Original/Transformed toggle: a row equal to what was measured *is* the
original, so what is heard and what a drag hands over cannot drift apart. There is
no time interpretation, beat offset, or repeat control either — nothing measured or
applied them, and the one pulse reinterpretation that is real is already folded into
`tempoRatio` (the row then reads 140 → 144 against an anchor at 72, which the note
explains).

## Rendering audio

`lib/audio/render-match.ts` is the only thing in the app that writes audio, and
`lib/analysis/wav-encode.ts` the only thing that encodes it (24-bit, so a file
headed for a DAW is not quantised on the way out). Renders live in
`sources/<id>/renders/`, so they are archived and deleted with the source they came
from, and are capped per source because every distinct target BPM is a file.

The filename **is** the cache key — fragment, slice in milliseconds, ratio, shift,
and `RENDER_VERSION`. Bump that constant when the DSP changes; mtimes cannot
invalidate a render whose inputs are unchanged.

Rendering happens in the renderer, for the same reason waveforms do: `decodeAudioData`
is the only decoder in the stack that reads every format the app accepts. **A missing
render is normal** — pruned, or never written because the host cannot persist — and
callers fall back to the untransformed slice. The web preview renders in memory and
keeps nothing, which is enough for playback.

`soundtouchjs` does the stretching and shifting (LGPL-2.1, worth knowing if this
ever ships commercially; `paulstretch.js` is the wrong tool — it is built for
8×-and-beyond smearing, an effect, where these matches are a few percent). Verified
against tones: a 5% stretch holds 440Hz at 439.4, a shift lands within a few cents,
onsets stay aligned within 4ms, and two seconds of audio takes about 10ms. Two traps:

- **It only processes a full input buffer** (16384 frames) and exposes no flush, so
 a source that simply runs out loses its last three quarters of a second — a
 two-second tone came back at 26724 of 42000 frames. The fix is to keep feeding
 silence and trim the output to the length the ratio implies.
- **Its own `WebAudioBufferSource` reads past the end of a channel** without
 checking, which writes `undefined` into a `Float32Array` — a NaN, straight into
 the encoder. Hence the hand-written source in `render-match.ts`.

Dragging a fragment used to hand the OS the **whole recording**, because a source id
is all the main process had to resolve. `DragTarget.renderFile` is what fixes that:
the render is the slice. A name that no longer exists falls back to the source, so a
drag always delivers something.

## Slice ownership

Feature work should touch one slice. If your change needs to edit a shared
file, that is a signal to check whether the abstraction is wrong — or to
coordinate, because someone else is probably in there.

<!-- Task 8 fills in the ownership table here. -->
