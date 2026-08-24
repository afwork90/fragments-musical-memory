# Operation plan: executing the modular refactor

**Date:** 2026-08-24
**Branch:** `chrisv/refactoring-post-hackathon`
**Governs:** execution of [`docs/superpowers/plans/2026-08-24-modular-refactor-and-agent-readiness.md`](./superpowers/plans/2026-08-24-modular-refactor-and-agent-readiness.md) (10 tasks, ~3700 lines)

This document does not restate the refactor plan. It records the **verified baseline**, the state of
the **library on disk**, the **corrections** the plan needs, the **decisions taken**, and the **order**
the work runs in.

---

## 1. Verified baseline

Measured on this branch after a clean `npm install`, not taken from the plan. `node_modules` was
absent on checkout; that is the first thing a new agent trips on.

| Signal | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | **4 errors** — 3× `TS7016` (`lib/audio/essentia-loader.ts:1,15,16`), 1× `TS2345` (`lib/audio/use-audio-cache.ts:10`) |
| Lint (no build output) | `npx eslint .` | **63 errors, 5 warnings** |
| Lint (with `electron-dist/`) | same, after `build:electron` | **83 problems** — plan says 78; the extra 15 are in compiled JS |
| Unit tests | `node --test tests/library-service.test.mjs` | 21 pass, ~250 ms |
| Protocol tests | `node --test tests/app-protocol.test.mjs` | 8 pass — **only after `npm run build:electron`**; it imports from `electron-dist/` |
| Renderer build | `npm run build:renderer` | exit 0, ~5 s |
| Electron build | `npm run build:electron` | exit 0, ~1 s |
| No `typecheck` script | `package.json` | confirmed absent |

Lint by rule, with `electron-dist/` present: 22 `no-explicit-any`, 17 `no-unused-vars`, 4
`no-require-imports`, 4 `react-hooks/exhaustive-deps`, 4 `react-hooks/set-state-in-effect`, 4
`react-hooks/purity`, 9 `jsx-a11y/*`, 3 assorted `react-hooks`/`ban-ts-comment`, 1
`no-img-element`.

Hotspot sizes, confirmed:

| File | Measured | Plan claimed |
| --- | --- | --- |
| `app/fragments-app.tsx` | 1284 lines, **47** `useState`, 7 `useEffect` | 1284, "~40 `useState`" |
| `app/globals.css` | 1025 | 1026 |
| `lib/domain/library-service.mjs` | 403 | 404 |
| `app/prototype-data.ts` | 267, imported by **22** files | 268, "20+ files" |
| `new Audio(` sites | 3 | 3 |

**The plan is accurate.** Its diagnosis, line references, and file-level claims held on every spot
check. Execute it, with the corrections in section 3.

---

## 2. What is actually on disk

Inspected `~/Documents/Fragments Library/sources/` — 33 source folders. This changes three
assumptions in the refactor plan.

### 2.1 Analysis is present everywhere (good)

**All 33 sources have a non-null `bpm` and `key`.** No seeding or batch pre-pass is needed to make the
library look real. Task 4's worry about `—` everywhere does not apply to this library.

### 2.2 `analysis.sonogram` exists on disk and the plan's type omits it

Five of 33 sources carry a fifth analysis field:

```json
"sonogram": { "bands": 0, "frames": [] }
```

It is empty in every case — another placeholder. The plan's `MeasuredAnalysis` is exactly
`{ bpm, key, scale, keyStrength }`, so `sonogram` is invisible to the type system and would survive
only by accident of object identity. Combined with the decision to extract more Essentia features and
batch-process, this makes the analysis type the **one place in Task 3 worth designing rather than
transcribing**. See 4.2.

### 2.3 The 791 relationships are the auto-flood, and they encode fabricated metrics

There are **791 relationships** across the library — 46 on `f01.wav`, 43 on `f04.wav`, 42 on
`f05.wav`. The handoff document describes exactly this as a defect: *"a heuristic that paired every
imported fragment with every other fragment was briefly enabled and immediately filled the library
(hundreds of links; source cards showed affinities in the hundreds). That auto-generation was turned
off."* The generation was turned off; **the data it wrote is still there.**

Every one is tagged, which is the good news:

```json
{
  "id": "auto-07bfe9c4-…-whole-da9ad243-…-whole",
  "origin": "algorithmic",
  "base": 0.7046153846153846,
  "metrics": { "rhythm": 0.807, "harmony": 0.55, "melody": 0.678,
               "timbre": 0.7, "pitch": 0.55, "brightness": 0.7 },
  "reason": "Tempos are close (84 vs 104 BPM)."
}
```

Two problems with the contents. The `metrics` block includes `timbre`, `pitch`, and `brightness`
derived from the fabricated `brightness` field that Task 4 deletes — so these scores are built on
invented data. And the `reason` strings do not survive reading: 84 versus 104 BPM is a 24% difference
described as "close".

**There are no curated relationships left.** All 791 carry `origin: "algorithmic"`; the count of
anything else is zero. That includes `09_30_2025_gtrjam.wav`
(`e0b6cfcc-5b2a-44d1-bfb1-a3cd89f946de`), which the handoff names as the file where demo affinities
were hand-written. Its 6 links still point at the two targets the handoff describes —
`fe54edcf-…-whole` (`synth-rec_OBX.wav`) and `38cb7d0e-…-11` (Cloud Collapse fragment 11) — so the
*intent* survived, but they were regenerated as algorithmic. **The auto-generator overwrote the
curated edges. The failure mode the handoff warns about has already happened.**

Consequences:

- "Keep the generated affinities" (4.1) is the only option available, because generated is all there
  is. Nothing is being preserved that could instead have been curated.
- Modelling `origin` (4.1) remains the right seam — it is how curation gets protected *next* time and
  how you retire algorithmic links piece by piece — but there is nothing to protect today. The
  backup and `docs/library-baseline.json` are the safety net.
- Keeping them means source cards show affinity counts in the dozens, which is the behaviour the
  handoff records as the reason the generator was switched off.

No duplicate `source|target` pairs exist within any document (checked), so no dedup work is needed.

### 2.4 The duplicate `song1.wav` is not a bug

Two live, non-deleted sources share `originalName: "song1.wav"`
(`4731d7d4-2053-4735-9098-0899bda9062b`, `a5c6a389-6202-40ef-ae0c-2a36144236b4`), which appears to
contradict the handoff's *"duplicate live (non-deleted) filename is rejected."*

Resolved: those folders were **placed by hand as manual-testing assets** and never went through
`beginImport`, so the rejection rule was never invoked. No defect, and no regression test needed on
this evidence. Worth remembering that the library can contain hand-placed folders — the loader must
tolerate them, which is also the argument for `normalizeSourceDocument` being forgiving on read.

---

## 3. Corrections to the refactor plan

Nine deltas. None invalidate the plan; each wastes time or fails a step if not caught.

### 3.1 Task 2 Step 2 — the empty directories do not exist

`rmdir app/lib app/components/audio app/components/ui` targets nothing; `find app lib -type d -empty`
returns nothing. **Skip the `rmdir` commands.** The dead exports in the same step
(`filterLibraryFragments`, `sortLibraryFragments`, `visibleLibraryFragments` at
`app/features/library/library-list.ts:64-96`) are real and unreferenced — delete those as written.

### 3.2 Task 2 Step 5 — already done, and the plan is wrong about what to keep

All three 2026-08-22 docs were deleted in `d751756` as stale and potentially misleading — including
`…-electron-flat-file-audio-library-design.md`, which this plan says to **keep**. That instruction is
superseded: **none of them come back.** Git history is the archive.

The real work was the fallout: `docs/handoff-context.md` linked to all three. Fixed by dropping the
links, and — more importantly — by marking that file as **not a source of truth**. It is institutional
memory whose claims have already decayed (see 2.3 on "curated" affinities and 2.4 on duplicate
filenames), so it now opens with that warning, lists its own known-stale claims, and appears **last**
in its own suggested reading order. Code and `source.json` are authoritative.

### 3.3 Task 1 Step 2 — the fix does not clear the lint error on the same line

The replacement for `lib/audio/use-audio-cache.ts` fixes `TS2345` by wrapping the unsubscribe in a
`void` closure, but keeps `setAudio(getCachedAudio(cacheKey))` as the effect's first statement — which
is what `react-hooks/set-state-in-effect` flags at line 11. Typecheck goes clean; that lint error
stays. Handle it in the deferred pass (3.4), not by re-litigating Step 2.

### 3.4 Task 1 Step 8 is a blank cheque over code that later tasks delete

"Run `npm run lint` and fix what is left" covers 15 `react-hooks`/`ban-ts-comment` errors. Nearly all
sit in code a later task removes or rewrites:

| Error | Later task that removes or rewrites it |
| --- | --- |
| `fragments-app.tsx:539,547` (`purity`) | Task 6 deletes `addCombineFragment` / `updateCombineSensitivity` |
| `fragments-app.tsx:769` (`purity`) | Task 7 Step 5 rewrites `handleImportSource` |
| `fragments-app.tsx:481` (`exhaustive-deps`) | Task 5 replaces the preview engine |
| `electron/persistence.ts:1` (`ban-ts-comment`) | Task 3 Step 10 removes the `@ts-nocheck` |
| `library-card.tsx:145,459,470` | Task 10 Step 4 rewrites the wave rows |
| `import-dialog.tsx:147,148`, `source-detail-panel.tsx:80,86` | Tasks 4.11 / 4.12 touch both |
| `use-audio-cache.ts:11` | Task 5 Step 6 reworks the cache |

Fixing `purity` in a function Task 6 deletes is waste; hand-tuning `exhaustive-deps` on the preview
engine Task 5 replaces is worse, because it manufactures conflict surface.

**Change: split the lint gate.** Task 1 lands the config fixes (ignore `electron-dist/`, allow
`require` in `.cjs`) and makes `npm run check` enforce typecheck + unit tests + lint with the
`react-hooks` rules at `warn`. A new **Task 6.5** restores them to `error` and fixes the survivors,
by which point the population has shrunk to code we chose to keep. Record the downgrade in
`eslint.config.mjs` with a comment naming Task 6.5 so it cannot quietly become permanent.

### 3.5 Tasks 5, 6, 9, 10 assume `app/features/affinities/` exists

It does not. `app/features/library/` and `app/features/sources/` already exist (sliced during the
hackathon), but affinity surfaces are still inline in `fragments-app.tsx` and `hero-workflow.tsx`,
with `connections-table.tsx` and `duplicate-takes-dialog.tsx` under `features/library/`. Task 8 Step 2
creates the directory. Any earlier task writing a path under `app/features/affinities/` must create it
or target current locations. **Resolve paths per task at execution time; do not trust the plan's file
lists here.**

### 3.6 Task 8 is smaller than the plan implies, Task 6 is larger

The plan reads as though the three slices are greenfield; two exist. Conversely Task 6 carries the
affinity extraction, the surface rework, and the deletion of the correction workflow — the largest
behavioural change in the plan. Task 8 is mostly moves; Task 6 is where things break.

### 3.7 The smoke test's audio-file assertion breaks with Task 4

`tests/rendered-html.test.mjs:108` asserts `>= 40` `.wav` files in `public/audio/`. There are exactly
42 (28 recordings + 13 stems + `instrumental.vtt`). Task 4 Step 14 deletes the 13 stems, leaving 28 —
the assertion fails. It sits inside the block Task 1 Step 5 deletes, so ordering saves us. **Hard
ordering constraint: Task 1 Step 5 before Task 4 Step 14.**

### 3.8 `test:unit` must build Electron first

`tests/unit/app-protocol.test.mjs` and the new `source-document.test.mjs` import from
`electron-dist/`. The plan's `"test:unit": "npm run build:electron && node --test tests/unit/"` is
correct. Do not optimise the build out; without it 8 tests fail with `ERR_MODULE_NOT_FOUND` (verified).

### 3.9 The plan's "no commits" constraint is overridden

See 4.3.

---

## 4. Decisions taken

### 4.1 No affinities flag; the Map stays as an explicit placeholder

`AFFINITIES_ENABLED` is **dropped**. Task 6 Step 8 is struck from the plan. Instead:

- Affinity surfaces stay reachable. They render from `source.json` `relationships`, which is the only
  affinity source once the demo fixtures die in Task 4.
- The **Map stays** for this phase even though its positioning is placeholder.
- Audio not backed by a folder under `sources/` is removed from Library and Sources — the prototype
  demo catalog stops seeding those views. This is Task 4's real user-visible effect.
- Fake parts get replaced piece by piece rather than gated off wholesale.

Two consequences to handle in execution:

**`origin` becomes a first-class domain field.** `lib/domain/source-document.ts` types
`relationships[]` as `unknown[]` in the plan. Since we are keeping 791 algorithmic links alongside
curated ones, the distinction has to be modelled — `origin: "algorithmic" | "curated" | "manual"` —
so the UI can label generated links and you can retire them incrementally. This is the handle for
"replace the fake parts piece by piece."

**The Map needs an axis that survives Task 4.** `musicalMapPoint` currently positions by
`fragment.brightness`, which Task 4 deletes as fabricated. To keep the Map alive, Task 4 replaces
that input with a deterministic placeholder derived from the fragment id, named so it cannot be
mistaken for measurement (`placeholderMapPosition`, not `brightness`). A map coordinate is not a
musical claim, so this does not violate the no-invented-data rule — but the naming has to make the
placeholder obvious. Task 6 Step 7's "honest axes" work then replaces it with measured role/tempo.

### 4.2 Seeding is a non-issue; batch analysis becomes a design requirement

All 33 sources already carry BPM and key (2.1), so nothing needs seeding now. The forward requirement
is the important part: **more Essentia features are coming, and they will be extracted in batch.**
That lands on Task 3, and changes it from transcription to design:

- `MeasuredAnalysis` must be **additively extensible**. New optional fields must not require touching
  every read site, and `normalizeSourceDocument` is the seam that defaults them for documents written
  earlier. Model the already-present `sonogram` (2.2) rather than dropping it.
- Analysis needs **provenance and versioning** — which extractor version produced a value, so a batch
  re-run can tell "not measured" from "measured by an older extractor" and refresh selectively without
  clobbering hand-corrected values. The handoff is emphatic that persisted analysis beats preview
  analysis; batch processing makes that rule load-bearing rather than advisory.
- The library service needs a **batch-capable update path**: update analysis for many sources without
  a renderer round-trip per source, and without the read-modify-write races that already cost you
  curated relationships once.

I am **not** building the batch pipeline during the refactor. Task 3 leaves the seam and the types so
it is additive later. Flagging that this is a genuine expansion of Task 3's scope beyond what the
refactor plan describes.

### 4.3 One commit per task, after you test

Per task, not per wave. Each commit must be in a working state, so the sequence is: finish task → run
`npm run check` → report the real output → **you exercise the app and iterate** → I commit on your go.
This overrides the refactor plan's "do not commit during execution" constraint.

---

## 5. Execution strategy

### 5.1 The parallelism claim needs qualifying

The plan's goal is a codebase where parallel agents do not collide. That is the *destination*.
**During** the refactor, tasks 3 through 8 all funnel through `app/fragments-app.tsx`, so running them
concurrently would generate conflicts in the exact file we are dismantling. Parallel agents are the
payoff of this work, not a way to do it faster.

One genuinely independent track is worth splitting off — **Track B:** Task 2 (minus 3.1), the
handoff-doc link repair (3.2), and Task 9 Step 1 (delete provably dead CSS, verifiable against the
current tree with `rg`). Touches nothing Track A touches. Everything else is serial.

### 5.2 Waves

| Wave | Content | Why here |
| --- | --- | --- |
| **0** | Task 1, amended per 3.3 / 3.4 | Makes `npm run check` a real gate. Nothing else is safe first |
| **1** | Task 2 (amended) + Track B | Pure deletion, no behaviour change; every later task reads less code |
| **2** | Task 3 — typed domain, typed IPC, `library-service.mjs` → TS, plus 4.2's extensibility and 2.4's duplicate-import test | The keystone. Where robustness actually arrives |
| **3** | Task 4 — delete `prototype-data.ts`, invented analysis, and non-library audio from Library/Sources; keep the Map on a named placeholder axis (4.1) | The wave where the product visibly changes |
| **4** | Task 5 (one playback engine) → Task 6 (affinity extraction, `origin` modelling, no flag) → Task 6.5 (`react-hooks` back to `error`) | Serial: 5 and 6 both rewrite large regions of `fragments-app.tsx` |
| **5** | Task 7 (one owner of library data), Task 8 (slice the shell) | Behaviour-preserving by contract — any behaviour change here is a bug |
| **6** | Task 9 Steps 2-4 (stylesheet split), Task 10 (waveforms, README, `AGENTS.md`) | Manual visual verification; do it against before-screenshots |

Wave 0 exit criteria: `npm run check` exits 0 in under ~15 s, `npm run typecheck` clean, 29 unit tests
pass, `AGENTS.md` exists.

### 5.3 Checkpoint discipline

Per task: run `npm run check` and paste the real output (never assert from memory) → exercise the
touched surfaces in `npm run dev:all` → tick the task's checkboxes in the refactor plan → hand to you
for testing → commit on your go.

The desktop acceptance pass in Task 10 Step 7 (import, slice, rename, quit/relaunch, drag to Finder,
re-import by filename, corrupt a `source.json`) is the only thing proving the persistence layer still
works. Run it **twice**: once after Wave 2, once at the end. Discovering at the end that Task 3 broke
re-import would be expensive.

### 5.4 Risk register

| Risk | Where | Mitigation |
| --- | --- | --- |
| Dual-compile import mistakes (`@/` alias or `.js` extension under `lib/`) produce runtime-only `Cannot find module` that typecheck and lint both miss | Tasks 3-6 | Re-read the plan's "Import conventions" before each. Keep a unit test that imports the domain from `electron-dist/` — that is what actually catches it |
| **Curated affinities destroyed** | Tasks 3, 6 | Handoff: writing `updateRelationships` with an empty list wipes curated edges. It has happened. **Back up `~/Documents/Fragments Library` before Wave 2** and diff relationship counts after |
| Persisted analysis regressing to preview analysis | Tasks 3, 4 | Verify against a source whose disk key disagrees with quick analysis; the handoff cites disk `C minor` vs cache `F minor` |
| Playback races reappear | Task 5 | The four existing mitigations (session IDs, pending seek, rAF progress, clip seek without full duration) must all survive into the shared hook |
| Silent CSS regressions | Task 9 | Screenshots before, per-surface comparison after. Neither typecheck nor lint sees a dropped rule |
| Scope creep in "fix what is left" steps | Tasks 1, 9 | 3.4's deferral; time-box Task 9's tokenisation to colours appearing 3+ times, as the plan says |
| Analysis type churn once batch extraction starts | Task 3 | 4.2 — additive optional fields plus provenance, decided now rather than after the first batch run |

---

## 6. Starting now

Waves 0 and 1 need no further input:

1. **Task 1**, amended with the two-stage lint gate — green `npm run check`, `AGENTS.md`, split test
   tree, script surface.
2. **Task 2**, amended per 3.1 and 3.2, plus repairing the handoff document's three broken links.
3. Report real `npm run check` output and stop for your review before **Task 3**.

Recording these corrections as amendments in the refactor plan itself is part of step 1, so plan and
reality do not drift again.

---

## 7. Task 3 outcome: three real bugs the types found

Delivered as planned — `lib/domain/{source-document,paths,atomic-write,library-service}.ts`,
`lib/ipc/contract.ts`, `types/fragments-bridge.d.ts` — plus: `@ts-nocheck` gone from
`electron/persistence.ts`, the `new Function("...import...")` loader hack gone (a static import
replaces it, so the packaged app no longer needs `library-service.mjs` in `extraResources`), and
**zero `any` and zero `@ts-nocheck` left in `app/`, `lib/`, `electron/`, `types/`**. The 21 original
service tests pass unchanged against the TypeScript port, which is the evidence the port preserves
behaviour.

Typing the boundary was not cosmetic. It surfaced three defects that had been invisible:

**7.1 Every persisted fragment carried a role the UI cannot represent.** The domain has
`primaryRole: "Unclassified"` and `finalizeImport` writes it; the UI's `MusicalRole` has six values
and no `"Unclassified"`. All 54 fragments on disk carry it. The old code read
`(fragmentDoc.primaryRole as MusicalRole) ?? "Texture"` — the cast erased the mismatch and the `??`
never fired, because `"Unclassified"` is truthy. So an out-of-domain role reached every component
that switches on the six real roles. Now translated explicitly in `displayRole`.

**7.2 `updateFragments` was not idempotent, defeating its own guard.** It preserved `createdAt` via
`existing?.createdAt ?? fragment.createdAt ?? new Date()`. But 48 of 54 fragments on disk have **no**
`createdAt` (the renderer's `fragmentToDocument` never sent one), so both operands were `undefined`
and every save re-stamped them to now — the exact "renaming or re-slicing bumps a fragment to the top
of a latest-uploaded sort" failure the comment claims to prevent. Now falls back to the source's
`importedAt`, which is stable and honest. Pinned by a regression test that fails on the old code.

**7.3 `SourceFile` cannot represent a pending import.** `duration`/`format` are `null` until
`finalizeImport` runs, but the prototype type declares them non-null; an `as SourceFile[]` cast was
hiding it. `sourceFileFromDocument` now throws rather than substituting a zero duration that would
render as a real but empty recording. Deduplicating the inline copy of that mapper in the load
effect removed the cast and ~25 lines.

Two design decisions worth keeping:

- **`MeasuredAnalysis` has no index signature.** Unmodeled extractor output survives a read/write
  cycle (`normalizeSourceDocument` spreads rather than rebuilds), but *reading* a feature requires
  declaring it first. An index signature would have made `analysis.bmp` type-check everywhere.
  Adding a batch-extracted feature is one optional line plus provenance.
- **`RelationshipDocument` is fully required, including all seven metric axes.** Checked against
  disk rather than guessed: all 791 relationships have every field and every axis. Typing them
  optional would have pushed defaulting onto every consumer.

Verified: `npm run check` exit 0 (42 unit tests); `npm test` exit 0 (42 unit + 2 smoke); clean
`electron-dist/` rebuild works; against a **copy** of the real library, `listSources` returns
33/54/791 matching §1's baseline, a relationship round-trip is byte-identical to
`normalize(before)`, `createdAt` is stable across repeated writes, and all four write paths land.
The real library was not modified.

---

## 8. Task 4 is split, and the plan understates it

The plan treats Task 4 as one step that deletes `app/prototype-data.ts`. An audit says otherwise, so
it runs as **4a (behaviour)** then **4b (mechanical)** — two commits, each independently testable.

Why: that file is *both* the fake dataset and the app's type module. Eighteen files import only its
**types**; the fake **data** is consumed almost entirely by `fragments-app.tsx`. And the data is
load-bearing for the opening state — `OPENING_SOURCE_ID` (`SOURCE_FILES.find(...)!`),
`fragmentById` (`FRAGMENTS.find(...)!`), and the initial `sources` array all assume it exists, so
several non-null assertions become crashes on an empty library. "Delete the dataset" therefore
includes "build a real empty state", which the plan does not mention.

**Decision (yours):** the staged "balcony" source and the fake opening state **stay for now** as an
explicit placeholder, like the Map. So 4a removes fabrication only, and leaves the placeholder
standing with a header in `prototype-data.ts` stating the two rules that keep it harmless: never
write it to `source.json`, never use it as a fallback for a real source's missing analysis.

### 8.1 Task 4a: nothing reaches the UI or the disk unmeasured

- **Deleted the fabricator.** `inventAnalysis` derived a BPM, key, scale, and key strength from a
  hash of the source id. `analysisNeedsInvention` decided when to apply it. Both gone.
- **Deleted a write path that persisted invented values.** The library-load effect collected sources
  whose analysis looked empty, invented values, and called `updateSourceAnalysis` — writing fiction
  into `source.json` under a "Could not persist invented analysis" warning. Dormant on the current
  library (all 33 sources already have BPM and key) but a live corruption path on any source that
  lacked them, and a direct violation of the no-invented-data rule.
- **Stopped two hardcoded claims** now that Task 3 gave them a persisted home: every real source
  reported the prototype profile's `sensitivity` (68) and claimed `sourceTypes: ["Voice memo","Jam"]`.
  Both now read from the document. **Visible consequence:** existing sources have no stored types, so
  they show none and the source-type filter matches nothing until there is UI to set them — honest,
  and the reason to wire the `updateSourceSettings` call Task 3 added.
- **Stopped rendering `0` as a measured tempo** in the fragment card and connections table.

Deliberately **not** in 4a: `Fragment.bpm` stays `number` with `?? 0` as its unknown sentinel.
Making it `number | null` touches eight files and the arithmetic in the affinity scorer, and the type
lives in `prototype-data.ts` — so it belongs with 4b's view models.

---

## 9. The five fake paths, and what each is actually waiting on

Context from you, which changes the plan: the fake paths exist for demo reasons, not by accident.
Each needs a different treatment, and only one of them is a "keep faking it" situation.

### 9.1 Web build reads the real library (done)

**Was:** the browser had no bridge, so `window.fragments` was undefined and the app fell back to the
prototype dataset plus `public/audio/f01.wav`. That was the fake dataset's main justification.

**Now:** the `FragmentsBridge` contract from Task 3 has two implementations. Electron speaks IPC;
the browser speaks HTTP to a Vite dev-server plugin (`lib/dev/library-dev-server.ts`) that calls the
**same `createLibraryService`**. One implementation of persistence, two transports, one library
folder.

The load-bearing change is `BridgeCapabilities` (`import`, `persist`, `drag`). Callers used to treat
"a bridge exists" as "we are in Electron"; with a web bridge present that assumption would have sent
the import dialog down the managed path and silently done nothing. All eight call sites now ask
what the host can *do*.

Not copied into `public/`: the sources are **97 MB across 33 files**, so a static export would bloat
the repo. The dev plugin is `apply: "serve"`, so a deployed static build has no library behind it —
its `listSources` rejects and the app reports a load failure, which is the honest outcome. A public
demo would need a curated, downsampled subset; that is a separate decision.

Verified against the running dev server: `/__library/sources` returns 33 sources / 54 fragments /
791 relationships with normalization applied; audio returns `200` with `Accept-Ranges` and a correct
MIME type; a `Range` request returns `206` with the right `Content-Range` (**without this, seeking in
`<audio>` silently breaks**); an unknown id and a `../../etc/passwd` traversal both return `404`.

### 9.2 The Map is a placeholder — keep, but feed it real data

Its projection (`app/map-layout.mjs`) is arbitrary but real code; only its *input* was fake. Once the
prototype fragments go, it renders the library's own fragments and stays useful as a placeholder
until it is replaced. No work needed beyond 4b.

### 9.3 Slicing: Essentia can do this, and we already ship it

The answer to "can Essentia help" is yes, and the current code is barely using it. It imports only
the **extractor** wrapper — three calls. The **core** API in the same installed package exposes 211
algorithms, including:

- `SuperFluxExtractor(signal, combine, frameSize, hopSize, ratioThreshold, sampleRate, threshold)` —
  onset detection built for spectral/energy change boundaries. `threshold` and `combine` (a minimum
  gap in ms) map onto the existing sensitivity slider, which is what stops it emitting 200 slices.
- `RhythmExtractor2013`, `BeatTrackerMultiFeature` — real beats and tempo, so `beats`/`bars` stop
  being zeros.
- `MFCC`, `HPCP`, `SpectralContrast`, `SpectralCentroidTime`, `Loudness` — the features §9.4 needs.

No `SBic`, so no BIC segmentation; onsets plus a minimum-length grouping rule suits musical fragments
better anyway. **No new dependency.** So this is not "fake it until a library exists" — it is a real
implementation behind a `SliceStrategy` seam, which is worth introducing either way.

### 9.4 Affinities: deterministic rules, but features come first

Proposal — a weighted score filling the seven axes already on disk, computing only what is derivable:

| Axis | Rule |
| --- | --- |
| `tempo` | BPM distance **allowing harmonic ratios** (1, 2, ½, 1.5, ⅔), so 70 matches 140 instead of scoring zero |
| `harmony`, `pitch` | Circle-of-fifths distance plus relative major/minor; better, cosine distance between HPCP chroma vectors |
| `timbre` | Cosine distance between mean MFCC vectors — the axis that finds "belongs with" |
| `brightness` | Spectral centroid ratio |
| `rhythm` | Inter-onset-interval histogram similarity, free once §9.3 computes onsets |
| `melody` | Genuinely hard. **Omit rather than fake.** |

**Prerequisite:** none of this works from what is stored today. `analysis` holds BPM, key, scale, and
key strength — there is no chroma or MFCC to compare. So the order is *batch feature extraction
first, rules second*. `MeasuredAnalysis` was designed for that (additive optional fields plus
provenance so a re-run cannot clobber a hand-corrected value).

**This invalidates a Task 3 decision:** `RelationshipMetrics` requires all seven axes, which was
correct for the fabricated data on disk but wrong for honest generation, where `melody` will not
exist. Axes must become individually optional, and "absent" must render differently from "scored 0".

### 9.6 What the 791 relationships on disk actually are

Measured, not guessed, because two plausible assumptions about them were both wrong.

**They were rule-based, not random.** The correlation between real BPM distance and the stored
`tempo` metric is **−0.968**, and the `reason` strings are literal ("Tempos are close (126 vs 148
BPM)").

**They do not point at prototype fragments.** All 791 rows have both endpoints resolving to real
fragments in the library — zero dangling, 791 distinct undirected pairs, no duplicates, all
`algorithmic`. They survive display because `rankedConnectionsFor` has an `isLibraryRelationship`
bypass that skips the tolerance filters for library-to-library pairs.

**Only a few appear because of a hard cap**, not a bug: `rankedConnectionsFor(sourceId, limit = 6)`
sorts by score and takes six. The median fragment has 25 candidates and 48 of 51 fragments exceed the
cap, so roughly 19 matches per fragment are hidden.

**But only about three axes carry information.** `rhythm` is identical to `tempo`, `pitch` is
identical to `harmony`, and `timbre` and `brightness` are the **constant 0.70 for all 791 rows**.
That is the concrete gap Essentia's `MFCC` and `SpectralCentroidTime` close, and the evidence for
§9.4's ordering.

**The generator no longer exists.** It is only in git history (`057cb40`). Nothing in `app/` calls
`updateRelationships` — that channel is fully plumbed through contract, preload, persistence, and
service, and entirely unused — and import creates no relationships. **Consequence: clearing the
sources folder and re-importing yields zero affinities, irrecoverably.** Do the clear-and-reslice
only after a generator exists, and back the folder up first.

### 9.5 The soft-delete replay hack: keep

A demo affordance whose cost disappears once 9.3 and 9.4 are real. Removing it early only costs a
demo. Revisit after those land.
