# Modular Refactor and Agent Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working prototype into a modular, honestly-typed codebase where each feature slice lives in its own set of small files, so that new features — and parallel agents — can be added without editing shared hotspots.

**Architecture:** One typed domain layer (`lib/domain/`) owns the persisted `source.json` shape and is compiled for both the Electron main process and the renderer. A typed IPC contract (`lib/ipc/`) replaces `(window as any).fragments`. Pure view-model functions (`lib/view/`) turn source documents into what components render, eliminating the second parallel domain model. `app/fragments-app.tsx` shrinks from a 1284-line god component to a routing shell that composes three independent feature slices (`library`, `sources`, `affinities`), each owning its own state hook, components, and stylesheet.

**Tech Stack:** Electron 43, React 19, vinext/Vite, TypeScript 5.9 (strict), Node 22 `node:test`, Essentia.js, Tailwind v4 + shadcn.

## Global Constraints

- No new runtime dependencies. Validation stays hand-rolled; types are plain `type` aliases derived by hand from the same file as the validator. No Zod, no schema DSL, no generics gymnastics.
- One definition site per entity. If a type describes something on disk, it lives in `lib/domain/` and nothing redefines it.
- Delete `app/prototype-data.ts` and every fabricated datum. Where real data does not exist, the UI renders an empty state or `—`. Never invent BPM, key, bars, beats, confidence, or brightness.
- Affinities (Matches panel, Map, Combine workspace, duplicate takes) are gated behind a single build-time flag and are unreachable when off. Scoring logic must be pure and unit-testable.
- Test appetite is deliberately thin: unit tests cover `lib/domain/`, `lib/view/`, `lib/affinity/`, and `app/map-layout.mjs`. Components, hooks, and Electron wiring are covered by one HTML smoke test and manual verification only. Do not add a component-test framework.
- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Keep the existing visual design and navigation structure. This is a structural refactor, not a redesign.
- Preserve the on-disk `source.json` contract for fields that already exist. New fields are additive and optional on read.
- `npm run check` must stay under ~15 seconds. It is the single command an agent runs before declaring work done.
- Do not commit during execution unless the user explicitly requests commits.

### Import conventions for shared modules

Several modules under `lib/` are compiled twice: once by `tsc -p electron/tsconfig.json` into `electron-dist/` (CommonJS, run by Node) and once by Vite into the renderer bundle. That dual life imposes two rules, and getting them wrong produces runtime `Cannot find module` errors that neither typecheck nor lint catches.

1. **Use relative specifiers, not the `@/` alias, for any *value* import in a dually-compiled module.** `tsc` does not rewrite path aliases in its output, so `import { x } from "@/lib/view/source-view"` emits a specifier Node cannot resolve. `import type` is erased and therefore safe either way, but prefer relative imports throughout `lib/domain/`, `lib/ipc/`, `lib/view/`, `lib/affinity/`, and `lib/audio/preview/preview-scope.ts` so a later change from `import type` to `import` cannot break the build.
2. **Omit file extensions in relative imports inside `lib/`.** Vite will not resolve `./paths.js` to `paths.ts`. Files under `electron/` are main-process only and keep the existing `.js`-suffixed style.

Dually-compiled modules must also avoid `node:*` imports (they end up in the browser bundle) and DOM globals (they end up in Node). `lib/domain/source-document.ts`, `lib/ipc/contract.ts`, `lib/view/**`, and `lib/affinity/**` satisfy both constraints; `lib/domain/library-service.ts`, `paths.ts`, and `atomic-write.ts` are main-process only and may use `node:*`.

Each task that adds a dually-compiled directory also adds it to `electron/tsconfig.json`'s `include`. By the end of Task 6 that array is:

```json
  "include": [
    "./**/*.ts",
    "../lib/domain/**/*.ts",
    "../lib/ipc/**/*.ts",
    "../lib/view/**/*.ts",
    "../lib/affinity/**/*.ts",
    "../lib/audio/preview/preview-scope.ts",
    "../types/**/*.d.ts"
  ]
```

---

## Why these boundaries

Three files are currently *merge hotspots* — any two people or agents adding unrelated features both have to edit them:

| File | Lines | Why every change touches it |
| --- | --- | --- |
| `app/fragments-app.tsx` | 1284 | Holds ~40 `useState` hooks, the IPC load effect, the audio preview engine, affinity scoring, the map view, and the archive view |
| `app/globals.css` | 1026 | One stylesheet for every surface, with ~200 lines of dead rules |
| `app/prototype-data.ts` | 268 | The de-facto type module *and* the demo dataset, imported by 20+ files |

Breaking these three up is the core of this plan. Everything else follows from it.

---

## Target File Map

### Domain — the contract (changes rarely, review carefully)

- `lib/domain/source-document.ts`: `SourceDocument`, `FragmentDocument`, `MeasuredAnalysis`, `WaveformData`, `MusicalRole`, `SourceType`, plus the hand-rolled validators moved verbatim from `library-service.mjs`.
- `lib/domain/paths.ts`: `assertSafeSourceId`, `assertSafeRelativeFilename`, `resolveWithinDir`.
- `lib/domain/atomic-write.ts`: `atomicWriteJson`.
- `lib/domain/library-service.ts`: flat-file persistence, ported from `library-service.mjs`.
- `lib/ipc/contract.ts`: channel name constants and the `FragmentsBridge` interface.
- `types/fragments-bridge.d.ts`: `window.fragments` global declaration.
- `types/essentia.d.ts`: module shims for the three untyped `essentia.js` entry points.

### View models — document to pixels (pure, unit tested)

- `lib/view/source-view.ts`: `SourceView` + `sourceViewFromDocument`.
- `lib/view/fragment-view.ts`: `FragmentView` + `fragmentViewsFromDocument`.

### Affinity slice logic (pure, unit tested, flag-gated)

- `lib/affinity/types.ts`: `Affinity`, `AffinityMetrics`, `SearchWeights`, `MatchTolerances`, `SearchContext`.
- `lib/affinity/score.ts`: `scoreAffinity`.
- `lib/affinity/rank.ts`: `rankAffinities`.
- `lib/affinity/flag.ts`: `AFFINITIES_ENABLED`.

### Audio

- `lib/audio/preview/preview-scope.ts`: scope math (moved from `source-playback.ts`).
- `lib/audio/preview/use-preview.ts`: the single playback hook.
- `lib/audio/waveform/`: consolidated waveform components.

### App — feature slices (owned, edited independently)

- `app/fragments-app.tsx`: routing shell only.
- `app/state/use-library.ts`: the one owner of library data and persistence.
- `app/state/use-navigation.ts`: view, selection, and panel state.
- `app/features/library/**`, `app/features/sources/**`, `app/features/affinities/**`.
- `app/styles/tokens.css`, `shell.css`, `library.css`, `sources.css`, `affinities.css`, `workbench.css`.

### Tests

- `tests/unit/*.test.mjs`: fast, no renderer build required.
- `tests/smoke/rendered-html.test.mjs`: one packaged-HTML assertion set.

### Docs

- `AGENTS.md`: conventions, verification loop, and the slice ownership map.

---

### Task 1: Make verification fast and trustworthy

Nothing else in this plan is safe without this. Today `tsc` fails with 4 errors, `eslint` reports 78 errors that no gate enforces, and `npm test` runs a full renderer build before ~0.3s of real tests. An agent has no reliable signal for "am I done".

**Files:**
- Create: `types/essentia.d.ts`
- Create: `AGENTS.md`
- Modify: `lib/audio/use-audio-cache.ts:10-20`
- Modify: `eslint.config.mjs:11-17`
- Modify: `package.json:9-27`
- Modify: `tests/rendered-html.test.mjs` (delete lines 29-110)
- Move: `tests/library-service.test.mjs` → `tests/unit/library-service.test.mjs`
- Move: `tests/app-protocol.test.mjs` → `tests/unit/app-protocol.test.mjs`
- Move: `tests/rendered-html.test.mjs` → `tests/smoke/rendered-html.test.mjs`

**Interfaces:**
- Produces: `npm run typecheck`, `npm run test:unit`, `npm run test:smoke`, `npm run check`.
- Produces: `AGENTS.md` as the single entry point for conventions.

- [ ] **Step 1: Add the essentia.js module shims**

`lib/audio/essentia-loader.ts:1` imports three untyped entry points. Declare exactly the six members `lib/audio/essentia-analyze.ts` uses. Create `types/essentia.d.ts`:

```ts
// essentia.js ships no type declarations. Declare only the surface we call,
// so an accidental typo in an extractor name is still a compile error.

declare module "essentia.js/dist/essentia-wasm.es.js" {
  export const EssentiaWASM: { ready: Promise<void> };
}

declare module "essentia.js/dist/essentia.js-extractor.es.js" {
  export type EssentiaVector = { size(): number; get(index: number): unknown };

  export default class EssentiaExtractor {
    constructor(wasm: unknown);
    arrayToVector(input: Float32Array): unknown;
    vectorToArray(input: unknown): Float32Array;
    FrameGenerator(signal: unknown, frameSize: number, hopSize: number): EssentiaVector;
    melSpectrumExtractor(frame: Float32Array, sampleRate: number): number[];
    PercivalBpmEstimator(
      signal: unknown,
      frameSize: number,
      frameSizeOSS: number,
      hopSize: number,
      hopSizeOSS: number,
      maxBPM: number,
      minBPM: number,
      sampleRate: number,
    ): { bpm: number };
    KeyExtractor(
      signal: unknown,
      averageDetuningCorrection: boolean,
      frameSize: number,
      hopSize: number,
      hpcpSize: number,
      maxFrequency: number,
      maximumSpectralPeaks: number,
      minFrequency: number,
      pcpThreshold: number,
      profileType: string,
      sampleRate: number,
      spectralPeaksThreshold: number,
      tuningFrequency: number,
      weightType: string,
      windowType: string,
    ): { key: string; scale: string; strength: number };
  }
}
```

- [ ] **Step 2: Fix the `useEffect` cleanup return type**

`lib/audio/use-audio-cache.ts:14` returns `subscribeAudioCache(...)`, whose unsubscribe returns `boolean` (it is `Set.prototype.delete`). React requires a `void` destructor. Replace lines 10-20 with:

```ts
  useEffect(() => {
    setAudio(getCachedAudio(cacheKey));
    if (!cacheKey) return;

    const unsubscribe = subscribeAudioCache((updatedKey) => {
      const resolved = getCachedAudio(cacheKey);
      if (resolved?.cacheKey === updatedKey || updatedKey === cacheKey) {
        setAudio(resolved);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [cacheKey]);
```

- [ ] **Step 3: Run typecheck and verify it now passes**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: exit 0, no output. Before this task it printed 4 errors (3× `TS7016` in `essentia-loader.ts`, 1× `TS2345` in `use-audio-cache.ts`).

- [ ] **Step 4: Stop linting build output**

`eslint.config.mjs:11-17` omits `electron-dist/**`, which is why 19 of the 78 errors are `no-require-imports` in compiled JS. Replace the `globalIgnores` call with:

```js
  globalIgnores([
    ".next/**",
    ".vinext/**",
    "dist/**",
    "electron-dist/**",
    "out/**",
    "build/**",
    "release/**",
    "next-env.d.ts",
  ]),
```

The two hand-written CommonJS launchers legitimately use `require`. Append this block to the config array, after the existing `{ languageOptions... }` object:

```js
  {
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
```

- [ ] **Step 5: Delete the brittle source-string test**

`tests/rendered-html.test.mjs:29-110` is a single test named `"ships the complete staged musical corpus and interface data"` that reads 14 source files and makes ~60 regex assertions against their *text* — for example `assert.match(page, /advancedOpen/)` and `assert.match(data, /rel\("r33"/)`. It fails on any rename and asserts nothing about behaviour. It also blocks Task 4, which deletes `app/prototype-data.ts`.

Delete that entire `test(...)` block (lines 29-110). Keep the first test (`"renders the packaged Fragments shell"`, lines 18-27) and the third (`"keeps the musical map layout and camera math deterministic"`, lines 112-137).

- [ ] **Step 6: Split the test tree by speed**

Create `tests/unit/` and `tests/smoke/`, then move files:

```bash
mkdir -p tests/unit tests/smoke
git mv tests/library-service.test.mjs tests/unit/library-service.test.mjs
git mv tests/app-protocol.test.mjs tests/unit/app-protocol.test.mjs
git mv tests/rendered-html.test.mjs tests/smoke/rendered-html.test.mjs
```

Fix the now-wrong relative import paths: in `tests/unit/library-service.test.mjs` and `tests/unit/app-protocol.test.mjs`, change `../` prefixes to `../../`. In `tests/smoke/rendered-html.test.mjs`, change `../app/map-layout.mjs` to `../../app/map-layout.mjs` and `../dist/client/index.html` to `../../dist/client/index.html`.

- [ ] **Step 7: Add the script surface**

Replace the `scripts` block in `package.json:9-27` with:

```json
  "scripts": {
    "dev": "npm run dev:renderer",
    "dev:renderer": "vinext dev --port 3000",
    "dev:electron": "npm run build:electron && wait-on http://localhost:3000 && cross-env ELECTRON_RENDERER_URL=http://localhost:3000 node electron/launch.cjs",
    "dev:all": "concurrently -k \"npm:dev:renderer\" \"npm:dev:electron\"",
    "start:electron": "npm run build && node electron/launch.cjs",
    "build:renderer": "vinext build",
    "build:electron": "tsc -p electron/tsconfig.json && node electron/postbuild.cjs",
    "build": "npm run build:renderer && npm run build:electron",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "test:unit": "npm run build:electron && node --test tests/unit/",
    "test:smoke": "npm run build && node --test tests/smoke/",
    "test": "npm run test:unit && npm run test:smoke",
    "check": "npm run typecheck && npm run lint && npm run test:unit",
    "compute-waveforms": "node scripts/compute-prototype-waveforms.mjs",
    "seed-library": "node scripts/seed-library.mjs",
    "pack": "npm run build && npm run prepack-electron && electron-builder --dir",
    "dist": "npm run build && npm run prepack-electron && electron-builder",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && npm run prepack-electron && electron-builder --win --x64",
    "prepack-electron": "node scripts/prepack-electron.mjs",
    "clean:release:win": "node scripts/clean-release-win.mjs"
  },
```

Three notes on what changed and why:
- `lint` drops its `--ignore-pattern` flags because Step 4 moved them into the config, where the editor integration also reads them.
- `build:pages` is gone; it was a byte-for-byte duplicate of `build:renderer`. Task 2 repoints the workflow.
- `check` deliberately excludes `test:smoke`, because the smoke test needs a full `vinext build`. `check` is the loop; `test` is the gate before packaging.

- [ ] **Step 8: Fix remaining lint errors**

Run `npm run lint` and fix what is left. After Step 4 the `no-require-imports` and most `no-unused-vars` reports are gone. The `@typescript-eslint/no-explicit-any` reports are all at the domain boundary and are fixed by Tasks 3 and 4 — for each one, add a one-line pointer rather than an unconditional suppression:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed in Task 3 (lib/ipc/contract.ts)
```

Leave `@next/next/no-img-element` on `app/fragments-app.tsx:1094` alone; the brand logo is an inlined data URI and `next/image` is not in use.

- [ ] **Step 9: Write AGENTS.md**

This is the file that stops agents from guessing. Create `AGENTS.md` with the following content (the outer fence below is four backticks, so the nested three-backtick blocks are part of the file):

````markdown
# Working in this repository

Fragments is an Electron desktop app for slicing recordings into a musical
fragment library. The renderer is React 19 built by vinext/Vite. There is no
database: every source is a directory on disk holding the copied audio plus a
`source.json`.

## The loop

```bash
npm run check      # typecheck + lint + unit tests. Run this before you finish.
npm run dev:all    # renderer + Electron with hot reload
npm test           # check + packaged-HTML smoke test. Slower; run before packaging.
```

`npm run check` must pass and must stay fast. If you make it slow, that is a
regression.

## Conventions

- **One definition site.** A type describing something on disk lives in
  `lib/domain/`. A type describing something a component renders lives in
  `lib/view/`. Do not redeclare either.
- **Types are plain.** Prefer `type X = { ... }` and explicit unions. No
  generics, conditional types, branded types, or `satisfies` acrobatics. If a
  type takes more than a few seconds to read, simplify it.
- **Validation is hand-rolled and lives beside the type.** See
  `lib/domain/source-document.ts`. No schema library.
- **No invented data.** If analysis did not produce a BPM or key, persist
  `null` and render `—`. Never synthesise a plausible-looking value.
- **`any` is a bug at the IPC boundary.** Use `window.fragments` via the typed
  declaration in `types/fragments-bridge.d.ts`.

## Tests: thin on purpose

Unit-test pure modules only — `lib/domain/`, `lib/view/`, `lib/affinity/`,
`app/map-layout.mjs`. These run in about a second and are worth keeping green.

Do **not** add component tests, hook tests, or an Electron end-to-end harness,
and do not assert on the text of source files. Interactive behaviour is
verified by running the app.

## Slice ownership

Feature work should touch one slice. If your change needs to edit a shared
file, that is a signal to check whether the abstraction is wrong — or to
coordinate, because someone else is probably in there.

<!-- Task 8 fills in the ownership table here. -->
````

- [ ] **Step 10: Verify the whole loop**

Run:

```bash
npm run check
```

Expected: exit 0. Typecheck silent, lint clean, and 29 unit tests passing (21 from `library-service`, 8 from `app-protocol`) in roughly 1-2 seconds after the ~1s `build:electron`.

Run:

```bash
npm test
```

Expected: exit 0, with 2 additional smoke tests passing.

- [ ] **Step 11: Review checkpoint**

Confirm `npm run check` is the only command a reviewer needs. Commit only if the user explicitly requests it.

---

### Task 2: Delete dead weight

Every later task gets cheaper if there is less code to read. All of this is unreferenced.

**Files:**
- Delete: `python-backend/` (entire directory)
- Delete: `app/lib/`, `app/components/audio/`, `app/components/ui/` (empty directories)
- Modify: `app/features/library/library-list.ts:64-96`
- Modify: `lib/audio/audio-service.ts:274`
- Modify: `electron/tsconfig.json:12-16`
- Modify: `.github/workflows/deploy-gh-pages.yml:40`
- Modify: `.gitignore`
- Move: `docs/superpowers/plans/2026-08-22-electron-flat-file-audio-library.md` → `docs/archive/`
- Move: `docs/superpowers/specs/2026-08-22-conservative-repository-cleanup-design.md` → `docs/archive/`

- [ ] **Step 1: Remove the dead Python backend**

`python-backend/` is a Flask + SongFormer segmentation experiment. Nothing in `app/`, `lib/`, `electron/`, or `scripts/` references `python-backend`, `backend.py`, `SongFormer`, `/segment`, or its ports. Its two launchers even disagree about the port (`backend.py:65` uses 3001, `start.sh:2` uses 8000). It also has committed bytecode at `python-backend/__pycache__/backend.cpython-310.pyc`.

```bash
git rm -r python-backend
```

Add to `.gitignore` so stray bytecode never returns:

```gitignore
__pycache__/
*.pyc
```

- [ ] **Step 2: Remove empty directories and dead exports**

The three empty directories are leftovers from an abandoned `app/components/` layout:

```bash
rmdir app/lib app/components/audio app/components/ui
rmdir app/components
```

In `app/features/library/library-list.ts`, delete `filterLibraryFragments`, `sortLibraryFragments`, and `visibleLibraryFragments` (lines 64-96). They were superseded by `library-items.ts`, which handles unified source+fragment items, and nothing imports them.

In `lib/audio/audio-service.ts`, delete the exported `quickAnalyzeFile` (line 274). Nothing imports it; `quickAnalyzeCached` is the live path.

- [ ] **Step 3: Fix the stale Electron tsconfig includes**

`electron/tsconfig.json:12-16` includes `"../shared/**/*.ts"`, but `shared/` does not exist — it was planned and never built. It also includes `"../lib/domain/**/*.ts"`, which currently matches nothing because the domain is `.mjs`; Task 3 makes that line correct, so keep it. Replace the `include` array with:

```json
  "include": [
    "./**/*.ts",
    "../lib/domain/**/*.ts",
    "../lib/ipc/**/*.ts",
    "../types/**/*.d.ts"
  ]
```

- [ ] **Step 4: Repoint the Pages workflow**

`.github/workflows/deploy-gh-pages.yml:40` runs `npm run build:pages`, which Task 1 removed as a duplicate. Change that step's `run:` to:

```yaml
        run: npm run build:renderer
```

- [ ] **Step 5: Archive contradicted docs**

Two documents now describe a repository that does not exist and will actively mislead an agent that reads them:
- `docs/superpowers/plans/2026-08-22-electron-flat-file-audio-library.md:13` says "remove GitHub Pages" and line 78 says to delete the workflow — the workflow is still there and is the only CI job. Its target file map also lists `electron/library/*`, `shared/ipc.ts`, and `resources/seed-library.json`, none of which were created.
- `docs/superpowers/specs/2026-08-22-conservative-repository-cleanup-design.md` references `worker/`, `.openai/hosting.json`, and `drizzle/`, all already gone.

```bash
mkdir -p docs/archive
git mv docs/superpowers/plans/2026-08-22-electron-flat-file-audio-library.md docs/archive/
git mv docs/superpowers/specs/2026-08-22-conservative-repository-cleanup-design.md docs/archive/
```

Keep `docs/superpowers/specs/2026-08-22-electron-flat-file-audio-library-design.md` — its storage-layout description still matches reality.

Add a one-line header to each archived file so its status is obvious without reading it:

```markdown
> **Archived 2026-08-24.** Describes an earlier intended state. Superseded by
> `docs/superpowers/plans/2026-08-24-modular-refactor-and-agent-readiness.md`.
> Do not follow this document.
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run check
```

Expected: exit 0. Deleting unused exports and directories changes no behaviour.

Confirm nothing referenced what you deleted:

```bash
rg -n "python-backend|quickAnalyzeFile|visibleLibraryFragments|filterLibraryFragments|sortLibraryFragments|build:pages" --glob '!docs/archive/**'
```

Expected: no matches outside this plan document.

- [ ] **Step 7: Review checkpoint**

Report the line count removed. Commit only if the user explicitly requests it.

---

### Task 3: One typed domain and one typed IPC boundary

Right now the authoritative persistence layer is untyped JavaScript (`lib/domain/library-service.mjs`, 404 lines), `electron/persistence.ts:1` opens with `// @ts-nocheck`, and every renderer call goes through `(window as any).fragments`. That combination is why 22 `no-explicit-any` lint errors exist and why an agent writing a new IPC call has nothing to check its work against.

**Files:**
- Create: `lib/domain/source-document.ts`
- Create: `lib/domain/paths.ts`
- Create: `lib/domain/atomic-write.ts`
- Create: `lib/domain/library-service.ts`
- Create: `lib/ipc/contract.ts`
- Create: `types/fragments-bridge.d.ts`
- Delete: `lib/domain/library-service.mjs`
- Modify: `electron/persistence.ts` (remove `@ts-nocheck`, remove the `nativeImport` hack)
- Modify: `electron/preload.ts`
- Modify: `package.json` (remove the `library-service.mjs` `extraResources` entry)
- Modify: `scripts/seed-library.mjs:12`
- Modify: `tests/unit/library-service.test.mjs:1-10`

**Interfaces:**
- Produces: `SourceDocument`, `FragmentDocument`, `MeasuredAnalysis`, `WaveformData`, `MusicalRole`, `SourceType`, `FinalizeMetadata` from `lib/domain/source-document.ts`.
- Produces: `validateFinalizeMetadata(value: unknown): asserts value is FinalizeMetadata`, `validateMeasuredAnalysis(value: unknown): asserts value is MeasuredAnalysis`, `normalizeSourceDocument(raw: unknown): SourceDocument`.
- Produces: `createLibraryService(libraryRoot: string): LibraryService` from `lib/domain/library-service.ts`.
- Produces: `FRAGMENTS_CHANNELS` and `FragmentsBridge` from `lib/ipc/contract.ts`.
- Consumes: nothing from earlier tasks beyond the `check` script.

**Hard constraint:** `lib/domain/source-document.ts` must import nothing. It is the only domain file the renderer is allowed to import, and it has to work in a browser bundle. `paths.ts`, `atomic-write.ts`, and `library-service.ts` use `node:*` and are main-process only.

- [ ] **Step 1: Write the failing test for schema normalization**

This is the one genuinely new behaviour in this task: `SCHEMA_VERSION` is written at `library-service.mjs:253` but never read back, and the two fields the UI collects but silently drops (`sourceTypes` from the import dialog, `sensitivity` from the workbench slider) get a defined default.

Create `tests/unit/source-document.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSourceDocument } from "../../electron-dist/lib/domain/source-document.js";

function rawDocument(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "abc",
    originalName: "take.wav",
    audioFile: "original.wav",
    contentHash: "hash",
    importedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    duration: 12,
    format: "WAV",
    sampleRate: 48000,
    waveform: { version: 1, count: 1, peaks: [4] },
    analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    fragments: [],
    relationships: [],
    ...overrides,
  };
}

test("defaults sourceTypes and sensitivity when absent on disk", () => {
  const document = normalizeSourceDocument(rawDocument());
  assert.deepEqual(document.sourceTypes, []);
  assert.equal(document.sensitivity, 52);
});

test("preserves sourceTypes and sensitivity when present on disk", () => {
  const document = normalizeSourceDocument(
    rawDocument({ sourceTypes: ["Voice memo"], sensitivity: 68 }),
  );
  assert.deepEqual(document.sourceTypes, ["Voice memo"]);
  assert.equal(document.sensitivity, 68);
});

test("rejects a schema version newer than this build understands", () => {
  assert.throws(
    () => normalizeSourceDocument(rawDocument({ schemaVersion: 2 })),
    /schemaVersion/,
  );
});

test("treats a missing schemaVersion as version 1", () => {
  const raw = rawDocument();
  delete raw.schemaVersion;
  assert.equal(normalizeSourceDocument(raw).schemaVersion, 1);
});

test("defaults a missing fragments array to empty", () => {
  const raw = rawDocument();
  delete raw.fragments;
  assert.deepEqual(normalizeSourceDocument(raw).fragments, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test:unit
```

Expected: FAIL with `Cannot find module .../electron-dist/lib/domain/source-document.js`, because the module does not exist yet.

- [ ] **Step 3: Create the type and validation module**

Create `lib/domain/source-document.ts`. The types are the single definition of what is on disk; the validators are moved verbatim from `library-service.mjs:88-152` with types added. Deliberately plain — no generics, no inference tricks.

```ts
// The on-disk contract. This file must import nothing: it is compiled into the
// Electron main process AND bundled into the renderer.
//
// Each source lives in `<libraryRoot>/sources/<id>/` holding the managed audio
// copy plus this document as `source.json`.

export const SCHEMA_VERSION = 1;

/** Default segmentation sensitivity for sources written before the field existed. */
export const DEFAULT_SENSITIVITY = 52;

export type MusicalRole =
  | "Melody"
  | "Rhythm"
  | "Harmony"
  | "Bass"
  | "Voice"
  | "Texture"
  | "Unclassified";

export type SourceType =
  | "Voice memo"
  | "Jam"
  | "Practice"
  | "Studio"
  | "Field recording"
  | "Archive";

/** Measured only. `null` means analysis did not produce a value — never guess one. */
export type MeasuredAnalysis = {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  keyStrength: number | null;
};

export type WaveformData = {
  version: 1;
  count: number;
  peaks: number[];
};

export type FragmentDocument = {
  id: string;
  name: string;
  start: number;
  end: number;
  roles: MusicalRole[];
  primaryRole: MusicalRole;
  userTags: string[];
  analysis: MeasuredAnalysis;
  analysisRevision: number;
  createdAt: string;
};

export type SourceDocument = {
  schemaVersion: number;
  id: string;
  originalName: string;
  audioFile: string;
  contentHash: string;
  importedAt: string;
  deletedAt: string | null;
  restoredAt?: string;
  duration: number | null;
  format: string | null;
  sampleRate: number | null;
  waveform: WaveformData | null;
  analysis: MeasuredAnalysis;
  sourceTypes: SourceType[];
  sensitivity: number;
  fragments: FragmentDocument[];
  relationships: unknown[];
};

/** What the renderer sends to complete a pending import. */
export type FinalizeMetadata = {
  duration: number;
  format?: string | null;
  sampleRate: number;
  waveform: WaveformData;
  analysis: MeasuredAnalysis;
  sourceTypes?: SourceType[];
};

export function emptyMeasuredAnalysis(): MeasuredAnalysis {
  return { bpm: null, key: null, scale: null, keyStrength: null };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateWaveform(waveform: unknown): asserts waveform is WaveformData {
  if (!isPlainObject(waveform)) throw new Error("metadata.waveform must be an object");
  const { version, count, peaks } = waveform;
  if (version !== 1) throw new Error("metadata.waveform.version must be 1");
  if (!isFiniteNumber(count) || count < 0 || !Number.isInteger(count)) {
    throw new Error("metadata.waveform.count must be a finite, non-negative integer");
  }
  if (!Array.isArray(peaks) || !peaks.every((peak) => isFiniteNumber(peak))) {
    throw new Error("metadata.waveform.peaks must be an array of finite numbers");
  }
  if (peaks.length !== count) {
    throw new Error("metadata.waveform.count must match the number of peak values");
  }
}

export function validateMeasuredAnalysis(analysis: unknown): asserts analysis is MeasuredAnalysis {
  if (!isPlainObject(analysis)) throw new Error("metadata.analysis must be an object");
  const { bpm, key, scale, keyStrength } = analysis;
  if (!isNullableFiniteNumber(bpm)) throw new Error("metadata.analysis.bpm must be a finite number or null");
  if (!isNullableString(key)) throw new Error("metadata.analysis.key must be a string or null");
  if (!isNullableString(scale)) throw new Error("metadata.analysis.scale must be a string or null");
  if (!isNullableFiniteNumber(keyStrength)) {
    throw new Error("metadata.analysis.keyStrength must be a finite number or null");
  }
}

/**
 * Validates renderer-supplied finalize metadata before anything is written, so
 * a rejected `finalizeImport` never mutates a pending `source.json`.
 */
export function validateFinalizeMetadata(metadata: unknown): asserts metadata is FinalizeMetadata {
  if (!isPlainObject(metadata)) throw new Error("metadata must be an object");
  if (!isPositiveFiniteNumber(metadata.duration)) {
    throw new Error("metadata.duration must be a finite number greater than 0");
  }
  if (!isPositiveFiniteNumber(metadata.sampleRate)) {
    throw new Error("metadata.sampleRate must be a finite number greater than 0");
  }
  validateWaveform(metadata.waveform);
  validateMeasuredAnalysis(metadata.analysis);
}

export function validateFragments(fragments: unknown): asserts fragments is FragmentDocument[] {
  if (!Array.isArray(fragments)) throw new Error("fragments must be an array");
  for (const fragment of fragments) {
    if (!isPlainObject(fragment)) throw new Error("each fragment must be an object");
    if (typeof fragment.id !== "string" || fragment.id.length === 0) {
      throw new Error("each fragment must have a non-empty id");
    }
    if (!isFiniteNumber(fragment.start) || !isFiniteNumber(fragment.end)) {
      throw new Error("each fragment must have finite start and end times");
    }
    if (fragment.start < 0 || fragment.end <= fragment.start) {
      throw new Error("each fragment must satisfy 0 <= start < end");
    }
  }
}

/**
 * The read-side migration seam. Fills defaults for fields added after a
 * document was written, and refuses documents from a newer build rather than
 * silently dropping fields it does not understand.
 */
export function normalizeSourceDocument(raw: unknown): SourceDocument {
  if (!isPlainObject(raw)) throw new Error("source document must be an object");

  const schemaVersion = raw.schemaVersion === undefined ? 1 : raw.schemaVersion;
  if (!isFiniteNumber(schemaVersion) || schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `unsupported schemaVersion ${String(raw.schemaVersion)}; this build understands up to ${SCHEMA_VERSION}`,
    );
  }

  return {
    ...(raw as SourceDocument),
    schemaVersion,
    analysis: isPlainObject(raw.analysis)
      ? (raw.analysis as MeasuredAnalysis)
      : emptyMeasuredAnalysis(),
    sourceTypes: Array.isArray(raw.sourceTypes) ? (raw.sourceTypes as SourceType[]) : [],
    sensitivity: isFiniteNumber(raw.sensitivity) ? raw.sensitivity : DEFAULT_SENSITIVITY,
    fragments: Array.isArray(raw.fragments) ? (raw.fragments as FragmentDocument[]) : [],
    relationships: Array.isArray(raw.relationships) ? raw.relationships : [],
  };
}
```

- [ ] **Step 4: Extract the path guards and the atomic write**

Create `lib/domain/paths.ts` by moving `library-service.mjs:22-53` unchanged, adding types:

```ts
import path from "node:path";

const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export function assertSafeSourceId(id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || !SAFE_ID_PATTERN.test(id) || id === "." || id === "..") {
    throw new Error("source id must be a non-empty identifier without path traversal segments");
  }
  return id;
}

export function assertSafeRelativeFilename(filename: unknown, label = "audioFile"): string {
  if (typeof filename !== "string" || filename.length === 0) {
    throw new Error(`${label} must be a non-empty relative filename`);
  }
  if (filename.includes("/") || filename.includes("\\")) {
    throw new Error(`${label} must not contain path separators`);
  }
  if (filename === "." || filename === "..") {
    throw new Error(`${label} must not be a relative path segment`);
  }
  return filename;
}

/** Resolves `filename` inside `dir`, rejecting any result that escapes it. */
export function resolveWithinDir(dir: string, filename: string): string {
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, filename);
  const prefix = `${resolvedDir}${path.sep}`;
  if (resolved !== resolvedDir && !resolved.startsWith(prefix)) {
    throw new Error("resolved path escapes its managed directory (traversal rejected)");
  }
  return resolved;
}
```

Create `lib/domain/atomic-write.ts` by moving `library-service.mjs:60-86` unchanged:

```ts
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Writes JSON via a temp file + rename so readers never observe a partial
 * write. The temp file is created exclusively, written, fsync'd, and closed
 * before the rename; if any step fails, the temp file is always removed so no
 * `.tmp` litter survives a failed write.
 */
export async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const json = `${JSON.stringify(value, null, 2)}\n`;

  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tempPath, "wx");
    await handle.writeFile(json, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
```

- [ ] **Step 5: Port the library service**

Create `lib/domain/library-service.ts` from `library-service.mjs:154-403`. The logic is unchanged except for four things:

1. Import the guards, `atomicWriteJson`, and the types instead of defining them locally.
2. `readSourceDocument` returns `normalizeSourceDocument(JSON.parse(raw))`, so every read goes through the migration seam.
3. `beginImport` writes the two new fields: `sourceTypes: []`, `sensitivity: DEFAULT_SENSITIVITY`.
4. `finalizeImport` persists `metadata.sourceTypes ?? existing.sourceTypes`, and `updateFragments` calls `validateFragments(fragments)` instead of the bare `Array.isArray` check at line 365.

Add a new `updateSourceSettings` method so the workbench sensitivity slider has somewhere to persist, and declare the public surface as a named type:

```ts
export type LibraryService = {
  beginImport(audioPath: string): Promise<SourceDocument & { restored?: boolean }>;
  finalizeImport(sourceId: string, metadata: FinalizeMetadata): Promise<SourceDocument>;
  cancelImport(sourceId: string): Promise<void>;
  listSources(): Promise<SourceDocument[]>;
  archiveSource(sourceId: string): Promise<SourceDocument>;
  restoreSource(sourceId: string): Promise<SourceDocument>;
  resolveAudioPath(sourceId: string, audioFile: string): string;
  updateSourceAnalysis(sourceId: string, analysis: MeasuredAnalysis): Promise<SourceDocument>;
  updateSourceSettings(
    sourceId: string,
    settings: { sourceTypes?: SourceType[]; sensitivity?: number },
  ): Promise<SourceDocument>;
  updateFragments(sourceId: string, fragments: FragmentDocument[]): Promise<SourceDocument>;
  updateRelationships(sourceId: string, relationships: unknown[]): Promise<SourceDocument>;
};

export function createLibraryService(libraryRoot: string): LibraryService {
  // ... body ported from library-service.mjs:155-402
}
```

`updateSourceSettings` follows the same shape as `updateSourceAnalysis` (`library-service.mjs:344-350`):

```ts
  async function updateSourceSettings(
    sourceId: string,
    settings: { sourceTypes?: SourceType[]; sensitivity?: number },
  ): Promise<SourceDocument> {
    const existing = await readSourceDocument(sourceId);
    const document: SourceDocument = {
      ...existing,
      sourceTypes: settings.sourceTypes ?? existing.sourceTypes,
      sensitivity: settings.sensitivity ?? existing.sensitivity,
    };
    await atomicWriteJson(sourceDocumentPathFor(sourceId), document);
    return document;
  }
```

Then delete the old file:

```bash
git rm lib/domain/library-service.mjs
```

- [ ] **Step 6: Repoint the existing service tests**

`tests/unit/library-service.test.mjs` currently imports the source `.mjs` directly. Change its import to the compiled output:

```js
import { createLibraryService } from "../../electron-dist/lib/domain/library-service.js";
```

This works because `electron/postbuild.cjs:9` writes `electron-dist/package.json` with `{"type":"commonjs"}`, and `test:unit` runs `build:electron` first. All 21 existing assertions must still pass unchanged — that is the proof the port was faithful.

- [ ] **Step 7: Run the tests and verify they pass**

Run:

```bash
npm run test:unit
```

Expected: PASS. 21 existing `library-service` tests, 8 `app-protocol` tests, and 5 new `source-document` tests.

- [ ] **Step 8: Declare the IPC contract**

The 10 channel names are currently string literals duplicated between `electron/preload.ts:4-17` and `electron/persistence.ts:67-103`, with payloads typed `unknown` on one side and `any` on the other. Create `lib/ipc/contract.ts`:

```ts
import type {
  FinalizeMetadata,
  FragmentDocument,
  MeasuredAnalysis,
  SourceDocument,
  SourceType,
} from "../domain/source-document";

/** A source document as the renderer sees it: plus the protocol URL for its audio. */
export type SourceDocumentWithAudio = SourceDocument & { audioUrl: string };

/** `beginImport` also reports whether it restored a previously archived source. */
export type BeginImportResult = SourceDocumentWithAudio & { restored?: boolean };

export type DragTarget = { sourceId?: string; assetPath?: string };

export const FRAGMENTS_CHANNELS = {
  pickAudio: "fragments:pick-audio",
  beginImport: "fragments:begin-import",
  finalizeImport: "fragments:finalize-import",
  cancelImport: "fragments:cancel-import",
  archiveSource: "fragments:archive-source",
  listSources: "fragments:list-sources",
  updateSourceAnalysis: "fragments:update-source-analysis",
  updateSourceSettings: "fragments:update-source-settings",
  updateFragments: "fragments:update-fragments",
  updateRelationships: "fragments:update-relationships",
  startDrag: "fragments:start-drag",
} as const;

/**
 * The complete renderer-visible surface. `window.fragments` is `undefined` in
 * plain-browser mode, so every caller must handle its absence.
 */
export type FragmentsBridge = {
  pickAudioFile(): Promise<string | null>;
  beginImport(filePath: string): Promise<BeginImportResult>;
  finalizeImport(id: string, metadata: FinalizeMetadata): Promise<SourceDocumentWithAudio>;
  cancelImport(id: string): Promise<void>;
  archiveSource(id: string): Promise<SourceDocumentWithAudio>;
  listSources(): Promise<SourceDocumentWithAudio[]>;
  updateSourceAnalysis(id: string, analysis: MeasuredAnalysis): Promise<SourceDocumentWithAudio>;
  updateSourceSettings(
    id: string,
    settings: { sourceTypes?: SourceType[]; sensitivity?: number },
  ): Promise<SourceDocumentWithAudio>;
  updateFragments(id: string, fragments: FragmentDocument[]): Promise<SourceDocumentWithAudio>;
  updateRelationships(id: string, relationships: unknown[]): Promise<SourceDocumentWithAudio>;
  startDrag(target: DragTarget): void;
};
```

Create `types/fragments-bridge.d.ts`:

```ts
import type { FragmentsBridge } from "@/lib/ipc/contract";

declare global {
  interface Window {
    /** Injected by `electron/preload.ts`. Absent in plain-browser mode. */
    fragments?: FragmentsBridge;
  }
}

export {};
```

- [ ] **Step 9: Rewrite the preload against the contract**

Replace `electron/preload.ts` entirely. Every method is now typed, and the channel names come from the contract instead of being retyped:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { FRAGMENTS_CHANNELS } from "../lib/ipc/contract.js";
import type { FragmentsBridge } from "../lib/ipc/contract.js";

const bridge: FragmentsBridge = {
  pickAudioFile: () => ipcRenderer.invoke(FRAGMENTS_CHANNELS.pickAudio),
  beginImport: (filePath) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.beginImport, filePath),
  finalizeImport: (id, metadata) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.finalizeImport, id, metadata),
  cancelImport: (id) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.cancelImport, id),
  archiveSource: (id) => ipcRenderer.invoke(FRAGMENTS_CHANNELS.archiveSource, id),
  listSources: () => ipcRenderer.invoke(FRAGMENTS_CHANNELS.listSources),
  updateSourceAnalysis: (id, analysis) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateSourceAnalysis, id, analysis),
  updateSourceSettings: (id, settings) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateSourceSettings, id, settings),
  updateFragments: (id, fragments) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateFragments, id, fragments),
  updateRelationships: (id, relationships) =>
    ipcRenderer.invoke(FRAGMENTS_CHANNELS.updateRelationships, id, relationships),
  startDrag: (target) => ipcRenderer.send(FRAGMENTS_CHANNELS.startDrag, target),
};

contextBridge.exposeInMainWorld("fragments", bridge);
```

- [ ] **Step 10: Un-`@ts-nocheck` the main process**

In `electron/persistence.ts`, delete line 1 (`// @ts-nocheck`) and delete lines 9 and 38-41 — the `nativeImport = new Function(...)` hack and the packaged/unpackaged path juggling. That workaround existed only because a CommonJS-compiled file cannot `import()` a real `.mjs`. Now that the service compiles into `electron-dist` alongside it, use a plain static import at the top of the file:

```ts
import { createLibraryService } from "../lib/domain/library-service.js";
import { FRAGMENTS_CHANNELS } from "../lib/ipc/contract.js";
import type { LibraryService } from "../lib/domain/library-service.js";
```

and replace the removed block with:

```ts
  const libraryRoot = process.env.FRAGMENTS_LIBRARY_ROOT
    || path.join(app.getPath("documents"), "Fragments Library");
  const library: LibraryService = createLibraryService(libraryRoot);
```

Then type the handlers. Change `logged` to carry its channel type, replace each literal channel string with its `FRAGMENTS_CHANNELS` member, and add the `updateSourceSettings` handler following the exact shape of the neighbouring `updateSourceAnalysis` handler at lines 92-95:

```ts
  logged(FRAGMENTS_CHANNELS.updateSourceSettings, async (_event, id: string, settings) => {
    const source = await library.updateSourceSettings(id, settings);
    return { ...source, audioUrl: audioUrl(source.id) };
  });
```

Give `logged` an explicit signature so a wrong handler arity is a compile error:

```ts
  function logged(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: never[]) => unknown,
  ) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await handler(event, ...(args as never[]));
      } catch (error) {
        console.error(`[fragments] ${channel} failed:`, error);
        throw error;
      }
    });
  }
```

Also give the two remaining loose spots real types: `dragIcon()` returns `string`, and the `fragments:start-drag` listener's `target` parameter is `DragTarget | string`.

- [ ] **Step 11: Drop the now-unnecessary packaging resource**

`package.json:44-47` copies `lib/domain/library-service.mjs` into `extraResources` purely so the `nativeImport` hack could find it at runtime in a packaged app. The compiled service now lives inside `electron-dist/**`, which `build.files` already includes. Delete that `extraResources` entry, leaving only the seed-audio entry:

```json
    "extraResources": [
      {
        "from": "public/audio",
        "to": "seed-audio",
        "filter": ["f??.wav"]
      }
    ],
```

- [ ] **Step 12: Repoint the seed script**

`scripts/seed-library.mjs:12` imports the deleted `.mjs`. Change it to the compiled output:

```js
import { createLibraryService } from "../electron-dist/lib/domain/library-service.js";
```

Leave `lib/audio/wav-peaks.mjs` as `.mjs` and leave its import (line 13) alone. It is a 85-line leaf WAV parser used only by two Node scripts, is already JSDoc-typed, and pulling it into the Electron build would drag `lib/audio/` — which is full of browser and JSX code — along with it. Do not port it.

Update the `seed-library` script added in Task 1 so it builds first:

```json
    "seed-library": "npm run build:electron && node scripts/seed-library.mjs",
```

- [ ] **Step 13: Replace renderer `any` casts with the typed bridge**

Every `(window as any).fragments` becomes `window.fragments`, now typed by `types/fragments-bridge.d.ts`. The call sites are:
- `app/fragments-app.tsx:277, 609, 710, 895`
- `app/features/sources/import-dialog.tsx` (the `pickAudioFile` / `beginImport` / `finalizeImport` flow)
- `lib/audio/desktop-drag.ts`

Delete the `:any` annotations on the `.catch((error: any) => ...)` handlers at the same sites; `unknown` is the correct type and `console.warn` accepts it. Do not convert the document mappers (`fragmentFromDocument`, `sourceFileFromDocument`, `rangesFromDocument` at `app/fragments-app.tsx:93-190`) in this task — Task 4 deletes them outright.

- [ ] **Step 14: Verify**

Run:

```bash
npm run check
```

Expected: exit 0, with 34 unit tests passing. `no-explicit-any` count should drop substantially; the remainder are inside the mappers Task 4 removes.

Run:

```bash
npm run dev:all
```

Expected: the app opens, the library loads from `~/Documents/Fragments Library`, importing a WAV still works, and dragging a fragment to Finder still produces a file. The console line `[fragments] library root: ...` still prints.

- [ ] **Step 15: Review checkpoint**

Confirm `lib/domain/source-document.ts` imports nothing and that no renderer file imports `library-service.ts`, `paths.ts`, or `atomic-write.ts`:

```bash
rg -n "domain/(library-service|paths|atomic-write)" app lib/audio lib/ui lib/view 2>/dev/null
```

Expected: no matches. Commit only if the user explicitly requests it.

---

### Task 4: Delete the prototype dataset and derive views from documents

`app/prototype-data.ts` is simultaneously the app's type module and its fake dataset. It defines 28 hardcoded fragments (lines 149-178) and 33 authored relationships (lines 205-239), and `app/fragments-app.tsx:341-346` merges them with real library data at runtime. Worse, `inventAnalysis` (`lib/audio/source-metadata.ts:89-97`) fabricates a BPM and key from a hash of the source id and `fragments-app.tsx:331-337` **writes those invented values to disk**.

After this task, what the UI shows is what analysis actually measured.

**Files:**
- Create: `lib/view/fragment-view.ts`
- Create: `lib/view/source-view.ts`
- Create: `tests/unit/view-models.test.mjs`
- Delete: `app/prototype-data.ts`
- Delete: `app/prototype-waveforms.json`
- Delete: `scripts/compute-prototype-waveforms.mjs`
- Delete: `lib/domain/invent-analysis.mjs`
- Delete: `public/audio/{f01,f02}_{bass,harmony,melody,rhythm}.wav`, `public/audio/f02_match.wav`, `public/audio/f03_beat2.wav`, `public/audio/f05_halftime.wav`, `public/audio/f14_pitch.wav`, `public/audio/f18_double.wav`, `public/audio/instrumental.vtt`
- Move: `app/library-filter-popover.tsx` → `app/features/library/library-filters.ts`
- Modify: `lib/audio/source-metadata.ts` (delete lines 52-61 and 81-104)
- Modify: `lib/audio/source-playback.ts:1-28`
- Modify: `app/fragments-app.tsx` (delete lines 92-190, 341-346)
- Modify: `app/features/library/library-items.ts`, `library-list.ts`, `library-columns.ts`
- Modify: `app/features/sources/source-detail-panel.tsx`, `import-dialog.tsx`
- Modify: `app/fragmentation-workbench.tsx`
- Modify: `scripts/seed-library.mjs:14, 44`
- Modify: `package.json` (remove `compute-waveforms`)

**Interfaces:**
- Consumes: `SourceDocument`, `FragmentDocument`, `MeasuredAnalysis`, `MusicalRole`, `SourceType` from Task 3.
- Produces: `FragmentView`, `fragmentViewsFromDocument(document: SourceDocumentWithAudio): FragmentView[]`.
- Produces: `SourceView`, `sourceViewFromDocument(document: SourceDocumentWithAudio): SourceView`.

- [ ] **Step 1: Write the failing view-model test**

Create `tests/unit/view-models.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { sourceViewFromDocument } from "../../electron-dist/lib/view/source-view.js";
import { fragmentViewsFromDocument } from "../../electron-dist/lib/view/fragment-view.js";

function document(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "src-1",
    originalName: "balcony.wav",
    audioFile: "original.wav",
    audioUrl: "fragments-audio://source/src-1",
    contentHash: "hash",
    importedAt: "2026-08-20T04:14:00.000Z",
    deletedAt: null,
    duration: 100,
    format: "WAV",
    sampleRate: 48000,
    waveform: { version: 1, count: 10, peaks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    analysis: { bpm: 92, key: "A", scale: "minor", keyStrength: 71 },
    sourceTypes: ["Jam"],
    sensitivity: 52,
    fragments: [],
    relationships: [],
    ...overrides,
  };
}

function fragment(overrides = {}) {
  return {
    id: "src-1-whole",
    name: "balcony.wav",
    start: 0,
    end: 100,
    roles: [],
    primaryRole: "Unclassified",
    userTags: [],
    analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    analysisRevision: 1,
    createdAt: "2026-08-20T04:14:00.000Z",
    ...overrides,
  };
}

test("builds a source view with a formatted key label", () => {
  const view = sourceViewFromDocument(document());
  assert.equal(view.name, "balcony.wav");
  assert.equal(view.keyLabel, "A minor");
  assert.equal(view.bpm, 92);
  assert.equal(view.audioUrl, "fragments-audio://source/src-1");
  assert.deepEqual(view.sourceTypes, ["Jam"]);
});

test("reports null rather than inventing analysis that was never measured", () => {
  const view = sourceViewFromDocument(
    document({ analysis: { bpm: null, key: null, scale: null, keyStrength: null } }),
  );
  assert.equal(view.bpm, null);
  assert.equal(view.keyLabel, null);
  assert.equal(view.keyStrength, null);
});

test("falls back to the source analysis for a fragment with none of its own", () => {
  const views = fragmentViewsFromDocument(document({ fragments: [fragment()] }));
  assert.equal(views.length, 1);
  assert.equal(views[0].bpm, 92);
  assert.equal(views[0].keyLabel, "A minor");
});

test("prefers a fragment's own analysis over the source analysis", () => {
  const views = fragmentViewsFromDocument(
    document({
      fragments: [fragment({ analysis: { bpm: 120, key: "C", scale: "major", keyStrength: 88 } })],
    }),
  );
  assert.equal(views[0].bpm, 120);
  assert.equal(views[0].keyLabel, "C major");
});

test("labels a fragment's duration from its own bounds, not the source duration", () => {
  const views = fragmentViewsFromDocument(
    document({ fragments: [fragment({ start: 10, end: 28 })] }),
  );
  assert.equal(views[0].durationLabel, "0:18");
});

test("slices fragment peaks out of the source waveform", () => {
  const views = fragmentViewsFromDocument(
    document({ fragments: [fragment({ start: 0, end: 50 })] }),
  );
  assert.deepEqual(views[0].waveform, [1, 2, 3, 4, 5]);
});

test("returns an empty peak array when the source has no waveform yet", () => {
  const views = fragmentViewsFromDocument(
    document({ waveform: null, fragments: [fragment()] }),
  );
  assert.deepEqual(views[0].waveform, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm run test:unit
```

Expected: FAIL with `Cannot find module .../electron-dist/lib/view/source-view.js`.

- [ ] **Step 3: Add `lib/view/` to the Electron build**

So the view models can be unit tested without a renderer build, add them to `electron/tsconfig.json`'s `include` array (edited in Task 2):

```json
  "include": [
    "./**/*.ts",
    "../lib/domain/**/*.ts",
    "../lib/ipc/**/*.ts",
    "../lib/view/**/*.ts",
    "../types/**/*.d.ts"
  ]
```

Like `source-document.ts`, files in `lib/view/` must not import `node:*` — they are bundled into the renderer too.

- [ ] **Step 4: Write the source view model**

Create `lib/view/source-view.ts`. Note what is *absent*: no `device` (was the hardcoded string `"Managed library"` at `fragments-app.tsx:164`), no `analysisProfile` (was the hardcoded `MESSY_PHONE_PROFILE` at line 171), no `imported` flag (every source is managed now), and no `start`/`end` (they were always `0` and `duration`).

```ts
import type { SourceType } from "../domain/source-document";
import type { SourceDocumentWithAudio } from "../ipc/contract";
import { formatMusicalKey } from "./format-key";
import { formatDateLabel, formatSeconds } from "./format-duration";

export type SourceView = {
  id: string;
  name: string;
  durationSeconds: number;
  durationLabel: string;
  format: string | null;
  sourceTypes: SourceType[];
  sensitivity: number;
  waveform: number[];
  bpm: number | null;
  keyLabel: string | null;
  keyStrength: number | null;
  audioUrl: string;
  audioCacheKey: string;
  importedAt: string;
  importedAtLabel: string;
  fragmentIds: string[];
};

export function sourceViewFromDocument(document: SourceDocumentWithAudio): SourceView {
  const duration = document.duration ?? 0;
  return {
    id: document.id,
    name: document.originalName,
    durationSeconds: duration,
    durationLabel: formatSeconds(duration),
    format: document.format,
    sourceTypes: document.sourceTypes,
    sensitivity: document.sensitivity,
    waveform: document.waveform?.peaks ?? [],
    bpm: document.analysis.bpm,
    keyLabel: formatMusicalKey(document.analysis.key, document.analysis.scale),
    keyStrength: document.analysis.keyStrength,
    audioUrl: document.audioUrl,
    audioCacheKey: document.id,
    importedAt: document.importedAt,
    importedAtLabel: formatDateLabel(document.importedAt),
    fragmentIds: document.fragments.map((fragment) => fragment.id),
  };
}
```

Two helper modules currently live where the renderer bundle can reach them but the Electron build cannot. Move them so `lib/view/` is self-contained:

- Create `lib/view/format-duration.ts` holding `formatSeconds` (moved from `lib/format.ts`) and `formatDateLabel`, which both view models need:

```ts
export function formatSeconds(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.round(safe % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDateLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}
```

Delete `lib/format.ts` and repoint its importers to `@/lib/view/format-duration`.

- Create `lib/view/format-key.ts` holding `parseMusicalKeyLabel`, `formatMusicalKey`, `normalizeKeyLabel`, `matchesKeySelection`, and `uniqueKeyLabels`, moved from `lib/audio/source-metadata.ts:1-11, 36-40, 63-79`. These are string formatting, not audio. `formatMusicalKey(key, scale)` must return `null` — not `"—"` — when either input is null; rendering the dash is the component's job.

- [ ] **Step 5: Write the fragment view model**

Create `lib/view/fragment-view.ts`. Absent versus the old `Fragment` (`prototype-data.ts:23-42`): `alternateKeys`, `brightness`, `beats`, `bars`, `confidence`, `duplicateGroup`, `objects`, and the per-fragment `audio` URL — every one of those was authored by hand and has no measurable source.

```ts
import type { FragmentDocument, MeasuredAnalysis, MusicalRole } from "../domain/source-document";
import type { SourceDocumentWithAudio } from "../ipc/contract";
import { formatMusicalKey } from "./format-key";
import { formatDateLabel, formatSeconds } from "./format-duration";

export type FragmentView = {
  id: string;
  sourceId: string;
  sourceName: string;
  name: string;
  start: number;
  end: number;
  durationLabel: string;
  role: MusicalRole;
  roles: MusicalRole[];
  userTags: string[];
  bpm: number | null;
  keyLabel: string | null;
  keyStrength: number | null;
  waveform: number[];
  createdAt: string;
  createdAtLabel: string;
  analysisRevision: number;
};

/** Fragment analysis wins; the parent source's analysis is the fallback. */
function effectiveAnalysis(
  fragment: MeasuredAnalysis,
  source: MeasuredAnalysis,
): MeasuredAnalysis {
  return {
    bpm: fragment.bpm ?? source.bpm,
    key: fragment.key ?? source.key,
    scale: fragment.scale ?? source.scale,
    keyStrength: fragment.keyStrength ?? source.keyStrength,
  };
}

/** Picks the peaks covering `[start, end)` out of a whole-source peak array. */
export function slicePeaks(
  peaks: number[],
  start: number,
  end: number,
  duration: number,
): number[] {
  if (!peaks.length || duration <= 0) return [];
  const first = Math.max(0, Math.floor((start / duration) * peaks.length));
  const last = Math.min(peaks.length, Math.ceil((end / duration) * peaks.length));
  return peaks.slice(first, Math.max(first + 1, last));
}

export function fragmentViewFromDocument(
  fragment: FragmentDocument,
  document: SourceDocumentWithAudio,
): FragmentView {
  const analysis = effectiveAnalysis(fragment.analysis, document.analysis);
  const duration = document.duration ?? 0;
  return {
    id: fragment.id,
    sourceId: document.id,
    sourceName: document.originalName,
    name: fragment.name,
    start: fragment.start,
    end: fragment.end,
    durationLabel: formatSeconds(fragment.end - fragment.start),
    role: fragment.primaryRole,
    roles: fragment.roles.length ? fragment.roles : [fragment.primaryRole],
    userTags: fragment.userTags,
    bpm: analysis.bpm,
    keyLabel: formatMusicalKey(analysis.key, analysis.scale),
    keyStrength: analysis.keyStrength,
    waveform: slicePeaks(document.waveform?.peaks ?? [], fragment.start, fragment.end, duration),
    createdAt: fragment.createdAt,
    createdAtLabel: formatDateLabel(fragment.createdAt),
    analysisRevision: fragment.analysisRevision,
  };
}

export function fragmentViewsFromDocument(document: SourceDocumentWithAudio): FragmentView[] {
  return document.fragments.map((fragment) => fragmentViewFromDocument(fragment, document));
}
```

`lib/view/fragment-view.ts` and `lib/view/source-view.ts` must not import each other; both draw their shared formatting from `format-duration.ts` and `format-key.ts`.

`lib/audio/slice-peaks.ts` is now duplicated by the `slicePeaks` above. Delete `lib/audio/slice-peaks.ts` and repoint its importers (`app/fragments-app.tsx:36`, `lib/audio/signal-cell.tsx`, `app/features/library/library-card.tsx`) to `@/lib/view/fragment-view`.

- [ ] **Step 6: Run the view tests and verify they pass**

Run:

```bash
npm run test:unit
```

Expected: PASS, 41 tests total (34 from Task 3 plus 7 new).

- [ ] **Step 7: Delete the fabricated analysis**

This is the change that makes the UI honest. Remove all three fabrication paths:

1. Delete `lib/domain/invent-analysis.mjs`.
2. In `lib/audio/source-metadata.ts`, delete `hashSeed`, `inventAnalysis`, and `analysisNeedsInvention` (lines 81-104) along with the `KEYS` constant. Also delete `fragmentKeyLabels` (lines 52-61), which existed only to reconcile the invented `alternateKeys` field.
3. In `app/fragments-app.tsx`, delete the `backfill` array and the loop that persists invented analysis (lines 280-286 and 331-337). A source with no measured analysis now simply reports `null`.
4. In `scripts/seed-library.mjs`, delete the `inventAnalysis` import (line 14) and replace line 44 with an honest empty analysis:

```js
    const pending = await library.beginImport(filePath);
    await library.finalizeImport(pending.id, {
      duration,
      format: "WAV",
      sampleRate,
      waveform: { version: 1, count: peaks.length, peaks },
      // Essentia runs in the renderer only, so a CLI seed has no measured
      // tempo or key. The app fills these in when the source is analyzed.
      analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    });
```

- [ ] **Step 8: Rewire the app onto view models**

In `app/fragments-app.tsx`, delete the four document mappers and the merge that blends fake data with real data:
- `fragmentFromDocument` (lines 92-120), `fragmentToDocument` (lines 122-141), `sourceFileFromDocument` (lines 153-180), `rangesFromDocument` (lines 182-190) — replaced by `lib/view/`.
- `isLibraryFragmentId` / `LIBRARY_FRAGMENT_ID` / `isLibraryRelationship` (lines 143-151) — this UUID regex existed purely to tell prototype ids (`f01`) apart from real ones. With no prototype ids, delete it.
- `activeFragments` and `allRelationships` (lines 341-346) — fragments now come from `fragmentViewsFromDocument`, and relationships are empty until Task 6.
- `rangeForIndex` (lines 80-88) and `initialSourceRanges` (line 90) invent plausible-looking slice boundaries from a sensitivity number. Delete them. A source's ranges come from its persisted fragments, and "Add fragment" creates a range at a neutral position:

```ts
/** A newly added range sits in the middle of the source, 8 seconds wide. */
function newRangeFor(source: SourceView, index: number): EditableRange {
  const length = Math.min(8, source.durationSeconds);
  const start = Math.max(0, Math.min(source.durationSeconds - length, source.durationSeconds / 2 - length / 2));
  return {
    id: `${source.id}-range-${Date.now()}-${index}`,
    start,
    end: start + length,
    color: RANGE_COLORS[index % RANGE_COLORS.length],
  };
}
```

Replace every remaining `Fragment` type reference with `FragmentView` and every `SourceFile` with `SourceView`. The `fragmentAudioFor` callback (line 368) returned per-fragment prototype WAV paths; delete it and every parameter that threads it through (`buildFragmentPreviewScope`, `buildSourcePreviewScope`, `resolveSourceAudioUrl`, `LibraryView`, `LibraryCard`, `SignalCell`).

- [ ] **Step 9: Simplify preview scope resolution**

`lib/audio/source-playback.ts:1` imports from `@/app/prototype-data` and lines 24-28 contain heuristics — `source.imported`, `!sourceUrl.startsWith("/audio/")` — that only existed to distinguish real managed audio from prototype static files. Every source now has a managed `audioUrl` and a real duration, so slicing is always possible.

Move the file to the home it keeps for the rest of this plan, and add it to the Electron build so Task 5 can unit-test it:

```bash
mkdir -p lib/audio/preview
git mv lib/audio/source-playback.ts lib/audio/preview/preview-scope.ts
```

Add `"../lib/audio/preview/preview-scope.ts"` to `electron/tsconfig.json`'s `include` array, and repoint the importers of `@/lib/audio/source-playback` — `app/fragments-app.tsx:37-44` and `app/features/sources/source-detail-panel.tsx` — at `@/lib/audio/preview/preview-scope`.

Then replace lines 1-60 with the following. Use relative specifiers, not `@/`: this module is now compiled into `electron-dist` as well as bundled by Vite.

```ts
import type { FragmentView } from "../../view/fragment-view";
import type { SourceView } from "../../view/source-view";

export type PreviewClip = { start: number; end: number };

export type PreviewScope = {
  id: string;
  url: string;
  clip?: PreviewClip;
};

export function buildFragmentPreviewScope(
  fragment: FragmentView,
  source: SourceView | undefined,
): PreviewScope | null {
  if (!source?.audioUrl || source.durationSeconds <= 0) return null;
  return {
    id: fragment.id,
    url: source.audioUrl,
    clip: { start: fragment.start, end: fragment.end },
  };
}

export function buildSourcePreviewScope(source: SourceView): PreviewScope | null {
  if (!source.audioUrl) return null;
  return { id: `source:${source.id}`, url: source.audioUrl };
}
```

Keep `clipDuration`, `progressForAudio`, `timeForProgress`, and `applyPreviewTime` (lines 62-98) unchanged.

- [ ] **Step 10: Prune the filter model and rename the file**

`app/library-filter-popover.tsx` contains no popover and no JSX — only the `LibraryFilters` type and pure predicates. Move it to its slice and drop the extension's implication:

```bash
git mv app/library-filter-popover.tsx app/features/library/library-filters.ts
```

Delete the `bars`, `confidence`, and `takes` fields from `LibraryFilters` and every predicate that reads them. They have no panel controls in `library-filter-panel.tsx` and no data behind them. Delete the same three from the sort/filter logic in `library-items.ts` and `library-list.ts`, and delete their (already commented-out) column definitions in `library-columns.ts:13-20`.

In `library-filter-panel.tsx`, delete the commented-out Role filter block (lines 150-155) rather than leaving it as a decoy.

- [ ] **Step 11: Drop the profile block from the source detail panel**

`app/features/sources/source-detail-panel.tsx` renders `analysisProfile` fields (`name`, `detectors`, `tempoStrategy`, `keyStrategy`, `confidenceThreshold`) that came entirely from the hardcoded `MESSY_PHONE_PROFILE`. Delete that section. Keep the editable BPM/key form (`SourceAnalysisValues`) and the `FragmentLibraryMeta` role/tag form — both write real persisted fields.

Wire the source-type chips to the new persistence: on save, call `window.fragments?.updateSourceSettings(source.id, { sourceTypes })`.

- [ ] **Step 12: Persist source types on import**

`app/features/sources/import-dialog.tsx:43` defines `DEFAULT_SOURCE_TYPES` and the dialog lets the user pick types, but they were never written to disk. Include them in the finalize call so the choice survives a restart:

```ts
await window.fragments.finalizeImport(pending.id, {
  duration: processed.duration,
  format: processed.format,
  sampleRate: processed.sampleRate,
  waveform: { version: 1, count: processed.peaks.length, peaks: processed.peaks },
  analysis: {
    bpm: processed.analysis.bpm,
    key: processed.analysis.key,
    scale: processed.analysis.scale,
    keyStrength: processed.analysis.keyStrength,
  },
  sourceTypes,
});
```

Also replace the hardcoded `55%` progress bar at line 90 with an indeterminate indicator. A fixed number pretending to be progress is the same class of dishonesty as invented BPM.

- [ ] **Step 13: Make the workbench emit honest fragment drafts**

`app/fragmentation-workbench.tsx`'s `draftFragmentForRange` builds a `Fragment` with invented `beats`, `bars`, and `confidence`. Change it to return a `FragmentDocument` — the shape that actually gets persisted:

```ts
export function draftFragmentForRange(
  range: EditableRange,
  index: number,
  source: SourceView,
): FragmentDocument {
  return {
    id: range.id,
    name: defaultFragmentName(source, index),
    start: range.start,
    end: range.end,
    roles: [],
    primaryRole: "Unclassified",
    userTags: [],
    analysis: { bpm: null, key: null, scale: null, keyStrength: null },
    analysisRevision: 1,
    createdAt: new Date().toISOString(),
  };
}
```

Also replace the local `waveformSlice()` helper (lines 40-44) with the shared `slicePeaks` from `lib/view/fragment-view.ts`.

- [ ] **Step 14: Delete the prototype assets**

```bash
git rm app/prototype-data.ts app/prototype-waveforms.json scripts/compute-prototype-waveforms.mjs
git rm public/audio/f01_bass.wav public/audio/f01_harmony.wav public/audio/f01_melody.wav public/audio/f01_rhythm.wav
git rm public/audio/f02_bass.wav public/audio/f02_harmony.wav public/audio/f02_melody.wav public/audio/f02_rhythm.wav
git rm public/audio/f02_match.wav public/audio/f03_beat2.wav public/audio/f05_halftime.wav
git rm public/audio/f14_pitch.wav public/audio/f18_double.wav public/audio/instrumental.vtt
```

The 13 stems and the caption file were referenced only by `heroObjects` (`prototype-data.ts:141-147`) and `Transform.asset` (lines 206-238). Keep `public/audio/f01.wav` through `f28.wav`: they are real recordings, they are what `electron-builder`'s `filter: ["f??.wav"]` ships as seed audio, and `scripts/seed-library.mjs` imports them into a real library.

Remove the `compute-waveforms` script from `package.json`; it existed only to regenerate `prototype-waveforms.json`.

- [ ] **Step 15: Verify**

Run:

```bash
npm run check
```

Expected: exit 0, 41 unit tests passing, and the `no-explicit-any` lint errors gone — the mappers that produced them no longer exist.

Run:

```bash
npm run seed-library && npm run dev:all
```

Expected: 28 sources appear in Sources and 28 whole-file fragments in Library. BPM and Key columns show `—` for every seeded source, because a CLI seed cannot measure them. Import a WAV through the dialog: it decodes, Essentia reports a real BPM and key, and those appear. Restart and confirm the imported source keeps its measured analysis and its source-type chips.

Confirm nothing references the deleted dataset:

```bash
rg -n "prototype-data|prototypeWaveforms|inventAnalysis|MESSY_PHONE_PROFILE|IMPORTED_FRAGMENT_IDS|STAGED_SOURCE_ID|alternateKeys|duplicateGroup|brightness" app lib scripts tests
```

Expected: matches only inside `app/features/affinities/` placeholders, if any — everything else clean.

- [ ] **Step 16: Review checkpoint**

The Map, Matches, and Combine surfaces are expected to be visibly empty at this point; Task 6 gates them properly. Confirm no view renders a fabricated number. Commit only if the user explicitly requests it.

---

### Task 5: One playback engine

There are three near-identical preview engines, each with its own `HTMLAudioElement`, its own `requestAnimationFrame` progress loop, its own listener cleanup, and its own session-invalidation counter:

| Location | Lines | Owns |
| --- | --- | --- |
| `app/fragments-app.tsx:353-461` | ~110 | Library, Sources, Matches, Map, duplicate-takes previews |
| `app/fragmentation-workbench.tsx:195-304` | ~110 | Workbench fragment previews |
| `app/hero-workflow.tsx:266-435` | ~170 | Combine A/B, which needs two elements at once |

They do not coordinate: the parent calls `stopAllAudio()` before opening Combine, but a workbench preview can keep playing while the app believes nothing is playing. Separately, `lib/audio/audio-cache.ts:46-51` decrements a refcount and never evicts. `URL.revokeObjectURL` is called in exactly one place — `audio-service.ts:193`, on the decode-failure path — so every *successfully* decoded source leaks its blob URL for the life of the session.

**Files:**
- Create: `lib/audio/preview/use-preview.ts`
- Create: `tests/unit/preview-scope.test.mjs`
- Modify: `lib/audio/preview/preview-scope.ts` (add `clipDuration`, `timeForProgress`)
- Modify: `lib/audio/audio-cache.ts:38-64`
- Modify: `app/fragments-app.tsx` (delete lines 353-461 and the six preview refs at 264-268)
- Modify: `app/fragmentation-workbench.tsx` (delete lines 195-304)
- Modify: `app/hero-workflow.tsx` (delete lines 266-435's playback plumbing)

**Interfaces:**
- Consumes: `PreviewScope`, `applyPreviewTime`, `progressForAudio` from `lib/audio/preview/preview-scope.ts` (Task 4 edited these).
- Produces:

```ts
export type PreviewController = {
  /** The scope id currently playing, or null. */
  playingId: string | null;
  /** 0-1 within the scope's clip, or within the whole file when unclipped. */
  progress: number;
  /** Start playing a scope from `startRatio`. Safe to call inside a click handler. */
  play(scope: PreviewScope, startRatio?: number): void;
  /** Play if stopped or a different scope; stop if this exact scope is playing. */
  toggle(scope: PreviewScope): void;
  /** Seek within the currently playing scope, starting it if needed. */
  seek(scope: PreviewScope, ratio: number): void;
  stop(): void;
};

export type PreviewOptions = {
  /**
   * Controllers in different groups are mutually exclusive: starting one stops
   * every controller outside its group. Controllers sharing a group can play
   * together. Combine's A/B pair passes `group: "combine"`.
   */
  group?: string;
  /** Called when the browser refuses autoplay, so the caller can show a hint. */
  onBlocked?: () => void;
};

export function usePreview(options?: PreviewOptions): PreviewController;
```

- [ ] **Step 1: Write the failing scope-math test**

The pure part of playback is worth locking down, because all three engines currently reimplement the clip arithmetic around it. Create `tests/unit/preview-scope.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFragmentPreviewScope,
  buildSourcePreviewScope,
  clipDuration,
  progressForAudio,
  timeForProgress,
} from "../../electron-dist/lib/audio/preview/preview-scope.js";

const source = {
  id: "src-1",
  audioUrl: "fragments-audio://source/src-1",
  durationSeconds: 100,
};

const fragment = { id: "frag-1", start: 20, end: 40 };

test("a fragment scope clips to the fragment bounds", () => {
  const scope = buildFragmentPreviewScope(fragment, source);
  assert.deepEqual(scope, {
    id: "frag-1",
    url: "fragments-audio://source/src-1",
    clip: { start: 20, end: 40 },
  });
  assert.equal(clipDuration(scope), 20);
});

test("a source scope plays the whole file with no clip", () => {
  const scope = buildSourcePreviewScope(source);
  assert.equal(scope.id, "source:src-1");
  assert.equal(scope.clip, undefined);
  assert.equal(clipDuration(scope), null);
});

test("there is no scope for a source with no audio url", () => {
  assert.equal(buildFragmentPreviewScope(fragment, { ...source, audioUrl: "" }), null);
  assert.equal(buildSourcePreviewScope({ ...source, audioUrl: "" }), null);
});

test("progress within a clip is measured against the clip, not the file", () => {
  const scope = buildFragmentPreviewScope(fragment, source);
  assert.equal(progressForAudio(scope, 20, 100), 0);
  assert.equal(progressForAudio(scope, 30, 100), 0.5);
  assert.equal(progressForAudio(scope, 40, 100), 1);
});

test("progress clamps outside the clip instead of going negative or past one", () => {
  const scope = buildFragmentPreviewScope(fragment, source);
  assert.equal(progressForAudio(scope, 5, 100), 0);
  assert.equal(progressForAudio(scope, 95, 100), 1);
});

test("seeking a clipped scope maps a ratio back to a file time", () => {
  const scope = buildFragmentPreviewScope(fragment, source);
  assert.equal(timeForProgress(scope, 0, 100), 20);
  assert.equal(timeForProgress(scope, 0.5, 100), 30);
  assert.equal(timeForProgress(scope, 1, 100), 40);
});

test("progress is zero when the file duration is not known yet", () => {
  const scope = buildSourcePreviewScope(source);
  assert.equal(progressForAudio(scope, 10, Number.NaN), 0);
  assert.equal(progressForAudio(scope, 10, 0), 0);
});
```

- [ ] **Step 2: Confirm the scope module is Node-safe**

Task 4 Step 9 already moved this file to `lib/audio/preview/preview-scope.ts` and added it to the Electron build. Verify it imports only types from `lib/view/` — no DOM values, no `node:*`. The `applyPreviewTime` helper takes an `HTMLAudioElement` as a parameter but never constructs one, which is a type-only use and fine.

Add the two helpers the test expects if they are not already exported: `clipDuration(scope)` returning `null` for an unclipped scope, and `timeForProgress(scope, ratio, fileDuration)` as the inverse of `progressForAudio`.

- [ ] **Step 3: Run the test to verify it fails**

Run:

```bash
npm run test:unit
```

Expected: FAIL on the missing `clipDuration` / `timeForProgress` exports.

- [ ] **Step 4: Write the shared hook**

Create `lib/audio/preview/use-preview.ts`. The body is the engine from `fragments-app.tsx:353-461`, which is the most complete of the three — it already handles the two subtle cases the others get wrong: keeping `play()` inside the user-gesture stack (line 452) and honouring a seek requested before metadata arrives (`pendingSeekRef`).

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playMediaElement } from "../browser-audio";
import { resolveAudioUrl } from "../resolve-audio-url";
import { applyPreviewTime, progressForAudio, type PreviewScope } from "./preview-scope";

export type PreviewController = {
  playingId: string | null;
  progress: number;
  play(scope: PreviewScope, startRatio?: number): void;
  toggle(scope: PreviewScope): void;
  seek(scope: PreviewScope, ratio: number): void;
  stop(): void;
};

export type PreviewOptions = {
  group?: string;
  onBlocked?: () => void;
};

type Registered = { group: string; stop: () => void };

/**
 * Every mounted controller registers here so that starting playback in one
 * group silences the others. Without this, the workbench and the library each
 * think they own the speakers.
 */
const registry = new Set<Registered>();

function stopOtherGroups(group: string) {
  for (const entry of registry) {
    if (entry.group !== group) entry.stop();
  }
}

export function usePreview(options: PreviewOptions = {}): PreviewController {
  const { group = "default", onBlocked } = options;

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scopeRef = useRef<PreviewScope | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sessionRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;

  const stop = useCallback(() => {
    sessionRef.current += 1;
    pendingSeekRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    scopeRef.current = null;
    setPlayingId(null);
    setProgress(0);
  }, []);

  // Register for cross-group exclusivity, and always stop on unmount.
  useEffect(() => {
    const entry: Registered = { group, stop };
    registry.add(entry);
    return () => {
      registry.delete(entry);
      stop();
    };
  }, [group, stop]);

  const applyPosition = useCallback((audio: HTMLAudioElement, scope: PreviewScope, ratio: number) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    setProgress(clamped);
    if (applyPreviewTime(audio, scope, clamped)) {
      pendingSeekRef.current = null;
      return true;
    }
    // Duration is not known yet; replay this seek once metadata arrives.
    pendingSeekRef.current = clamped;
    return false;
  }, []);

  const bind = useCallback((audio: HTMLAudioElement, scope: PreviewScope, sessionId: number) => {
    cleanupRef.current?.();

    let rafId = 0;
    const isCurrent = () => sessionRef.current === sessionId && audioRef.current === audio;

    const update = () => {
      if (!isCurrent()) return;
      if (scope.clip && audio.currentTime >= scope.clip.end - 0.01) {
        if (audio.loop) {
          audio.currentTime = scope.clip.start;
        } else {
          audio.pause();
          setProgress(1);
          return;
        }
      }
      setProgress(progressForAudio(scope, audio.currentTime, audio.duration));
    };

    const tick = () => {
      update();
      if (!isCurrent() || audio.paused) return;
      rafId = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    };
    const onPause = () => cancelAnimationFrame(rafId);

    audio.addEventListener("timeupdate", update);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    cleanupRef.current = () => {
      audio.removeEventListener("timeupdate", update);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      cancelAnimationFrame(rafId);
    };

    if (audio.paused) update();
    else onPlay();
  }, []);

  const play = useCallback((scope: PreviewScope, startRatio = 0) => {
    stopOtherGroups(group);
    stop();
    const sessionId = sessionRef.current;
    const audio = new Audio(resolveAudioUrl(scope.url));
    audioRef.current = audio;
    scopeRef.current = scope;
    audio.loop = !scope.clip;
    audio.volume = 0.72;
    setPlayingId(scope.id);
    pendingSeekRef.current = startRatio > 0 ? startRatio : null;

    const sync = () => {
      if (sessionRef.current !== sessionId || audioRef.current !== audio) return;
      applyPosition(audio, scope, pendingSeekRef.current ?? startRatio);
      bind(audio, scope, sessionId);
    };

    if (audio.readyState >= 1) sync();
    else {
      audio.addEventListener("loadedmetadata", sync, { once: true });
      audio.addEventListener("canplay", sync, { once: true });
    }

    // play() must stay in the user-gesture stack — do not await metadata first.
    playMediaElement(audio, () => onBlockedRef.current?.());
  }, [applyPosition, bind, group, stop]);

  const seek = useCallback((scope: PreviewScope, ratio: number) => {
    const audio = audioRef.current;
    if (!audio || scopeRef.current?.id !== scope.id) {
      play(scope, ratio);
      return;
    }
    applyPosition(audio, scope, ratio);
    if (audio.paused) playMediaElement(audio, () => onBlockedRef.current?.());
  }, [applyPosition, play]);

  const toggle = useCallback((scope: PreviewScope) => {
    if (audioRef.current && scopeRef.current?.id === scope.id) {
      stop();
      return;
    }
    play(scope);
  }, [play, stop]);

  return { playingId, progress, play, toggle, seek, stop };
}
```

- [ ] **Step 5: Adopt the hook in all three call sites**

In `app/fragments-app.tsx`, delete lines 353-461 (`clearPreviewListeners`, `stopAllAudio`, `applyPreviewPosition`, `bindPreviewAudio`, `startPreviewScope`, `seekPreview`) and the five refs at lines 264-268. Replace with one call:

```ts
const preview = usePreview({ onBlocked: () => notify("Playback needs one more click in this browser.") });
```

Then rewrite the two wrappers (`previewSingle` at lines 573-588, `previewSource` at 590-606) as thin scope builders, and replace every `stopAllAudio()` call — there are 19 of them, at lines 358, 431, 463, 481, 626, 668, 679, 694, 705, 745, 754, 761, 767, 858, 863, 887, 1011, 1061, 1063 — with `preview.stop()`:

```ts
const previewFragment = (fragment: FragmentView, startRatio = 0) => {
  const scope = buildFragmentPreviewScope(fragment, sourceForId(fragment.sourceId));
  if (!scope) return;
  if (startRatio > 0) preview.seek(scope, startRatio);
  else preview.toggle(scope);
};

const previewSource = (source: SourceView, startRatio = 0) => {
  const scope = buildSourcePreviewScope(source);
  if (!scope) return;
  if (startRatio > 0) preview.seek(scope, startRatio);
  else preview.toggle(scope);
};
```

Replace the `previewingId` and `previewProgress` state variables (lines 230-231) with `preview.playingId` and `preview.progress`, and delete the unmount effect at line 481 — the hook owns that now.

In `app/fragmentation-workbench.tsx`, delete lines 195-304 and use `usePreview()` the same way. In `app/hero-workflow.tsx`'s `CombineWorkspace`, replace the `audios` ref array with two controllers that share a group so A and B can sound together:

```ts
const trackA = usePreview({ group: "combine" });
const trackB = usePreview({ group: "combine" });
```

- [ ] **Step 6: Fix the audio cache leak**

`releaseCachedAudio` (`lib/audio/audio-cache.ts:46-51`) only decrements; nothing removes the map entry or revokes the blob created at `audio-service.ts:157`. Replace lines 46-51 with an eviction that also clears any aliases pointing at the evicted key:

```ts
/**
 * Drops one reference. At zero the decoded entry is evicted and its blob URL is
 * revoked — otherwise every import leaks an object URL for the whole session.
 */
export function releaseCachedAudio(keyOrAlias: string) {
  const cacheKey = resolveCacheKey(keyOrAlias);
  const entry = entries.get(cacheKey);
  if (!entry) return;

  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  entries.delete(cacheKey);
  for (const [alias, target] of aliases) {
    if (target === cacheKey) aliases.delete(alias);
  }
  if (entry.objectUrl.startsWith("blob:")) URL.revokeObjectURL(entry.objectUrl);
  notify(cacheKey);
}
```

Call it when a source leaves the library. In `app/fragments-app.tsx`'s `removeSource` (lines 701-742), add `releaseCachedAudio(\`source:${sourceId}\`)` alongside the existing `archiveSource` bridge call.

- [ ] **Step 7: Verify**

Run:

```bash
npm run check
```

Expected: exit 0, 48 unit tests passing (41 from Task 4 plus 7 new).

Run `npm run dev:all` and check the behaviours the three engines used to get subtly different:
- Clicking play on a library card plays only that fragment's slice and stops at its end.
- Scrubbing a card's waveform seeks within the slice, not the whole file.
- Starting a workbench preview stops a library preview, and vice versa. This is new; previously both could sound at once.
- In Combine, A and B can play together, and starting either one silences the library.
- Navigating between views stops playback.
- Import a source, remove it, then check DevTools: no `blob:` URL remains for it.

- [ ] **Step 8: Review checkpoint**

Confirm only one file constructs an `HTMLAudioElement`:

```bash
rg -n "new Audio\(" app lib
```

Expected: exactly one match, in `lib/audio/preview/use-preview.ts`. Commit only if the user explicitly requests it.

---

### Task 6: Extract affinity scoring and gate the affinity surfaces

Affinity logic is ~90 lines buried inside the god component: `scoreRelationship` (`fragments-app.tsx:192-212`), `rankedConnectionsFor` (492-523), `linkSummaryFor` (525-528), `relatedTakeCountFor` (530), and the map derivations (1052-1058). It is untestable where it sits, and it contains hardcoded demo results — line 499 returns a literal `94` when the anchor is `"f01"` and a literal `76` once fragment `"f02"` has been edited.

After Task 4 there is no relationship data at all, so the three surfaces that depend on it (Matches, Map, Combine) render empty. This task makes the *logic* pure and testable, and puts the *UI* behind one flag so the app does not ship three dead-looking panels.

**Files:**
- Create: `lib/affinity/types.ts`
- Create: `lib/affinity/score.ts`
- Create: `lib/affinity/rank.ts`
- Create: `lib/affinity/map-layout.ts`
- Create: `lib/affinity/flag.ts`
- Create: `tests/unit/affinity.test.mjs`
- Create: `tests/unit/map-layout.test.mjs`
- Delete: `app/map-layout.mjs`
- Modify: `app/fragments-app.tsx` (delete lines 192-212, 492-530, 1052-1058, and the correction workflow at 890-893, 1042-1051, 1066-1069)
- Modify: `tests/smoke/rendered-html.test.mjs` (drop the map test, now a unit test)

**Interfaces:**
- Consumes: `FragmentView` from Task 4.
- Produces: `Affinity`, `AffinityMetrics`, `AffinityTransform`, `AffinityStatus`, `SearchContext`, `SearchWeights`, `MatchTolerances`, `DEFAULT_WEIGHTS`, `DEFAULT_TOLERANCES` from `lib/affinity/types.ts`.
- Produces: `scoreAffinity(affinity: Affinity, weights: SearchWeights, context: SearchContext, mode: RangeMode): number`.
- Produces: `rankAffinities(input: RankInput): ScoredAffinity[]`.
- Produces: `musicalMapPoint(fragment: MapFragment): { x: number; y: number }` plus the existing camera helpers.
- Produces: `AFFINITIES_ENABLED: boolean`.

- [ ] **Step 1: Write the failing affinity tests**

Fixtures are inline and minimal — this is exactly the kind of pure module that is cheap to test and worth testing. Create `tests/unit/affinity.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TOLERANCES, DEFAULT_WEIGHTS } from "../../electron-dist/lib/affinity/types.js";
import { scoreAffinity } from "../../electron-dist/lib/affinity/score.js";
import { rankAffinities } from "../../electron-dist/lib/affinity/rank.js";

function affinity(overrides = {}) {
  return {
    id: "a1",
    sourceFragmentId: "f-a",
    targetFragmentId: "f-b",
    base: 0.9,
    metrics: {
      rhythm: 0.8, harmony: 0.9, melody: 0.9,
      timbre: 0.7, tempo: 0.9, pitch: 0.95, brightness: 0.7,
    },
    transformationCost: 0.02,
    reason: "",
    ...overrides,
  };
}

function fragment(id, overrides = {}) {
  return {
    id, sourceId: "src-1", sourceName: "s.wav", name: id,
    start: 0, end: 20, durationLabel: "0:20",
    role: "Harmony", roles: ["Harmony"], userTags: [],
    bpm: 90, keyLabel: "A minor", keyStrength: 80,
    waveform: [], createdAt: "2026-01-01T00:00:00.000Z",
    createdAtLabel: "Jan 01, 2026", analysisRevision: 1,
    ...overrides,
  };
}

test("scores fall inside 0-99", () => {
  const score = scoreAffinity(affinity(), DEFAULT_WEIGHTS, "whole", "reasonable");
  assert.ok(score >= 0 && score <= 99, `got ${score}`);
});

test("scoring is deterministic", () => {
  const input = affinity();
  assert.equal(
    scoreAffinity(input, DEFAULT_WEIGHTS, "whole", "reasonable"),
    scoreAffinity(input, DEFAULT_WEIGHTS, "whole", "reasonable"),
  );
});

test("the melody context rewards melodic similarity over rhythmic similarity", () => {
  const melodic = affinity({ metrics: { ...affinity().metrics, melody: 0.99, rhythm: 0.1 } });
  const rhythmic = affinity({ metrics: { ...affinity().metrics, melody: 0.1, rhythm: 0.99 } });
  assert.ok(
    scoreAffinity(melodic, DEFAULT_WEIGHTS, "melody", "reasonable")
      > scoreAffinity(rhythmic, DEFAULT_WEIGHTS, "melody", "reasonable"),
  );
});

test("the rhythm context inverts that preference", () => {
  const melodic = affinity({ metrics: { ...affinity().metrics, melody: 0.99, rhythm: 0.1 } });
  const rhythmic = affinity({ metrics: { ...affinity().metrics, melody: 0.1, rhythm: 0.99 } });
  assert.ok(
    scoreAffinity(rhythmic, DEFAULT_WEIGHTS, "rhythm", "reasonable")
      > scoreAffinity(melodic, DEFAULT_WEIGHTS, "rhythm", "reasonable"),
  );
});

test("experimental mode discounts transformation cost", () => {
  const costly = affinity({ transformationCost: 0.3 });
  assert.ok(
    scoreAffinity(costly, DEFAULT_WEIGHTS, "whole", "experimental")
      > scoreAffinity(costly, DEFAULT_WEIGHTS, "whole", "reasonable"),
  );
});

test("ranking returns nothing when there are no affinities", () => {
  assert.deepEqual(
    rankAffinities({
      anchorId: "f-a",
      affinities: [],
      fragmentsById: new Map([["f-a", fragment("f-a")]]),
      weights: DEFAULT_WEIGHTS,
      tolerances: DEFAULT_TOLERANCES,
      context: "whole",
      mode: "reasonable",
      manualIds: new Set(),
      archivedIds: new Set(),
    }),
    [],
  );
});

test("ranking sorts by score and honours the limit", () => {
  const fragmentsById = new Map([
    ["f-a", fragment("f-a")],
    ["f-b", fragment("f-b")],
    ["f-c", fragment("f-c")],
  ]);
  const ranked = rankAffinities({
    anchorId: "f-a",
    affinities: [
      affinity({ id: "weak", targetFragmentId: "f-b", base: 0.2, metrics: { ...affinity().metrics, harmony: 0.2, melody: 0.2 } }),
      affinity({ id: "strong", targetFragmentId: "f-c" }),
    ],
    fragmentsById,
    weights: DEFAULT_WEIGHTS,
    tolerances: DEFAULT_TOLERANCES,
    context: "whole",
    mode: "reasonable",
    manualIds: new Set(),
    archivedIds: new Set(),
    limit: 1,
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "strong");
  assert.equal(ranked[0].otherId, "f-c");
});

test("ranking drops archived targets", () => {
  const ranked = rankAffinities({
    anchorId: "f-a",
    affinities: [affinity()],
    fragmentsById: new Map([["f-a", fragment("f-a")], ["f-b", fragment("f-b")]]),
    weights: DEFAULT_WEIGHTS,
    tolerances: DEFAULT_TOLERANCES,
    context: "whole",
    mode: "reasonable",
    manualIds: new Set(),
    archivedIds: new Set(["f-b"]),
  });
  assert.deepEqual(ranked, []);
});

test("a manual affinity survives tolerances that would otherwise reject it", () => {
  const outOfTempo = affinity({ id: "manual-1" });
  const fragmentsById = new Map([
    ["f-a", fragment("f-a", { bpm: 90 })],
    ["f-b", fragment("f-b", { bpm: 180 })],
  ]);
  const base = {
    anchorId: "f-a",
    affinities: [outOfTempo],
    fragmentsById,
    weights: DEFAULT_WEIGHTS,
    tolerances: { ...DEFAULT_TOLERANCES, tempoWindow: 5 },
    context: "whole",
    mode: "reasonable",
    archivedIds: new Set(),
  };
  assert.equal(rankAffinities({ ...base, manualIds: new Set() }).length, 0);
  assert.equal(rankAffinities({ ...base, manualIds: new Set(["manual-1"]) }).length, 1);
});
```

- [ ] **Step 2: Write the failing map-layout test**

The existing map assertions live in the smoke test (`tests/smoke/rendered-html.test.mjs:112-137`) even though they test pure math and need no build. Move them into a real unit test and add coverage for the new axis. Create `tests/unit/map-layout.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_SCALE_MAX,
  MAP_SCALE_MIN,
  MAP_WORLD,
  clampMapCamera,
  fitMapCamera,
  musicalMapPoint,
  panMapCamera,
  zoomMapCameraAt,
} from "../../electron-dist/lib/affinity/map-layout.js";

const fragment = { id: "f-test", role: "Rhythm", roles: ["Rhythm"], bpm: 120, keyStrength: 40 };

test("map points are deterministic and stay inside the padded world", () => {
  assert.deepEqual(musicalMapPoint(fragment), musicalMapPoint(fragment));
  const point = musicalMapPoint(fragment);
  assert.ok(point.x >= MAP_WORLD.padX && point.x <= MAP_WORLD.width - MAP_WORLD.padX);
  assert.ok(point.y >= MAP_WORLD.padY && point.y <= MAP_WORLD.height - MAP_WORLD.padY);
});

test("a melodic fragment sits further along the tonal axis than a textural one", () => {
  const melody = musicalMapPoint({ ...fragment, role: "Melody", roles: ["Melody"] });
  const texture = musicalMapPoint({ ...fragment, role: "Texture", roles: ["Texture"] });
  assert.ok(melody.x > texture.x);
});

test("a faster fragment sits higher on the tempo axis", () => {
  const fast = musicalMapPoint({ ...fragment, bpm: 170 });
  const slow = musicalMapPoint({ ...fragment, bpm: 60 });
  assert.ok(fast.y < slow.y, "higher on screen means a smaller y");
});

test("a fragment with no measured tempo lands mid-axis instead of at an edge", () => {
  const unknown = musicalMapPoint({ ...fragment, bpm: null });
  assert.ok(unknown.y > MAP_WORLD.padY + 100 && unknown.y < MAP_WORLD.height - MAP_WORLD.padY - 100);
});

test("zooming keeps the point under the cursor fixed", () => {
  const viewport = { width: 960, height: 640 };
  const fitted = fitMapCamera(viewport);
  assert.ok(fitted.scale >= MAP_SCALE_MIN && fitted.scale <= MAP_SCALE_MAX);
  const cursor = { x: 410, y: 280 };
  const before = { x: (cursor.x - fitted.x) / fitted.scale, y: (cursor.y - fitted.y) / fitted.scale };
  const zoomed = zoomMapCameraAt(fitted, fitted.scale * 1.3, cursor, viewport);
  const after = { x: (cursor.x - zoomed.x) / zoomed.scale, y: (cursor.y - zoomed.y) / zoomed.scale };
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

test("zoom clamps to the configured scale range", () => {
  const viewport = { width: 960, height: 640 };
  const fitted = fitMapCamera(viewport);
  const cursor = { x: 410, y: 280 };
  assert.equal(zoomMapCameraAt(fitted, 99, cursor, viewport).scale, MAP_SCALE_MAX);
  assert.equal(zoomMapCameraAt(fitted, 0.001, cursor, viewport).scale, MAP_SCALE_MIN);
  assert.equal(fitMapCamera({ width: 360, height: 600 }).scale, MAP_SCALE_MIN);
});

test("panning clamps to the world edges and preserves scale", () => {
  const viewport = { width: 960, height: 640 };
  const zoomed = clampMapCamera({ x: 0, y: 0, scale: 1 }, viewport);
  assert.equal(panMapCamera(zoomed, -120, 70, viewport).scale, zoomed.scale);
  assert.equal(panMapCamera({ x: 0, y: 0, scale: 1 }, -10_000, 0, viewport).x, viewport.width - MAP_WORLD.width - 48);
  assert.equal(panMapCamera({ x: 0, y: 0, scale: 1 }, 10_000, 0, viewport).x, 48);
});
```

Delete the third test in `tests/smoke/rendered-html.test.mjs` (lines 112-137) and its `map-layout.mjs` import (line 4). The smoke file is then down to the single `"renders the packaged Fragments shell"` test, which is all it should ever have been.

- [ ] **Step 3: Run the tests to verify they fail**

Run:

```bash
npm run test:unit
```

Expected: FAIL with `Cannot find module .../electron-dist/lib/affinity/types.js`.

- [ ] **Step 4: Define the affinity types**

Add `"../lib/affinity/**/*.ts"` to `electron/tsconfig.json`'s `include` array so the two new test files can import the compiled output. Everything in `lib/affinity/` is dually compiled, so it must stay free of `node:*` and DOM globals — the React state that wraps these modules lives in `app/features/affinities/use-affinities.ts` (Task 8), not here.

Create `lib/affinity/types.ts`. These are the relationship types moved out of `prototype-data.ts:44-88`, renamed from "relationship" to "affinity" to match the product language, with the fragment-id fields named unambiguously (`source`/`target` previously read as source *files*, which they were not).

```ts
export type SearchContext = "whole" | "melody" | "rhythm" | "harmony" | "bass";
export type RangeMode = "reasonable" | "experimental";
export type AffinityStatus = "suggested" | "auditioned" | "rejected" | "manual" | "preferred";

export type AffinityMetrics = {
  rhythm: number;
  harmony: number;
  melody: number;
  timbre: number;
  tempo: number;
  pitch: number;
  brightness: number;
};

export type AffinityTransform = {
  pitch?: number;
  bpm?: number;
  timing?: "half-time" | "double-time";
  beatOffset?: number;
  repeat?: number;
  labels: string[];
};

export type Affinity = {
  id: string;
  sourceFragmentId: string;
  targetFragmentId: string;
  base: number;
  metrics: AffinityMetrics;
  transformationCost: number;
  reason: string;
  transform?: AffinityTransform;
  experimental?: boolean;
  status?: AffinityStatus;
};

export type ScoredAffinity = Affinity & { score: number; otherId: string };

export type SearchWeights = {
  rhythm: number;
  harmony: number;
  melody: number;
  timbre: number;
};

export type MatchTolerances = {
  /** Percent difference in BPM still considered a match. */
  tempoWindow: number;
  keyFlexibility: "exact" | "related" | "nearby";
  /** Fragment-length agreement, in seconds of difference. */
  lengthTolerance: "same" | "close" | "any";
  allowRepetition: boolean;
};

export const DEFAULT_WEIGHTS: SearchWeights = { rhythm: 54, harmony: 72, melody: 68, timbre: 36 };

export const DEFAULT_TOLERANCES: MatchTolerances = {
  tempoWindow: 10,
  keyFlexibility: "related",
  lengthTolerance: "close",
  allowRepetition: true,
};

export const SEARCH_CONTEXTS: { id: SearchContext; label: string }[] = [
  { id: "whole", label: "Whole" },
  { id: "melody", label: "Melody" },
  { id: "rhythm", label: "Rhythm" },
  { id: "harmony", label: "Harmony" },
  { id: "bass", label: "Bass" },
];
```

`Transform.asset` is deliberately gone. It pointed at hand-made audition WAVs (`/audio/f02_match.wav`) deleted in Task 4; a real transformed audition has to be rendered, not looked up.

- [ ] **Step 5: Extract the scorer**

Create `lib/affinity/score.ts` by moving `fragments-app.tsx:192-212` verbatim, minus the demo overrides:

```ts
import type { Affinity, RangeMode, SearchContext, SearchWeights } from "./types";

/** Per-context emphasis applied on top of the user's weights. */
const CONTEXT_MULTIPLIERS: Record<SearchContext, SearchWeights> = {
  whole: { rhythm: 1, harmony: 1, melody: 1, timbre: 1 },
  melody: { rhythm: 0.28, harmony: 0.72, melody: 2.5, timbre: 0.55 },
  rhythm: { rhythm: 2.8, harmony: 0.22, melody: 0.18, timbre: 0.72 },
  harmony: { rhythm: 0.42, harmony: 2.6, melody: 0.66, timbre: 0.5 },
  bass: { rhythm: 1.8, harmony: 1.45, melody: 0.24, timbre: 1.25 },
};

/** Weight of the always-on metrics (tempo, pitch, brightness) in the total. */
const FIXED_WEIGHT = 30;

export function scoreAffinity(
  affinity: Affinity,
  weights: SearchWeights,
  context: SearchContext,
  mode: RangeMode,
): number {
  const multipliers = CONTEXT_MULTIPLIERS[context];
  const adjusted: SearchWeights = {
    rhythm: weights.rhythm * multipliers.rhythm,
    harmony: weights.harmony * multipliers.harmony,
    melody: weights.melody * multipliers.melody,
    timbre: weights.timbre * multipliers.timbre,
  };

  const { metrics } = affinity;
  const weighted = metrics.rhythm * adjusted.rhythm
    + metrics.harmony * adjusted.harmony
    + metrics.melody * adjusted.melody
    + metrics.timbre * adjusted.timbre;
  const fixed = metrics.tempo * 12 + metrics.pitch * 10 + metrics.brightness * 8;
  const totalWeight = adjusted.rhythm + adjusted.harmony + adjusted.melody + adjusted.timbre + FIXED_WEIGHT;

  const similarity = (weighted + fixed) / totalWeight;
  const penalty = affinity.transformationCost * (mode === "experimental" ? 0.46 : 1);
  return Math.round(Math.max(0, Math.min(99, (similarity * 0.9 + affinity.base * 0.1 - penalty) * 100)));
}
```

- [ ] **Step 6: Extract the ranker**

Create `lib/affinity/rank.ts` from `fragments-app.tsx:492-528`. Two filters have to change because their data no longer exists: the bar-count comparison (lines 514-516) becomes a duration comparison, and the `duplicateGroup` exclusion (line 505) is dropped.

```ts
import type { FragmentView } from "../view/fragment-view";
import { scoreAffinity } from "./score";
import type { Affinity, MatchTolerances, RangeMode, ScoredAffinity, SearchContext, SearchWeights } from "./types";

export type RankInput = {
  anchorId: string;
  affinities: Affinity[];
  fragmentsById: Map<string, FragmentView>;
  weights: SearchWeights;
  tolerances: MatchTolerances;
  context: SearchContext;
  mode: RangeMode;
  /** Affinities the user asserted by hand; these bypass every tolerance. */
  manualIds: Set<string>;
  archivedIds: Set<string>;
  limit?: number;
};

const KEY_STRENGTH_FLOOR: Record<MatchTolerances["keyFlexibility"], number> = {
  exact: 0.96,
  related: 0.78,
  nearby: 0.62,
};

const LENGTH_TOLERANCE_SECONDS: Record<MatchTolerances["lengthTolerance"], number> = {
  same: 0.5,
  close: 4,
  any: Number.POSITIVE_INFINITY,
};

function otherIdFor(affinity: Affinity, anchorId: string): string {
  return affinity.sourceFragmentId === anchorId ? affinity.targetFragmentId : affinity.sourceFragmentId;
}

const seconds = (fragment: FragmentView) => fragment.end - fragment.start;

export function rankAffinities(input: RankInput): ScoredAffinity[] {
  const { anchorId, affinities, fragmentsById, weights, tolerances, context, mode } = input;
  const anchor = fragmentsById.get(anchorId);
  if (!anchor) return [];

  const seen = new Set<string>();

  return affinities
    .filter((affinity) => affinity.sourceFragmentId === anchorId || affinity.targetFragmentId === anchorId)
    .map((affinity) => ({
      ...affinity,
      score: scoreAffinity(affinity, weights, context, mode),
      otherId: otherIdFor(affinity, anchorId),
    }))
    .filter((affinity) => {
      const target = fragmentsById.get(affinity.otherId);
      if (!target || seen.has(target.id) || input.archivedIds.has(target.id)) return false;

      if (!input.manualIds.has(affinity.id)) {
        if (mode === "reasonable" && (affinity.experimental || affinity.transformationCost > 0.12)) return false;

        if (anchor.bpm !== null && target.bpm !== null) {
          const transformedBpm = target.bpm + (affinity.transform?.bpm ?? 0);
          const drift = Math.abs(transformedBpm - anchor.bpm) / Math.max(1, anchor.bpm) * 100;
          if (drift > tolerances.tempoWindow) return false;
        }

        if (affinity.metrics.pitch < KEY_STRENGTH_FLOOR[tolerances.keyFlexibility]) return false;

        const lengthDelta = Math.abs(seconds(target) - seconds(anchor));
        if (lengthDelta > LENGTH_TOLERANCE_SECONDS[tolerances.lengthTolerance]) return false;

        if (!tolerances.allowRepetition && (affinity.transform?.repeat ?? 1) > 1) return false;
      }

      seen.add(target.id);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 6);
}

export function affinitySummary(input: RankInput) {
  const eligible = rankAffinities({ ...input, limit: input.affinities.length });
  return {
    total: eligible.length,
    manual: eligible.filter((affinity) => input.manualIds.has(affinity.id)).length,
  };
}
```

Note the tempo filter now *skips* rather than rejects when either BPM is unmeasured. Rejecting would silently hide every unanalyzed fragment.

- [ ] **Step 7: Port the map layout with honest axes**

The old y-axis was "Timbral brightness", driven by `Fragment.brightness` — a hand-authored 0-100 number with no measurable source. Its x-axis mixed role with a certainty parsed out of prototype key strings like `"Likely C minor"`.

Port `app/map-layout.mjs` to `lib/affinity/map-layout.ts`, keeping the camera math identical and replacing both axis inputs with persisted values: role plus real `keyStrength` on x, and real `bpm` on y.

```ts
export const MAP_WORLD = Object.freeze({ width: 1280, height: 760, padX: 72, padY: 62 });
export const MAP_SCALE_MIN = 0.28;
export const MAP_SCALE_MAX = 2.5;

/** Tempo range the vertical axis spans. Outside it, points clamp to the edge. */
const BPM_MIN = 50;
const BPM_MAX = 190;

const ROLE_TONAL: Record<string, number> = {
  Texture: 0.08,
  Rhythm: 0.16,
  Bass: 0.4,
  Harmony: 0.64,
  Voice: 0.8,
  Melody: 0.92,
  Unclassified: 0.5,
};

export type MapFragment = {
  id: string;
  role: string;
  roles: string[];
  bpm: number | null;
  keyStrength: number | null;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const stableHash = (value: string) =>
  Array.from(value).reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);

export function musicalMapPoint(fragment: MapFragment): { x: number; y: number } {
  const primary = ROLE_TONAL[fragment.role] ?? 0.5;
  const secondaryRoles = fragment.roles.filter((role) => role !== fragment.role);
  const secondary = secondaryRoles.length
    ? secondaryRoles.reduce((sum, role) => sum + (ROLE_TONAL[role] ?? primary), 0) / secondaryRoles.length
    : primary;

  // Unmeasured key strength contributes neutrally rather than pulling to an edge.
  const certainty = fragment.keyStrength === null ? 0.5 : clamp(fragment.keyStrength / 100, 0, 1);
  const tonal = clamp((primary * 0.8 + secondary * 0.2) * 0.82 + certainty * 0.18, 0, 1);

  // Unmeasured tempo sits mid-axis for the same reason.
  const tempo = fragment.bpm === null
    ? 0.5
    : clamp((fragment.bpm - BPM_MIN) / (BPM_MAX - BPM_MIN), 0, 1);

  const hash = stableHash(fragment.id);
  const jitterX = ((hash % 9) - 4) * 2.5;
  const jitterY = (((hash >>> 4) % 9) - 4) * 2;

  return {
    x: clamp(
      MAP_WORLD.padX + tonal * (MAP_WORLD.width - MAP_WORLD.padX * 2) + jitterX,
      MAP_WORLD.padX,
      MAP_WORLD.width - MAP_WORLD.padX,
    ),
    y: clamp(
      MAP_WORLD.padY + (1 - tempo) * (MAP_WORLD.height - MAP_WORLD.padY * 2) + jitterY,
      MAP_WORLD.padY,
      MAP_WORLD.height - MAP_WORLD.padY,
    ),
  };
}
```

Copy `clampMapCamera`, `fitMapCamera`, `zoomMapCameraAt`, and `panMapCamera` from `map-layout.mjs:28-55` unchanged, adding the parameter types their JSDoc already documented. Then `git rm app/map-layout.mjs`.

Update the axis labels in the map markup (`fragments-app.tsx:1223-1224` and the `#map-help` text at line 1236) to describe what is now plotted:

```tsx
<div className="map-axis map-axis-x" aria-hidden="true">
  <span>Unpitched / textural</span><b>Tonal focus</b><span>Pitched / melodic</span>
</div>
<div className="map-axis map-axis-y" aria-hidden="true">
  <span>Faster</span><b>Tempo</b><span>Slower</span>
</div>
```

```tsx
<span id="map-help" className="sr-only">
  Horizontal position moves from unpitched and textural to pitched and melodic.
  Vertical position moves from faster to slower tempo. Fragments with no measured
  tempo or key sit at the middle of their axis.
</span>
```

- [ ] **Step 8: Add the flag**

Create `lib/affinity/flag.ts`:

```ts
/**
 * Affinity surfaces — the Matches panel, the Map, the Combine workspace, and
 * duplicate-take grouping — need an affinity graph. The authored demo graph was
 * removed with `app/prototype-data.ts`, and nothing computes a real one yet.
 *
 * The scoring and ranking modules in this directory are complete and tested, so
 * turning this on is a matter of writing a generator that produces `Affinity`
 * records from `MeasuredAnalysis` and persisting them via
 * `window.fragments.updateRelationships`.
 *
 * Typed as `boolean` rather than `false` on purpose: literal narrowing would
 * make the enabled branches unreachable and stop them being type-checked.
 */
export const AFFINITIES_ENABLED: boolean = false;
```

Gate the three surfaces in `app/fragments-app.tsx`:
- The `Map` nav button (line 1099) renders only when `AFFINITIES_ENABLED`, and `navigate("map")` falls back to `"library"` when it is off.
- The Matches side panel (lines 1158-1193) and `connectionsOpen` state stay unset when off.
- `CombineWorkspace` (line 1106), `ExportSheet` (line 1279), and `DuplicateTakesDialog` (line 1266) render only when on.
- `LibraryCard`'s affinity count and "Open matches" action hide when off, so cards do not show `0 matches` for every fragment.

When the flag is on but a fragment has no affinities, keep the existing empty state in `connections-table.tsx` ("No authored matches for this fragment") — reword it to "No matches found for this fragment yet."

- [ ] **Step 9: Delete the demo correction workflow**

This flow only ever produced hardcoded results and cannot work without authored data. Remove:
- `beginCombineSourceEdit` (lines 890-893) and `saveCombineSourceBoundaries` (1042-1051). The latter writes literal values — `key:"C minor"`, `bpm:90`, `bars:3`, `beats:17`, `confidence:.93`, `score:76` — into state at line 1047.
- `keepCorrectionLink` / `rejectCorrectionLink` (lines 1050-1051).
- The `correctionRelationship`, `correctionPhase`, `correctionOriginal`, `combineDraftRanges`, `combineDraftSensitivity` state (lines 250-254) and the `CorrectionPhase` type (line 63).
- `correctionFooter` and the `editorRanges` / `editorSensitivity` / `correctedRange` indirection (lines 1066-1069), which existed solely to swap the workbench between real and draft ranges. The workbench now always edits the selected source's real ranges.
- `addCombineFragment` and `updateCombineSensitivity` (lines 544-554).

Also delete `resetDemo` (lines 679-683). Its button was already commented out at line 1103, and it restores a dataset that no longer exists.

- [ ] **Step 10: Verify**

Run:

```bash
npm run check
```

Expected: exit 0, 64 unit tests passing (48 from Task 5, 9 affinity, 7 map-layout), and the smoke suite down to its single packaged-HTML test.

Run `npm run dev:all`. Expected with the flag off: the top bar shows Library and Sources only; library cards show no match counts; importing, slicing, renaming, previewing, and dragging out all work. Then set `AFFINITIES_ENABLED = true` and confirm the Map renders every fragment positioned by real role/tempo with no edges, and the Matches panel shows its empty state rather than crashing.

- [ ] **Step 11: Review checkpoint**

Confirm no hardcoded ids survive:

```bash
rg -n '"r0[0-9]"|"f0[0-9]"|correctionPhase|resetDemo' app lib
```

Expected: no matches. Commit only if the user explicitly requests it.

---

### Task 7: One owner of library data

Library data currently lives in five overlapping pieces of state in `app/fragments-app.tsx`, all mutated independently: `sources` (line 228), `importedFragments` (246), `importedRelationships` (247), `fragmentOverrides` (245), and `savedFragmentIds` (248). A single edit can require updating four of them in the right order — `saveSourceBoundaries` (lines 910-943) touches all five plus `sourceRanges`. Meanwhile the 63-line load effect (276-339) inlines the same document-to-view mapping that Task 4 extracted, and a load failure only reaches `console.error` (line 338) with nothing shown to the user.

Documents on disk are already the source of truth. This task makes the renderer agree.

**Files:**
- Create: `app/state/use-library.ts`
- Modify: `app/fragments-app.tsx` (delete lines 228, 242, 245-248, 276-339, 608-623, 701-742, 768-857, 894-1041)

**Interfaces:**
- Consumes: `SourceDocumentWithAudio`, `FragmentsBridge` (Task 3); `SourceView`, `FragmentView` (Task 4); `Affinity` (Task 6).
- Produces:

```ts
export type LibraryStatus = "loading" | "ready" | "error" | "unavailable";

export type Library = {
  documents: SourceDocumentWithAudio[];
  sources: SourceView[];
  fragments: FragmentView[];
  fragmentsById: Map<string, FragmentView>;
  affinities: Affinity[];
  status: LibraryStatus;
  error: string | null;

  sourceById(id: string): SourceView | undefined;
  fragmentById(id: string): FragmentView | undefined;
  fragmentsForSource(sourceId: string): FragmentView[];

  refresh(): Promise<void>;
  saveAnalysis(sourceId: string, analysis: MeasuredAnalysis): Promise<void>;
  saveSettings(sourceId: string, settings: { sourceTypes?: SourceType[]; sensitivity?: number }): Promise<void>;
  saveFragments(sourceId: string, fragments: FragmentDocument[]): Promise<void>;
  archiveSource(sourceId: string): Promise<void>;
  /** Splice a freshly finalized import in without a full re-read. */
  adoptDocument(document: SourceDocumentWithAudio): void;
};

export function useLibrary(options?: { onError?: (message: string) => void }): Library;
```

- [ ] **Step 1: Write the hook**

Create `app/state/use-library.ts`. Every mutation sends the change to disk and then splices the returned document into state, so there is exactly one code path from "changed" to "rendered".

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FragmentDocument, MeasuredAnalysis, SourceType } from "@/lib/domain/source-document";
import type { SourceDocumentWithAudio } from "@/lib/ipc/contract";
import type { Affinity } from "@/lib/affinity/types";
import { fragmentViewsFromDocument, type FragmentView } from "@/lib/view/fragment-view";
import { sourceViewFromDocument, type SourceView } from "@/lib/view/source-view";

export type LibraryStatus = "loading" | "ready" | "error" | "unavailable";

export function useLibrary(options: { onError?: (message: string) => void } = {}) {
  const [documents, setDocuments] = useState<SourceDocumentWithAudio[]>([]);
  const [status, setStatus] = useState<LibraryStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  /** Replace one document in place, or append it if it is new. */
  const adoptDocument = useCallback((document: SourceDocumentWithAudio) => {
    setDocuments((current) => {
      const index = current.findIndex((item) => item.id === document.id);
      if (index === -1) return [...current, document];
      const next = current.slice();
      next[index] = document;
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    const bridge = window.fragments;
    if (!bridge) {
      // Plain-browser mode: there is no library to read, and pretending
      // otherwise is what produced the old silent-empty-list behaviour.
      setStatus("unavailable");
      return;
    }
    try {
      setDocuments(await bridge.listSources());
      setStatus("ready");
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not read the library.";
      setStatus("error");
      setError(message);
      onErrorRef.current?.(message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs a bridge mutation and adopts the document it returns. */
  const mutate = useCallback(async (
    fallbackMessage: string,
    run: (bridge: NonNullable<typeof window.fragments>) => Promise<SourceDocumentWithAudio>,
  ) => {
    const bridge = window.fragments;
    if (!bridge) return;
    try {
      adoptDocument(await run(bridge));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : fallbackMessage;
      setError(message);
      onErrorRef.current?.(message);
    }
  }, [adoptDocument]);

  const saveAnalysis = useCallback(
    (sourceId: string, analysis: MeasuredAnalysis) =>
      mutate("Could not save metadata to disk.", (bridge) => bridge.updateSourceAnalysis(sourceId, analysis)),
    [mutate],
  );

  const saveSettings = useCallback(
    (sourceId: string, settings: { sourceTypes?: SourceType[]; sensitivity?: number }) =>
      mutate("Could not save source settings.", (bridge) => bridge.updateSourceSettings(sourceId, settings)),
    [mutate],
  );

  const saveFragments = useCallback(
    (sourceId: string, fragments: FragmentDocument[]) =>
      mutate("Could not save fragments.", (bridge) => bridge.updateFragments(sourceId, fragments)),
    [mutate],
  );

  const archiveSource = useCallback(async (sourceId: string) => {
    const bridge = window.fragments;
    if (!bridge) return;
    try {
      await bridge.archiveSource(sourceId);
      setDocuments((current) => current.filter((item) => item.id !== sourceId));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not remove the source.";
      setError(message);
      onErrorRef.current?.(message);
    }
  }, []);

  const sources = useMemo(() => documents.map(sourceViewFromDocument), [documents]);
  const fragments = useMemo(() => documents.flatMap(fragmentViewsFromDocument), [documents]);
  const affinities = useMemo(
    () => documents.flatMap((document) => document.relationships as Affinity[]),
    [documents],
  );

  const sourcesById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const fragmentsById = useMemo(() => new Map(fragments.map((fragment) => [fragment.id, fragment])), [fragments]);

  return useMemo(() => ({
    documents,
    sources,
    fragments,
    fragmentsById,
    affinities,
    status,
    error,
    sourceById: (id: string) => sourcesById.get(id),
    fragmentById: (id: string) => fragmentsById.get(id),
    fragmentsForSource: (sourceId: string) => fragments.filter((fragment) => fragment.sourceId === sourceId),
    refresh,
    saveAnalysis,
    saveSettings,
    saveFragments,
    archiveSource,
    adoptDocument,
  }), [
    documents, sources, fragments, fragmentsById, sourcesById, affinities, status, error,
    refresh, saveAnalysis, saveSettings, saveFragments, archiveSource, adoptDocument,
  ]);
}

export type Library = ReturnType<typeof useLibrary>;
```

- [ ] **Step 2: Delete the shadow state**

In `app/fragments-app.tsx`, replace all five state declarations and the load effect with one call:

```ts
const library = useLibrary({ onError: notify });
```

Then remove the machinery that existed only to reconcile those five pieces:
- `fragmentOverrides` and its five update sites (lines 655-665, 803-807, 928, 977-978, 1021-1025). A rename or a boundary edit now writes a `FragmentDocument` through `library.saveFragments`.
- `savedFragmentIds` and the "Saved" badge state (lines 248, 797, 935, 952, 983, 1026-1030). Every card is saved, because saving is the only way a fragment exists.
- `importedFragments`, `importedRelationships`, `importComplete`.
- `sourceRanges` state (line 242). Ranges are derived from the selected source's persisted fragments:

```ts
const selectedRanges = useMemo<EditableRange[]>(() => {
  if (!selectedSource) return [];
  return library.fragmentsForSource(selectedSource.id).map((fragment, index) => ({
    id: `${fragment.id}-range`,
    fragmentId: fragment.id,
    start: fragment.start,
    end: fragment.end,
    color: RANGE_COLORS[index % RANGE_COLORS.length],
  }));
}, [library, selectedSource]);
```

Draft ranges added by "Add fragment" are the one thing not yet on disk, so they need local state — but only that:

```ts
const [draftRanges, setDraftRanges] = useState<EditableRange[]>([]);
const editorRanges = useMemo(() => [...selectedRanges, ...draftRanges], [selectedRanges, draftRanges]);
```

- [ ] **Step 3: Collapse the fragment mutation functions**

Ten functions currently exist to keep the shadow state consistent: `persistFragmentsForSource`, `promoteRangeToFragment`, `saveSourceBoundaries`, `commitPromotedRange`, `rangeForFragmentCardId`, `renameFragmentOrRange`, `renameFragment`, `saveFragment`, `saveFragmentOrRange`, and `deleteFragmentOrRange` (lines 894-1041, ~150 lines). The "promote a draft into a real fragment" concept disappears, because a draft range simply becomes a `FragmentDocument` in the array that gets written.

Replace all of them with three:

```ts
/** Writes the given ranges as this source's complete fragment list. */
const saveRanges = (source: SourceView, ranges: EditableRange[]) => {
  const document = library.documents.find((item) => item.id === source.id);
  if (!document) return;
  const existing = new Map(document.fragments.map((fragment) => [fragment.id, fragment]));
  const fragments: FragmentDocument[] = ranges.map((range, index) => {
    const prior = range.fragmentId ? existing.get(range.fragmentId) : undefined;
    if (prior) {
      return { ...prior, start: range.start, end: range.end, analysisRevision: prior.analysisRevision + 1 };
    }
    return draftFragmentForRange(range, index, source);
  });
  void library.saveFragments(source.id, fragments);
  setDraftRanges([]);
};

const renameFragment = (fragment: FragmentView, name: string) => {
  const document = library.documents.find((item) => item.id === fragment.sourceId);
  if (!document) return;
  void library.saveFragments(
    fragment.sourceId,
    document.fragments.map((item) => (item.id === fragment.id ? { ...item, name } : item)),
  );
};

const deleteFragment = (fragment: FragmentView) => {
  const document = library.documents.find((item) => item.id === fragment.sourceId);
  if (!document) return;
  if (preview.playingId === fragment.id) preview.stop();
  void library.saveFragments(
    fragment.sourceId,
    document.fragments.filter((item) => item.id !== fragment.id),
  );
};
```

Note what this fixes: `deleteFragmentOrRange` (lines 1003-1041) previously added the deleted id to `archived` as a workaround, so a "deleted" fragment lingered in state marked archived. It is now actually removed from the document.

- [ ] **Step 4: Route source removal and analysis saves through the hook**

Replace `saveSourceAnalysis` (lines 608-623) with `library.saveAnalysis`, and the persistence half of `removeSource` (lines 701-742) with `library.archiveSource`. Keep only the selection fix-up that has to happen in the component:

```ts
const removeSource = async (sourceId: string) => {
  const source = library.sourceById(sourceId);
  if (!source) return;
  preview.stop();
  releaseCachedAudio(`source:${sourceId}`);
  await library.archiveSource(sourceId);
  if (selectedSourceId === sourceId) setSelectedSourceId(null);
  notify(`Removed ${source.name} from your library. Import a file with the same name to restore your slices.`);
};
```

`OPENING_SOURCE_ID` (line 71) picked a prototype source and no longer resolves; `selectedSourceId` becomes `string | null` and every consumer handles `null` with an empty state. Same for `selectedId`, whose default was `"f02"` (line 216).

- [ ] **Step 5: Simplify the import handler**

`handleImportSource` (lines 768-857) has two branches — one for a restored source (771-816) and one for a new source (818-856) — that between them rebuild a `SourceFile`, seed ranges, clear archived ids, clear overrides, and reconcile `savedFragmentIds`. The bridge already returns the finalized document, so all of it becomes:

```ts
const handleImportSource = (document: SourceDocumentWithAudio, cacheKey: string) => {
  retainCachedAudio(cacheKey);
  bindSourceAudio(document.id, cacheKey);
  library.adoptDocument(document);
  setSelectedSourceId(document.id);
  navigation.openEditor(document.id, "fragmentation", true);
  navigation.go("sources");
  notify(`Imported ${document.originalName}.`);
};
```

Change `ImportDialog`'s `onImport` prop to hand back the finalized document plus its cache key instead of the bespoke `ImportedSource` shape (`import-dialog.tsx:29-35`); delete that type.

- [ ] **Step 6: Show real load states**

The two surfaces that list library data get honest states driven by `library.status`. Add to `library-card-list.tsx` and `source-table.tsx`, above their existing empty states:

```tsx
if (status === "loading") return <div className="empty-state"><span>◌</span><h2>Reading your library…</h2></div>;
if (status === "error") return (
  <div className="empty-state">
    <span>◌</span><h2>Could not read your library</h2><p>{error}</p>
    <button onClick={onRetry}>Try again</button>
  </div>
);
if (status === "unavailable") return (
  <div className="empty-state">
    <span>◌</span><h2>Open the desktop app to use your library</h2>
    <p>Imports and playback need the Fragments desktop app. This browser preview has no library access.</p>
  </div>
);
```

- [ ] **Step 7: Verify**

Run:

```bash
npm run check
```

Expected: exit 0, 64 unit tests still passing. `app/fragments-app.tsx` should now be roughly 600 lines, down from 1284.

Run `npm run dev:all` and exercise every write path, restarting the app after each to confirm it persisted:
- Import a WAV; confirm it appears with measured BPM and key.
- Slice it into three fragments and save; restart; confirm three fragments with the same bounds.
- Rename a fragment; restart; confirm the name.
- Delete a fragment; restart; confirm it is gone and does not reappear as archived.
- Edit BPM/key in the detail panel; restart; confirm the values.
- Change the sensitivity slider and the source-type chips; restart; confirm both — neither persisted before Task 3.
- Remove a source, then re-import a file with the same name; confirm the saved slices come back.
- Load `localhost:3000` in a plain browser; confirm the "Open the desktop app" state instead of a silently empty library.

- [ ] **Step 8: Review checkpoint**

Confirm the bridge has few callers:

```bash
rg -n "window\.fragments" app lib
```

Expected: matches only in `app/state/use-library.ts`, `app/features/sources/import-dialog.tsx`, and `lib/audio/desktop-drag.ts`. Commit only if the user explicitly requests it.

---

### Task 8: Split the shell into owned slices

This is the task that makes parallel work possible. `app/fragments-app.tsx` is still the file every feature has to edit. After this task, a change to the library list touches `app/features/library/**` and nothing else.

**Files:**
- Create: `app/state/use-navigation.ts`
- Create: `app/features/library/library-route.tsx`
- Create: `app/features/sources/sources-route.tsx`
- Create: `app/features/affinities/affinities-route.tsx`
- Create: `app/features/affinities/matches-panel.tsx`
- Create: `app/features/affinities/use-affinities.ts`
- Move: `app/hero-workflow.tsx` → `app/features/affinities/combine-workspace.tsx` + `app/features/affinities/export-sheet.tsx`
- Move: `app/features/library/connections-table.tsx` → `app/features/affinities/matches-table.tsx`
- Move: `app/features/library/connections-columns.ts` → `app/features/affinities/matches-columns.ts`
- Move: `app/features/library/duplicate-takes-dialog.tsx` → `app/features/affinities/duplicate-takes-dialog.tsx`
- Move: `app/fragmentation-workbench.tsx` → `app/features/sources/fragmentation-workbench.tsx`
- Modify: `app/fragments-app.tsx` (reduce to a shell)
- Modify: `AGENTS.md` (fill in the ownership table)

**Interfaces:**
- Consumes: `Library` (Task 7), `PreviewController` (Task 5), the affinity modules (Task 6).
- Produces:

```ts
export type View = "library" | "sources" | "map";
export type EditorMode = "detail" | "fragmentation";

export type Navigation = {
  view: View;
  selectedFragmentId: string | null;
  selectedSourceId: string | null;
  infoFragmentId: string | null;
  matchesOpen: boolean;
  filterOpen: boolean;
  editor: { open: boolean; modal: boolean; mode: EditorMode };
  go(view: View): void;
  selectFragment(id: string): void;
  selectSource(id: string): void;
  openEditor(sourceId: string, mode: EditorMode, modal: boolean): void;
  closeEditor(): void;
  toggleFilter(): void;
  setMatchesOpen(open: boolean): void;
  /** Remember where we are, then restore it — used by "Edit source" round trips. */
  pushReturn(): void;
  popReturn(): boolean;
};

export function useNavigation(options: { onNavigate?: () => void }): Navigation;
```

- [ ] **Step 1: Extract navigation state**

Create `app/state/use-navigation.ts` holding what is currently 12 scattered `useState` calls plus two refs in `fragments-app.tsx`: `view` (215), `selectedId` (216), `selectedSourceId` (229), `connectionsOpen` (233), `advancedOpen` (234), `filterOpen` (219), `sourceEditorOpen` (239), `sourceEditorModal` (240), `sourcePanelMode` (241), `infoFragmentId` (260), `returnScroll` (261), `returnStack` (262).

The `navigate` function (line 463) is a single 15-statement line that resets nine pieces of state. Inside the hook it becomes readable, and `onNavigate` is where the caller passes `preview.stop`:

```ts
const go = useCallback((next: View) => {
  onNavigateRef.current?.();
  returnStack.current = [];
  setFilterOpen(false);
  setInfoFragmentId(null);
  setMatchesOpen(false);
  setEditor(CLOSED_EDITOR);
  setView(next);
}, []);
```

Delete `advancedOpen` entirely — it is threaded through `LibraryView` and `ReturnSnapshot` but nothing reads it to render anything.

Move the global keyboard handler (lines 470-479) into this hook. It currently carries an `eslint-disable react-hooks/exhaustive-deps` at line 478 to work around capturing `navigate`; with `go` as a stable `useCallback`, the suppression can go.

- [ ] **Step 2: Extract the affinity slice**

Create `app/features/affinities/use-affinities.ts`, wrapping the pure modules from Task 6 with the per-session UI state currently at `fragments-app.tsx:221-226, 249-259` (`context`, `rangeMode`, `weights`, `tolerances`, `archived`, `duplicateExclusions`, `relationshipStatuses`, `manualRelationshipIds`, `combineCandidates`, `mapSelectedId`, `hoveredMapId`):

```ts
export type Affinities = {
  context: SearchContext;
  mode: RangeMode;
  weights: SearchWeights;
  tolerances: MatchTolerances;
  archivedIds: Set<string>;
  statuses: Record<string, AffinityStatus>;
  rankedFor(anchorId: string, limit?: number): ScoredAffinity[];
  summaryFor(anchorId: string): { total: number; manual: number };
  setContext(context: SearchContext): void;
  setMode(mode: RangeMode): void;
  setWeights(weights: SearchWeights): void;
  setTolerances(tolerances: MatchTolerances): void;
  mark(affinityId: string, status: AffinityStatus): void;
  archive(fragmentId: string): void;
  restore(fragmentId: string): void;
};

export function useAffinities(library: Library): Affinities;
```

`rankedFor` is a memoized wrapper over `rankAffinities` using `library.fragmentsById`.

Move `app/hero-workflow.tsx` into this slice, splitting its two exports into `combine-workspace.tsx` and `export-sheet.tsx`. At 696 lines it is the second-largest file in the repo, and the two components share nothing but the slice. While splitting, replace the inline DownloadURL drag fallback in `ExportSheet` (lines 150-154) with the existing `lib/audio/desktop-drag.ts` helper it duplicates.

Move the map view out of the shell (`fragments-app.tsx:1218-1259`) into `affinities-route.tsx`, and the Matches aside (1158-1193) into `matches-panel.tsx` along with the resize handler at lines 483-490 and the `connectionsWidth` / `resizingConnections` state (235-236).

- [ ] **Step 3: Extract the library and sources routes**

Create `app/features/library/library-route.tsx` taking the `LibraryView` invocation from `fragments-app.tsx:1123-1194` plus the library-only callbacks — `highlightLibraryFragment`, `highlightLibrarySource`, `selectLibrarySource`, `openLibraryInfo`, `toggleLibraryFilter`, `closeLibraryFilter` — and the `query` / `sort` / `libraryFilters` state (217-220).

```tsx
export type RouteProps = {
  library: Library;
  preview: PreviewController;
  navigation: Navigation;
  /** Null when the affinity flag is off; slices must render without it. */
  affinities: Affinities | null;
  onNotify(message: string): void;
};
```

Passing four context objects instead of 30 individual props is the point: adding a library feature adds no props to any file outside the slice. `LibraryView` currently takes 30 props (lines 1123-1194) and `LibraryCard` takes 20 — both shrink to the props they actually need plus these objects.

Do the same for `app/features/sources/sources-route.tsx` (from lines 1196-1216 plus `sourceQuery`, `sourceSort`, `importOpen`), and move `app/fragmentation-workbench.tsx` into that slice.

Delete the `archive` view (lines 1261-1264). Its nav button was already commented out at line 1100, and archiving is now a real document operation rather than a session set.

- [ ] **Step 4: Reduce the shell**

`app/fragments-app.tsx` should end up close to this — composition, the toast, and nothing else:

```tsx
"use client";

import { useState } from "react";
import { AFFINITIES_ENABLED } from "@/lib/affinity/flag";
import { usePreview } from "@/lib/audio/preview/use-preview";
import { AffinitiesRoute } from "./features/affinities/affinities-route";
import { useAffinities } from "./features/affinities/use-affinities";
import { LibraryRoute } from "./features/library/library-route";
import { SourcesRoute } from "./features/sources/sources-route";
import { FRAGMENTS_LOGO_SRC } from "./fragments-logo";
import { useLibrary } from "./state/use-library";
import { useNavigation } from "./state/use-navigation";

export default function FragmentsApp() {
  const [toast, setToast] = useState<string | null>(null);
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  };

  const preview = usePreview({ onBlocked: () => notify("Playback needs one more click in this browser.") });
  const library = useLibrary({ onError: notify });
  const affinities = useAffinities(library);
  const navigation = useNavigation({ onNavigate: preview.stop });

  const routeProps = {
    library,
    preview,
    navigation,
    affinities: AFFINITIES_ENABLED ? affinities : null,
    onNotify: notify,
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigation.go("library")} aria-label="Fragments home">
          <img src={FRAGMENTS_LOGO_SRC} alt="Fragments" className="brand-logo" width={113} height={29} />
        </button>
        <nav aria-label="Primary">
          <button className={navigation.view === "library" ? "nav-active" : ""} onClick={() => navigation.go("library")}>Library</button>
          <button className={navigation.view === "sources" ? "nav-active" : ""} onClick={() => navigation.go("sources")}>Sources</button>
          {AFFINITIES_ENABLED && (
            <button className={navigation.view === "map" ? "nav-active" : ""} onClick={() => navigation.go("map")}>Map</button>
          )}
        </nav>
      </header>

      {navigation.view === "library" && <LibraryRoute {...routeProps} />}
      {navigation.view === "sources" && <SourcesRoute {...routeProps} />}
      {navigation.view === "map" && AFFINITIES_ENABLED && <AffinitiesRoute {...routeProps} />}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
```

- [ ] **Step 5: Write the ownership table**

Replace the placeholder comment in `AGENTS.md` with the real map:

```markdown
| Slice | Directory | Owns |
| --- | --- | --- |
| Library | `app/features/library/` | Fragment and source card list, search, sort, filters |
| Sources | `app/features/sources/` | Source table, import dialog, detail panel, fragmentation workbench |
| Affinities | `app/features/affinities/` | Matches panel, Map, Combine, Export, duplicate takes. Gated by `lib/affinity/flag.ts` |

Shared, and therefore worth coordinating before editing:

| File | Why it is shared |
| --- | --- |
| `lib/domain/source-document.ts` | The on-disk contract. A change here touches every slice and the main process |
| `lib/ipc/contract.ts` | The renderer/main boundary. Add a channel here before implementing either side |
| `lib/view/*.ts` | What every component renders |
| `app/state/use-library.ts` | The only writer to disk |
| `app/state/use-navigation.ts` | View and selection state |
| `app/fragments-app.tsx` | Composition only. If you are adding logic here, it belongs in a slice |
| `app/styles/tokens.css` | Design tokens |

Two agents working in different slices should not conflict. If your change needs a
new field on disk, do that as its own step — edit `source-document.ts`,
`contract.ts`, and `use-library.ts` together, verify with `npm run check`, and
then build the slice work on top of it.
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run check
```

Expected: exit 0, 64 unit tests passing.

Check the sizes — no file under `app/` should exceed about 350 lines:

```bash
wc -l app/*.tsx app/state/*.ts app/features/*/*.ts app/features/*/*.tsx | sort -rn | head -20
```

Run `npm run dev:all` and walk every surface: library list, search, sort, filter panel, card rename, card play and scrub, source info panel, sources table, import, fragmentation workbench, drag to Finder, and — with the flag on — Map and Combine.

- [ ] **Step 7: Review checkpoint**

Confirm no slice imports another slice:

```bash
rg -n "features/(library|sources|affinities)" app/features
```

Expected: matches only within each slice's own directory. Cross-slice needs go through `app/state/` or `lib/`. Commit only if the user explicitly requests it.

---

### Task 9: Split the stylesheet and delete dead rules

`app/globals.css` is 1026 lines covering every surface in the app, which makes it the second merge hotspot after `fragments-app.tsx`. It also has two competing `:root` token blocks and roughly 200 lines of rules for markup that no longer exists.

**Files:**
- Create: `app/styles/tokens.css`, `shell.css`, `library.css`, `sources.css`, `workbench.css`, `affinities.css`
- Modify: `app/globals.css` (reduce to imports)

- [ ] **Step 1: Delete the dead rules**

Verify each of these has no consumer before deleting it, then delete it. The command to check a class:

```bash
rg -n "library-list-controls" app lib
```

| Lines | Rules | Superseded by |
| --- | --- | --- |
| 305-311 | `.library-list-controls`, `.library-control-pill` | `library-toolbar.tsx` |
| 388-405 | `.table`, `.table-row`, `.table-header` | `lib/ui/table.tsx` |
| 525-536 | `.source-layout`, `.source-list` | The current two-pane `sources-view.tsx` |
| 663-690 | `.audition-modal`, `.modal-backdrop`, `.compare-toggle`, `.audition-track` | `CombineWorkspace` + shadcn `Dialog` |
| 693-698 | `.duplicate-row` | Tailwind classes on the same elements, which it fights |
| 709-713 | `.fragment-row` | `library-card.tsx` |
| 723-735 | `.import-sheet`, `.pipeline-view`, `.candidate-strip`, `.combine-track` | `ImportDialog` + Tailwind |

Also delete any rule for the surfaces removed in earlier tasks: `.archive-page`, `.archive-list`, `.archive-row`, `.recompute`, `.correction-result`, `.metadata-diff`, `.link-prompt`, and `.wave` / `.wave i` once Task 10 removes the last bar-chart consumer.

- [ ] **Step 2: Merge the two token blocks**

Lines 34-54 declare shadcn's oklch tokens in `:root`, and lines 66-82 declare the app palette (`--violet`, `--lime`, `--waveform-*`) in a second `:root`. Two blocks with the same selector is an invitation to define the same thing twice.

Create `app/styles/tokens.css` containing one `:root`, the `@theme inline` mapping (lines 1-33), the dark-mode block, and the `@layer base` reset (57-59). Then hoist the hardcoded colours that appear repeatedly in component rules into named tokens — at minimum `#2d2a33` (card borders), `#6f6b75` (muted text), `#a99cff55` (violet wash), and `#0c0b0fee` (topbar) — and replace their usages.

Do not attempt to tokenise every hex value in the file. Convert the ones that appear more than twice and leave the rest; a half-finished token system is worse than an explicit colour.

- [ ] **Step 3: Split by slice**

Move each rule into the file matching the slice that owns its markup. The existing comment sections are a good guide — for example line 749 introduces the connections/combine block and line 934 the workbench block.

| File | Owns |
| --- | --- |
| `app/styles/shell.css` | `.app-shell`, `.topbar`, `.brand`, `nav`, `.toast`, `.empty-state`, `.panel-titlebar`, `.page-view`, `.sr-only` |
| `app/styles/library.css` | `.library-*`, `.selected-caption` |
| `app/styles/sources.css` | `.source-*`, `.import-*` |
| `app/styles/workbench.css` | `.workbench-*`, `.fragment-lane`, `.magnifier`, timeline and playhead rules |
| `app/styles/affinities.css` | `.connections*`, `.graph-*`, `.map-*`, `.combine-*`, `.relationship-badge`, `.duplicate-*` |

Then reduce `app/globals.css` to the entry point. Tailwind v4 resolves `@import` itself, so `@theme` inside `tokens.css` still works — but the Tailwind import must come first:

```css
@import "tailwindcss";
@import "tw-animate-css";

@import "./styles/tokens.css";
@import "./styles/shell.css";
@import "./styles/library.css";
@import "./styles/sources.css";
@import "./styles/workbench.css";
@import "./styles/affinities.css";
```

- [ ] **Step 4: Verify**

Run:

```bash
npm run check && npm run build:renderer
```

Expected: exit 0, and the built CSS bundle is smaller than before.

Run `npm run dev:all` and compare every surface against a screenshot taken before this task. Styling regressions here are silent — typecheck and lint cannot catch a dropped rule, so look at each view: library cards, filter panel, source table, detail panel, import dialog, workbench timeline and magnifier, and (flag on) Map and Combine.

- [ ] **Step 5: Review checkpoint**

Confirm no stylesheet exceeds ~300 lines and that `globals.css` is imports only. Commit only if the user explicitly requests it.

---

### Task 10: Consolidate the waveform components and update the docs

Six modules render waveforms, in two unrelated styles. `waveform.tsx` draws a `<div>`-per-peak bar chart; the other five build on an SVG path. Two of them — `signal-cell.tsx` (lines 54-88) and the wave row inside `library-card.tsx` (375-403 and 506-534) — independently implement the same "play button + waveform + drag out + cache lookup + slice" combination, about 70% duplicated.

**Files:**
- Create: `lib/audio/waveform/audio-wave-row.tsx`
- Move: `lib/audio/{waveform-path.ts,waveform-svg.tsx,continuous-waveform.tsx,scrubbable-waveform.tsx}` → `lib/audio/waveform/`
- Delete: `lib/audio/waveform.tsx`, `lib/audio/signal-cell.tsx`
- Modify: `app/features/library/library-card.tsx`, `app/features/sources/source-table.tsx`, `app/features/affinities/matches-table.tsx`, `app/features/affinities/duplicate-takes-dialog.tsx`
- Modify: `README.md`, `AGENTS.md`

**Interfaces:**
- Produces:

```tsx
export type AudioWaveRowProps = {
  /** Peaks to draw. Already sliced to the fragment if this is a fragment row. */
  peaks: number[];
  scope: PreviewScope | null;
  preview: PreviewController;
  /** Show the leading play/pause button. Dense table rows use `false`. */
  showPlayButton?: boolean;
  /** Allow pointer scrubbing and render a playhead. */
  scrubbable?: boolean;
  /** When set, the row is draggable out to Finder or a DAW. */
  dragSourceId?: string;
  label: string;
  className?: string;
};

export function AudioWaveRow(props: AudioWaveRowProps): JSX.Element;
```

- [ ] **Step 1: Retire the bar-chart renderer**

After Task 8, `Waveform` has one remaining consumer: `duplicate-takes-dialog.tsx:68`. Replace it there with `ContinuousWaveform`, then:

```bash
git rm lib/audio/waveform.tsx
```

Delete the `.wave` and `.wave i` rules from `app/styles/library.css` (they were at `globals.css:407-415`).

- [ ] **Step 2: Group the SVG stack**

```bash
mkdir -p lib/audio/waveform
git mv lib/audio/waveform-path.ts lib/audio/waveform/waveform-path.ts
git mv lib/audio/waveform-svg.tsx lib/audio/waveform/waveform-svg.tsx
git mv lib/audio/continuous-waveform.tsx lib/audio/waveform/continuous-waveform.tsx
git mv lib/audio/scrubbable-waveform.tsx lib/audio/waveform/scrubbable-waveform.tsx
```

The layering is already correct — `waveform-path` builds the `d` attribute, `waveform-svg` holds the gradient and glow defs, `continuous-waveform` composes them, and `scrubbable-waveform` adds the playhead and pointer handling. Only the file locations change.

While moving `scrubbable-waveform.tsx`, replace its inline playhead styling at lines 88-91 — which hardcodes `#c8fa78` in a box-shadow next to a `bg-[var(--lime)]` class for the same colour — with the `library-wave-playhead` class that `fragmentation-workbench.tsx:511` already uses, so there is one playhead style.

- [ ] **Step 3: Write the shared row**

Create `lib/audio/waveform/audio-wave-row.tsx` from the union of `signal-cell.tsx` and the `library-card.tsx` wave rows. It takes a `PreviewScope` and the `PreviewController` from Task 5 rather than resolving audio itself, which is what let the two originals drift:

```tsx
"use client";

import { ContinuousWaveform } from "./continuous-waveform";
import { ScrubbableWaveform } from "./scrubbable-waveform";
import { startDesktopDrag } from "../desktop-drag";
import type { PreviewController } from "../preview/use-preview";
import type { PreviewScope } from "../preview/preview-scope";

export function AudioWaveRow({
  peaks,
  scope,
  preview,
  showPlayButton = true,
  scrubbable = false,
  dragSourceId,
  label,
  className,
}: AudioWaveRowProps) {
  const isPlaying = scope !== null && preview.playingId === scope.id;
  const progress = isPlaying ? preview.progress : null;

  return (
    <div
      className={className}
      draggable={Boolean(dragSourceId)}
      onDragStart={dragSourceId ? (event) => startDesktopDrag(event, dragSourceId, label) : undefined}
    >
      {showPlayButton && (
        <button
          type="button"
          disabled={!scope}
          aria-label={isPlaying ? `Pause ${label}` : `Play ${label}`}
          onClick={() => scope && preview.toggle(scope)}
        >
          {isPlaying ? "❙❙" : "▶"}
        </button>
      )}
      {scrubbable ? (
        <ScrubbableWaveform
          values={peaks}
          progress={progress}
          label={label}
          onSeek={(ratio) => scope && preview.seek(scope, ratio)}
        />
      ) : (
        <ContinuousWaveform values={peaks} progress={progress} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Adopt it and delete `SignalCell`**

Replace the wave rows in `library-card.tsx` (both the fragment variant at lines 375-403 and the source variant at 506-534) with `<AudioWaveRow scrubbable />`, and the `SignalCell` usages in `source-table.tsx:75` and `matches-table.tsx` with `<AudioWaveRow showPlayButton={false} />`. Then:

```bash
git rm lib/audio/signal-cell.tsx
```

`library-card.tsx` should drop from 538 lines to roughly 350.

- [ ] **Step 5: Update the README**

`README.md:40-56` describes a layout that no longer exists. Replace the repository-layout block with:

```
fragments-musical-memory/
├── app/
│   ├── fragments-app.tsx   # Routing shell; composition only
│   ├── state/              # use-library (disk I/O) and use-navigation (view state)
│   ├── features/           # One directory per slice: library, sources, affinities
│   └── styles/             # Per-slice stylesheets, imported by globals.css
├── electron/               # Main process, preload, persistence IPC, custom protocols
├── lib/
│   ├── domain/             # SourceDocument types + validators, flat-file library service
│   ├── ipc/                # Channel names and the typed window.fragments contract
│   ├── view/               # SourceDocument -> SourceView / FragmentView
│   ├── affinity/           # Affinity types, scoring, ranking, map layout (flag-gated)
│   ├── audio/              # Decode, cache, Essentia, preview engine, waveforms
│   └── ui/                 # shadcn primitives
├── scripts/                # seed-library.mjs and maintenance scripts
├── public/audio/           # f01-f28.wav, seeded into a real library
├── tests/unit/             # Fast, pure-module tests
├── tests/smoke/            # Packaged-HTML check
└── AGENTS.md               # Conventions, verification loop, slice ownership
```

Also update the scripts block (lines 18-25) to show `npm run check`, `npm run seed-library`, `npm test`, and add a line to the "Local library" section (line 29) noting that a fresh install has an empty library and `npm run seed-library` imports the 28 bundled recordings.

Two statements in the README are now wrong and should be corrected: it claims the UI "also runs as a plain web page in a browser" (line 3) — after Task 7 the browser shows an explicit "open the desktop app" state — and it mentions `prototype-data.ts` (line 44), which is gone.

- [ ] **Step 6: Add the "adding a feature" section to AGENTS.md**

Close the loop on what this refactor was for. Append to `AGENTS.md`:

```markdown
## Adding a feature

1. Decide which slice owns it. If none does, that is worth raising before coding.
2. If it needs a new persisted field: add it to `lib/domain/source-document.ts`,
   give `normalizeSourceDocument` a default for documents written before it
   existed, expose it through `lib/ipc/contract.ts` and `app/state/use-library.ts`,
   and surface it in `lib/view/`. Verify with `npm run check` before touching UI.
3. Build the UI inside the slice directory. Add styles to that slice's stylesheet.
4. Unit-test anything pure you wrote. Do not test the components.
5. Run `npm run check`, then exercise the feature in `npm run dev:all`.

## Things that are deliberately absent

Do not add these back without a reason:

- Demo or placeholder data. The library is the only source of truth.
- Invented analysis values. `null` renders as `—`.
- A schema/validation library. Validators are hand-rolled in `lib/domain/`.
- Component, hook, or end-to-end test frameworks.
- Tests that assert on the text of source files.
- A second waveform renderer, a second playback engine, or a second stylesheet
  for a slice that already has one.
```

- [ ] **Step 7: Final verification**

Run the full gate:

```bash
npm run check
npm test
npm run pack
```

Expected: all three succeed, and `release/` contains an unpacked application.

Then run the desktop acceptance pass on the packaged app:

1. Launch it against an empty `FRAGMENTS_LIBRARY_ROOT` and confirm a real empty state, not a crash.
2. Import three audio files of different formats; confirm measured BPM and key appear where Essentia succeeds and `—` where it does not.
3. Slice one source into four fragments; rename two; delete one.
4. Quit and relaunch; confirm every edit survived.
5. Drag a fragment into Finder and into a DAW; confirm real audio bytes arrive.
6. Remove a source, then re-import a file with the same name; confirm the slices return.
7. Corrupt one `source.json` by hand; confirm the rest of the library still loads.
8. Set `AFFINITIES_ENABLED = true`, rebuild, and confirm Map and Combine render with empty affinity data.

- [ ] **Step 8: Final review checkpoint**

Report the before/after numbers, the test count, and anything deferred. Commit only if the user explicitly requests it.

---

## Definition of done

| Measure | Before | After |
| --- | --- | --- |
| `app/fragments-app.tsx` | 1284 lines | ~120 lines |
| Largest file under `app/` | 1284 lines | ~350 lines |
| `app/globals.css` | 1026 lines | 7 import lines + six stylesheets under ~300 each |
| Parallel domain models | 2 (`source.json` + `prototype-data.ts`) | 1 (`lib/domain/source-document.ts`) |
| `HTMLAudioElement` construction sites | 3 | 1 |
| Waveform renderers | 2 styles across 6 modules | 1 style across 4 modules |
| `typecheck` result | 4 errors, no script | clean, `npm run typecheck` |
| `lint` result | 78 errors, unenforced | clean |
| Unit tests | 29, behind a full renderer build | 64, behind a ~1s build |
| Fabricated values rendered or persisted | BPM, key, bars, beats, confidence, brightness, progress | none |
| Fields collected but silently dropped | `sourceTypes`, `sensitivity` | both persisted |

Non-goals, deliberately excluded: computing a real affinity graph, CI enforcement of the verification gates, component or end-to-end test frameworks, and any visual redesign.

## Verification per task

Every task ends with `npm run check` passing. Cumulative unit-test counts:

| After task | Unit tests | Smoke tests |
| --- | --- | --- |
| 1 | 29 | 2 |
| 2 | 29 | 2 |
| 3 | 34 | 2 |
| 4 | 41 | 2 |
| 5 | 48 | 2 |
| 6 | 64 | 1 |
| 7-10 | 64 | 1 |

The baseline is verified: `tests/library-service.test.mjs` has 21 tests, `tests/app-protocol.test.mjs` has 8, and the two together run in about 230ms.

Tasks 7 through 10 are restructuring: they must not change behaviour, so they add no tests. If a task in that range makes you want to add a unit test, that is a signal you extracted something pure and worth testing — add it.
