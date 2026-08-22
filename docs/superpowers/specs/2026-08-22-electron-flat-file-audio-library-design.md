# Electron flat-file audio library

## Goal

Replace the in-memory prototype catalog with a persistent, portable audio library made of ordinary audio files and versioned JSON. Package the application with Electron so it can manage a user-selected folder without a database.

Library and Sources become two views of the same records:

- Sources shows physical recordings.
- Library shows fragments defined as time ranges within those recordings.

Imports survive reloads and application restarts.

## Current behavior

Import is currently browser-only and ephemeral. The browser decodes the selected file, creates a `blob:` URL, stores decoded peaks and analysis in an in-memory map, and adds a `SourceFile` to React state. Refreshing loses the imported source and its audio.

`app/prototype-data.ts` currently supplies authored source names, fragments, relationships, dates, durations, waveforms, keys, BPM values, and other metadata. The repository also contains primary audio files `public/audio/f01.wav` through `f28.wav` and derived audition assets such as stems and transformed versions.

## Storage layout

The user selects or creates one managed library directory:

```text
Fragments Library/
  library.json
  sources/
    src_01J.../
      original.m4a
      source.json
```

Each source has a stable generated ID and its own directory. The imported recording is copied into that directory as `original.<extension>`. This avoids dependence on the original file location and allows duplicate filenames.

`library.json` is a compact startup index containing:

- schema version
- library ID and display name
- source IDs and relative metadata paths
- last update timestamp

The index is a rebuildable cache. The authoritative metadata for each recording is its `source.json`.

## Source document

Each `source.json` contains:

- `schemaVersion`
- stable source ID
- original filename and relative audio filename
- SHA-256 content hash
- import and recording timestamps when known
- measured duration, MIME/format, and sample rate
- versioned waveform peaks
- measured BPM, key, scale, and confidence
- source types and analysis profile
- fragments belonging to the source

A fragment contains a stable ID, display name, start and end seconds, musical roles and tags, measured analysis, and user-authored overrides. Fragments reference ranges within the original recording. The app does not create clipped audio files unless the user exports a fragment.

All paths stored in JSON are relative to the library root or source directory. No machine-specific absolute paths are persisted.

## Electron architecture

### Main process

The Electron main process owns:

- choosing or creating the library directory
- copying imported audio
- hashing files
- reading, validating, and writing JSON
- rebuilding the root index
- resolving safe audio paths
- recovering incomplete operations

### Preload bridge

Context isolation remains enabled. The renderer receives a narrow, typed API such as:

- `chooseLibrary()`
- `openLibrary()`
- `listSources()`
- `importAudio()`
- `readSource(id)`
- `saveSource(source)`
- `getAudioUrl(id)`
- `rebuildIndex()`

The bridge does not expose Node.js, arbitrary paths, or unrestricted filesystem methods.

### Renderer

The React renderer continues to decode audio and run Essentia analysis. It displays records returned by the storage adapter and sends completed analysis or fragment edits back through the bridge.

### Storage adapter

UI code depends on a `LibraryStorage` interface rather than Electron APIs directly. Implementations include:

- Electron filesystem storage for the desktop application
- in-memory storage for component and integration tests

## Import flow

1. The user chooses an audio file.
2. Electron computes its hash and checks for an existing source.
3. Electron copies it into a temporary source directory.
4. The renderer decodes the managed copy and computes waveform and musical analysis.
5. Electron validates and atomically writes `source.json`.
6. Electron renames the temporary directory into `sources/<source-id>`.
7. Electron atomically updates `library.json`.
8. The source and its initial whole-file fragment appear in Sources and Library.

The initial fragment spans `0` to the measured duration. Later fragmentation edits replace or subdivide that range in the same source document.

If a matching hash already exists, the application offers to open the existing source or import another logical copy. It never silently duplicates a recording.

## Migration from prototype data

The migration imports primary files `f01.wav` through `f28.wav`. Each becomes one source with one whole-file fragment.

For every primary file, migration measures:

- duration
- sample rate and format
- waveform peaks
- BPM
- key, scale, and confidence
- content hash

Measured values replace invented waveform, duration, BPM, and key fields from `prototype-data.ts`. Existing fragment names are retained as display labels during migration, but they are not treated as measured metadata.

Derived assets such as stems, pitch-shifted files, matched files, and beat-shifted files are not imported as sources. They remain tracked as audition fixtures but are excluded from the source catalog.

Authored relationships, scores, and reasons are not migrated. A future relationship feature must mark user-authored links explicitly as curated and must not present them as computed analysis.

After migration:

- Sources lists the 28 physical primary recordings.
- Library lists their 28 whole-file fragments.
- Every Library fragment references an existing source.
- New imports appear in both tabs immediately.
- `importComplete`, `IMPORTED_FRAGMENT_IDS`, and the staged demo reveal are removed.
- Domain types and analysis profiles move out of `prototype-data.ts`.
- Fake records remain only as isolated test fixtures where needed.

## Consistency rules

- A fragment is always nested under exactly one source.
- Fragment start and end must be finite, ordered, and within source duration.
- Library derives its fragment list from loaded sources; it does not maintain a competing fragment catalog.
- Source IDs and fragment IDs never depend on display names.
- Measured analysis and user overrides remain distinguishable.
- Waveform data includes a version and peak count so it can be regenerated safely.

## Reliability and recovery

JSON writes use a temporary file, flush, and atomic rename. Audio is fully copied before metadata is committed. A source directory is made visible only after its metadata validates.

On startup:

- missing audio marks the source unavailable without crashing the library
- malformed JSON is quarantined and reported with its path
- unsupported schema versions are reported without being overwritten
- an absent or invalid `library.json` can be rebuilt by scanning source documents
- abandoned temporary import directories are reported and can be cleaned safely

Path validation prevents traversal outside the selected library directory.

## Error handling

Import errors preserve the original file and remove only temporary managed files. Analysis failure does not discard an otherwise valid recording; analysis fields become unavailable and can be retried.

The UI distinguishes:

- unsupported or unreadable audio
- copy or disk-space failure
- duplicate content
- analysis failure
- malformed metadata
- missing managed audio
- unsupported schema version

## Testing

Unit tests cover:

- source document validation
- fragment range validation
- safe path resolution
- atomic JSON writes
- duplicate hash behavior
- index rebuilding
- schema-version rejection

Filesystem integration tests use temporary directories and small real WAV fixtures. They verify import recovery, missing files, corrupt JSON, and measured duration.

Renderer tests use the in-memory storage adapter. Migration tests verify that all 28 primary WAV files produce valid source documents and that every Library fragment resolves to a Source.

Existing tests that inspect `prototype-data.ts` or hard-code counts such as “24 surfaced” are replaced with storage consistency assertions.

## Deployment

Electron is the only supported application target. The GitHub Pages workflow, static deployment configuration, and public web deployment scripts are removed.

No relational database, IndexedDB, or cloud service is required.

## Out of scope

- synchronization across computers
- concurrent multi-user editing
- cloud backup
- clipped fragment files created during ordinary fragmentation
- automatic relationship generation
- migration of derived audition assets into the primary source catalog
