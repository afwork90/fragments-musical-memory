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
  `source-file.ts`, `relationship.ts`, and `search.ts` (weights and tolerances
  plus their defaults). They are pure types with no imports beyond each other.
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
  `junk` chunks before `data`.
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

## Slice ownership

Feature work should touch one slice. If your change needs to edit a shared
file, that is a signal to check whether the abstraction is wrong — or to
coordinate, because someone else is probably in there.

<!-- Task 8 fills in the ownership table here. -->
