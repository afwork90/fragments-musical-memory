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

## Slice ownership

Feature work should touch one slice. If your change needs to edit a shared
file, that is a signal to check whether the abstraction is wrong — or to
coordinate, because someone else is probably in there.

<!-- Task 8 fills in the ownership table here. -->
