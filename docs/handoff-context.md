# Handoff context (historical)

> **Not a source of truth.** This is institutional memory: what broke and what was decided while
> growing the flat-file library on top of the original prototype UI. It records intent at a point in
> time and parts of it are already out of date. **The code on disk and `source.json` are
> authoritative.** Verify before relying on anything here.

Useful as a warning system when changing persistence, affinities, key/BPM display, or playback — it
tells you which changes have bitten before. It is not a plan and it does not describe the current
architecture.

For what is actually true and what happens next:

- [Operation plan](./operation-plan.md) — verified baseline, decisions taken, wave order. **Start here.**
- [Modular refactor plan](./superpowers/plans/2026-08-24-modular-refactor-and-agent-readiness.md) — task-by-task detail.
- `AGENTS.md` — conventions and the verification loop.

Earlier design and plan documents from 2026-08-22 described a repository state that was never reached.
They were deleted as stale and misleading. Do not resurrect them; git history has them if you ever
need the archaeology.

## Known-stale claims in this document

Corrected against the real library on 2026-08-24. Treat the rest with the same suspicion:

- **"Affinities are curated."** They are not, any more. All 791 relationships on disk carry
  `origin: "algorithmic"`; zero are curated. The auto-generator overwrote the hand-authored demo links
  described below, including the ones in `09_30_2025_gtrjam.wav`.
- **"Duplicate live filename is rejected."** Untested by the two live `song1.wav` sources — those
  folders were placed by hand as manual-testing assets and never went through `beginImport`, so the
  rule was never exercised.

---

## Dual product layers

The app still runs **two catalogs at once**:

1. **Prototype demo** — `app/prototype-data.ts`, `public/audio/f*.wav`, hand-authored `RELATIONSHIPS`, demo affinities scoring/tolerances.
2. **Managed library** — Electron copies audio into `~/Documents/Fragments Library/sources/<uuid>/` with authoritative `source.json`. Fragments are time ranges inside the original file, not separate WAV clips.

Most user-facing “real” work goes through layer 2, but layer 1 still seeds Library/Map/Affinities UI and still influences filters and scoring. Anything that “works for demo fragments” can fail for imported UUID fragments.

Default library root: `~/Documents/Fragments Library` (override with `FRAGMENTS_LIBRARY_ROOT`).

---

## Source of truth on disk

Each source folder is roughly:

```text
sources/<source-id>/
  original.<ext>
  source.json
```

`source.json` owns:

- measured / edited `analysis` (`bpm`, `key`, `scale`, `keyStrength`, optional sonogram)
- `fragments[]` (`id`, `name`, `start`, `end`, roles/tags, per-fragment analysis)
- `relationships[]` (affinities whose **`source` fragment id belongs to this source**)
- soft-delete: `deletedAt` / `restoredAt` (folder is kept)

Authoritative key/BPM for display and filters should come from this document (source-level analysis, with fragment analysis as a secondary signal). Preview/quick analysis in the renderer cache is **not** authoritative.

Fragment IDs in practice look like:

- `<source-uuid>-01` … `-NN` for sliced fragments
- `<source-uuid>-whole` for a single whole-file fragment

---

## Decisions that matter

### Soft delete and re-import

- “Remove from library” archives via `deletedAt`; folder stays on disk.
- Re-import matching is by **original filename** (case-insensitive), not content hash. Content-hash matching was abandoned because users re-import the same recording from another path/name expectation.
- Duplicate live (non-deleted) filename is rejected.

### Key filtering ignores relatives

- Library key filters must match **canonical** `key` + `scale` only.
- Do **not** expand match sets with `alternateKeys` / relative keys (that made “A dorian” match unrelated relatives). Helpers live in `lib/audio/source-metadata.ts` (`fragmentKeyLabels`, `sourceKeyLabels`, `resolvedMusicalKey`).

### Persisted analysis beats preview analysis

- Quick Essentia / cache analysis often disagrees with hand-corrected `source.json` (e.g. disk `C minor`, cache `F minor`).
- UI must prefer persisted source fields via `resolvedSourceAnalysis()` (library cards, sources table, detail panel, fragmentation workbench).
- On restore-import, seed the cache from `document.analysis` and **skip** quick analysis when persisted BPM/key already exist.

### Affinities are curated (not auto-flooded)

- A heuristic that paired every imported fragment with every other fragment was briefly enabled and immediately filled the library (hundreds of links; source cards showed affinities in the hundreds).
- That auto-generation was **turned off**. Affinities for real library fragments should come from `source.json` `relationships` (and demo `RELATIONSHIPS` for prototype IDs).
- Demo scoring tolerances (`tempoWindow`, `transformationCost`, pitch floors, bar-length rules) were built for near-matching prototype pairs. Real-library affinities often fail those gates. Library UUID relationships currently **bypass** those filters via `isLibraryRelationship()` so curated links remain visible. Prototype relationships still use the strict filters.

### Sensitivity knob does not re-slice

- Changing sensitivity used to call range-resizing and wipe user-defined slices.
- Sensitivity now updates the dial value only; slice geometry is owned by the ranges / Save boundaries flow.

### Fragment audio is a range, not a file

- Persisted fragments typically have `audio: ""`.
- Playback must resolve the **source** audio URL and seek to `start`/`end` (`buildFragmentPreviewScope`, `applyPreviewTime` in `lib/audio/source-playback.ts`).
- Affinities / Combine workspace historically used `fragment.audio` and transform demo assets only — broken for library fragments until wired through source URLs + clips.

---

## Brittle areas

### `app/fragments-app.tsx`

Still the god-object: library load, import/restore, affinities scoring, playback session, sources editor, map, archive. High risk of regressions when changing one concern. Prefer extracting rather than piling more branches here.

### Playback session races

Repeated play/scrub/switch across cards exposed:

- stale `loadedmetadata` / `canplay` callbacks from previous `Audio` elements
- seeking before duration is known (Electron custom protocol especially)
- playhead stuck when only relying on sparse `timeupdate`

Mitigations already in place: preview session IDs, pending seek until clip/file duration is usable, rAF progress while playing, clip seek that does not require full-file duration for fragment ranges. Affinities and fragmentation workbench each still have their own audio state machines — easy to diverge again.

### Drag-out vs scrub

Library waveforms sit inside a draggable slot for desktop/DAW export. Native drag can steal pointer events from scrubbing. Scrub track uses `touch-action: none` / drag prevention; don’t reintroduce bare `draggable` on the scrub surface.

### Affinity graph storage

- Relationships are stored **per source**, keyed by outgoing `relationship.source` fragment ownership.
- Loading merges all documents’ `relationships` into React state.
- Anything that writes `updateRelationships` for a source with an empty/heuristic list can wipe curated edges. Prefer merge-or-explicit-edit; don’t “recompute and overwrite all sources” on every fragment change.

### Prototype tolerances vs library affinities

`rankedConnectionsFor` still encodes demo product rules. Library bypass is a deliberate patch. A future unified affinity model should either:

- score/filter library and demo separately, or
- replace tolerances with rules that match measured BPM/key deltas for real recordings.

Until then, changing `DEFAULT_TOLERANCES` / “reasonable” mode can re-hide curated library links if the bypass is removed carelessly.

### Import / restore path

`import-dialog.tsx` + `beginImport` / `finalizeImport` / restore branches are easy to get wrong:

- Restored documents must keep existing fragments/analysis/relationships.
- Fresh imports still run waveform decode + optional quick analysis into `finalizeImport`.
- `listSources` filters deleted sources; restore UI may need the pending document when not yet listed.

### Electron packaging

Windows `win-unpacked` / EBUSY during electron-builder usually means a lock (running app, Explorer, Defender). Close processes and delete the folder manually; not an app logic bug.

---

## Playback contract (current intent)

| Surface | Expected behavior |
|--------|-------------------|
| Library fragment card | Source URL + clip `start`/`end`; scrub within clip |
| Library source card | Full source audio |
| Fragmentation modal | Clip from **current range** on the timeline (may differ from last saved fragment until Save) |
| Affinities A/B / modes | Source URL + clip for library fragments; optional transform asset when Adapt uses a packaged WAV |

Stop at clip end (loop only when the loop control is on). Don’t restart from file `0` for fragment previews.

---

## UI product notes from recent work

- Library list cards should **not** show Save/Saved; that control belongs in the fragmentation workbench.
- Fragment lane strip (selection widgets) height was raised so ~7 lanes fit without scrolling (`.fragment-lanes-scroll` ~165px).
- Affinities candidates panel needs an explicit scrollable flex layout (see `.affinities-workspace` / candidate list CSS) or long lists become unreachable.

---

## Demo affinities (superseded)

Affinities were once hand-written for demos into
`~/Documents/Fragments Library/sources/e0b6cfcc-5b2a-44d1-bfb1-a3cd89f946de/source.json`
(`09_30_2025_gtrjam.wav`), linking selected fragments to `fe54edcf-…-whole` (`synth-rec_OBX.wav`) and
`38cb7d0e-…-11` (Cloud Collapse fragment 11).

**Those hand edits are gone.** The auto-generator rewrote them as `origin: "algorithmic"`. The two
targets still match, so the intent survived, but nothing in the library is curated today. Library
contents live in the user's folder, not git, so no environment has them unless re-seeded.

---

## Suggested reading order for a new agent

1. `AGENTS.md`, then `docs/operation-plan.md` — conventions, verified state, and what happens next.
2. `lib/domain/library-service.mjs` — persistence, and the closest thing to truth in the codebase.
3. `lib/audio/source-playback.ts` + `lib/audio/source-metadata.ts` — clips and key resolution.
4. `app/fragments-app.tsx` — orchestration; treat carefully.
5. `app/hero-workflow.tsx` — Affinities playback.
6. `app/fragmentation-workbench.tsx` — slice editor.
7. This file, last, for why things are the way they are — not for what is true.

When changing behavior, prefer disk/`source.json` as truth over in-memory cache or prototype fixtures.
