// Flat-file persistence core for the audio library. Main-process only.
//
// Each source lives in its own directory under `<libraryRoot>/sources/<id>/`:
//   original.<ext>  - the managed copy of the imported audio file
//   source.json     - schema-versioned metadata for that recording
//
// `beginImport` copies the audio and writes a pending `source.json` (duration,
// format, sample rate, waveform, and analysis are `null` until the renderer
// finishes decoding and analyzing the managed copy). `finalizeImport` fills in
// that measured metadata and adds the single whole-file fragment.
//
// Intentionally framework-free so it can be unit tested with `node:test`
// against a real temporary directory, independent of Electron.

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWriteJson } from "./atomic-write";
import { assertSafeRelativeFilename, assertSafeSourceId, resolveWithinDir } from "./paths";
import {
  DEFAULT_SENSITIVITY,
  SCHEMA_VERSION,
  emptyMeasuredAnalysis,
  normalizeSourceDocument,
  validateFinalizeMetadata,
  validateFragments,
  validateMeasuredAnalysis,
  validateRelationships,
} from "./source-document";
import type {
  FinalizeMetadata,
  FragmentInput,
  MeasuredAnalysis,
  RelationshipDocument,
  SourceDocument,
  SourceType,
} from "./source-document";

const SOURCES_DIR_NAME = "sources";
const SOURCE_DOCUMENT_FILENAME = "source.json";

/** Thrown when a live source already holds the same original filename. */
export type DuplicateSourceError = Error & { code: "DUPLICATE_SOURCE" };

export type SourceSettings = {
  sourceTypes?: SourceType[];
  sensitivity?: number;
};

export type LibraryService = {
  beginImport(audioPath: string): Promise<SourceDocument & { restored?: boolean }>;
  finalizeImport(sourceId: string, metadata: FinalizeMetadata): Promise<SourceDocument>;
  cancelImport(sourceId: string): Promise<void>;
  listSources(): Promise<SourceDocument[]>;
  archiveSource(sourceId: string): Promise<SourceDocument>;
  resolveAudioPath(sourceId: string, audioFile: string): string;
  updateSourceAnalysis(sourceId: string, analysis: MeasuredAnalysis): Promise<SourceDocument>;
  updateSourceSettings(sourceId: string, settings: SourceSettings): Promise<SourceDocument>;
  updateFragments(sourceId: string, fragments: FragmentInput[]): Promise<SourceDocument>;
  updateRelationships(
    sourceId: string,
    relationships: RelationshipDocument[],
  ): Promise<SourceDocument>;
};

async function sha256File(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export function createLibraryService(libraryRoot: string): LibraryService {
  const sourcesRoot = path.join(libraryRoot, SOURCES_DIR_NAME);

  function sourceDirFor(sourceId: string) {
    return path.join(sourcesRoot, assertSafeSourceId(sourceId));
  }

  function sourceDocumentPathFor(sourceId: string) {
    return path.join(sourceDirFor(sourceId), SOURCE_DOCUMENT_FILENAME);
  }

  async function ensureSourcesRoot() {
    await fs.mkdir(sourcesRoot, { recursive: true });
  }

  /** Every read goes through the migration seam, so callers see defaulted fields. */
  async function readSourceDocument(sourceId: string): Promise<SourceDocument> {
    const raw = await fs.readFile(sourceDocumentPathFor(sourceId), "utf8");
    return normalizeSourceDocument(JSON.parse(raw));
  }

  async function writeSourceDocument(document: SourceDocument): Promise<SourceDocument> {
    await atomicWriteJson(sourceDocumentPathFor(document.id), document);
    return document;
  }

  async function listAllSourceDocuments(): Promise<SourceDocument[]> {
    await ensureSourcesRoot();
    const entries = await fs.readdir(sourcesRoot, { withFileTypes: true });
    const documents: SourceDocument[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        documents.push(await readSourceDocument(entry.name));
      } catch (error) {
        // A single unreadable, corrupt, or future-schema document is skipped so
        // the rest of the library still loads.
        if (error instanceof SyntaxError) continue;
        if (isErrnoException(error) && error.code === "ENOENT") continue;
        if (error instanceof Error && /schemaVersion|must be an object/.test(error.message)) continue;
        throw error;
      }
    }
    return documents;
  }

  async function findSourceByOriginalName(originalName: string): Promise<SourceDocument | null> {
    const normalized = path.basename(originalName).trim().toLowerCase();
    const documents = await listAllSourceDocuments();
    return (
      documents.find(
        (document) => path.basename(document.originalName ?? "").trim().toLowerCase() === normalized,
      ) ?? null
    );
  }

  /**
   * Marks a source as removed from the library without deleting its on-disk
   * folder. Re-importing a file with the same name restores it.
   */
  async function archiveSource(sourceId: string): Promise<SourceDocument> {
    const existing = await readSourceDocument(sourceId);
    return writeSourceDocument({ ...existing, deletedAt: new Date().toISOString() });
  }

  async function restoreSource(sourceId: string): Promise<SourceDocument> {
    const existing = await readSourceDocument(sourceId);
    return writeSourceDocument({
      ...existing,
      deletedAt: null,
      restoredAt: new Date().toISOString(),
    });
  }

  /**
   * Copies `audioPath` into a new `sources/<id>/original.<ext>` directory and
   * writes a pending `source.json`. Measured fields stay `null` and `fragments`
   * stays empty until `finalizeImport` runs.
   *
   * If the file matches a soft-deleted source by original filename, that source
   * is restored and returned instead of creating a new directory.
   *
   * If copying, hashing, or writing the document fails, the newly-created source
   * directory is removed so no orphaned, half-populated source is left behind.
   */
  async function beginImport(audioPath: string) {
    await ensureSourcesRoot();
    const originalName = path.basename(audioPath);
    const existing = await findSourceByOriginalName(originalName);
    if (existing?.deletedAt) {
      const restored = await restoreSource(existing.id);
      return { ...restored, restored: true };
    }
    if (existing) {
      const error = new Error("This recording is already in your library.") as DuplicateSourceError;
      error.code = "DUPLICATE_SOURCE";
      throw error;
    }

    const contentHash = await sha256File(audioPath);
    const id = randomUUID();
    const extension = path.extname(audioPath);
    const audioFile = `original${extension}`;
    const sourceDir = sourceDirFor(id);

    try {
      await fs.mkdir(sourceDir, { recursive: true });

      const destination = resolveWithinDir(sourceDir, audioFile);
      await fs.copyFile(audioPath, destination);

      const document: SourceDocument = {
        schemaVersion: SCHEMA_VERSION,
        id,
        originalName,
        audioFile,
        contentHash,
        importedAt: new Date().toISOString(),
        deletedAt: null,
        duration: null,
        format: null,
        sampleRate: null,
        waveform: null,
        analysis: emptyMeasuredAnalysis(),
        sourceTypes: [],
        sensitivity: DEFAULT_SENSITIVITY,
        fragments: [],
        relationships: [],
      };

      return await writeSourceDocument(document);
    } catch (error) {
      await fs.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Validates, then merges, measured metadata (duration, format, sample rate,
   * waveform, analysis) into a pending source and adds its single whole-file
   * fragment. Invalid metadata is rejected before any write, so a pending
   * `source.json` is left untouched on rejection.
   */
  async function finalizeImport(
    sourceId: string,
    metadata: FinalizeMetadata,
  ): Promise<SourceDocument> {
    validateFinalizeMetadata(metadata);
    const existing = await readSourceDocument(sourceId);
    const { duration, sampleRate, waveform, analysis } = metadata;

    return writeSourceDocument({
      ...existing,
      duration,
      format: metadata.format ?? existing.format,
      sampleRate,
      waveform,
      analysis,
      sourceTypes: metadata.sourceTypes ?? existing.sourceTypes,
      fragments: [
        {
          id: `${existing.id}-whole`,
          name: existing.originalName,
          start: 0,
          end: duration,
          roles: [],
          primaryRole: "Unclassified",
          userTags: [],
          analysis,
          analysisRevision: 1,
          createdAt: existing.importedAt,
        },
      ],
    });
  }

  /**
   * Re-reads every source.json under `sources/<id>/` from disk. Nothing is
   * cached in memory, so a freshly created service instance (e.g. after an app
   * restart) sees documents written by an earlier instance.
   */
  async function listSources(): Promise<SourceDocument[]> {
    const documents = await listAllSourceDocuments();
    const active = documents.filter((document) => !document.deletedAt);
    active.sort((a, b) => (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0));
    return active;
  }

  /** Resolves the on-disk path of a source's managed audio copy, rejecting traversal. */
  function resolveAudioPath(sourceId: string, audioFile: string): string {
    assertSafeRelativeFilename(audioFile);
    return resolveWithinDir(sourceDirFor(sourceId), audioFile);
  }

  async function cancelImport(sourceId: string): Promise<void> {
    await fs.rm(sourceDirFor(sourceId), { recursive: true, force: true });
  }

  /**
   * Updates measured analysis on an existing source document. Fragments are left
   * unchanged so fragment-level metadata can diverge later.
   */
  async function updateSourceAnalysis(
    sourceId: string,
    analysis: MeasuredAnalysis,
  ): Promise<SourceDocument> {
    validateMeasuredAnalysis(analysis);
    const existing = await readSourceDocument(sourceId);
    return writeSourceDocument({ ...existing, analysis });
  }

  /**
   * Persists the two fields the UI collects but used to drop on the floor:
   * import source types and workbench segmentation sensitivity. Only the keys
   * present in `settings` are written, so callers can update one without
   * clobbering the other.
   */
  async function updateSourceSettings(
    sourceId: string,
    settings: SourceSettings,
  ): Promise<SourceDocument> {
    const existing = await readSourceDocument(sourceId);
    if (settings.sourceTypes !== undefined && !Array.isArray(settings.sourceTypes)) {
      throw new Error("settings.sourceTypes must be an array");
    }
    if (
      settings.sensitivity !== undefined &&
      (typeof settings.sensitivity !== "number" || !Number.isFinite(settings.sensitivity))
    ) {
      throw new Error("settings.sensitivity must be a finite number");
    }
    return writeSourceDocument({
      ...existing,
      sourceTypes: settings.sourceTypes ?? existing.sourceTypes,
      sensitivity: settings.sensitivity ?? existing.sensitivity,
    });
  }

  /**
   * Overwrites the fragment list on an existing source document, so segmentation
   * survives an app restart the way `duration` and `waveform` already do.
   *
   * Each fragment's `createdAt` is preserved from the previous document when that
   * id already existed, rather than trusting the renderer — so renaming or
   * re-slicing never bumps a fragment to the top of a "latest uploaded" sort.
   *
   * Fragments predating the `createdAt` field fall back to the source's
   * `importedAt`, not to now. Falling back to now made this call non-idempotent:
   * most fragments in the real library have no stored `createdAt` (the renderer
   * never sent one), so every save re-stamped them and defeated the guard above.
   */
  async function updateFragments(
    sourceId: string,
    fragments: FragmentInput[],
  ): Promise<SourceDocument> {
    validateFragments(fragments);
    const existing = await readSourceDocument(sourceId);
    const existingById = new Map(existing.fragments.map((fragment) => [fragment.id, fragment]));
    const stamped = fragments.map((fragment) => ({
      ...fragment,
      createdAt:
        existingById.get(fragment.id)?.createdAt
        ?? fragment.createdAt
        ?? existing.importedAt
        ?? new Date().toISOString(),
    }));
    return writeSourceDocument({ ...existing, fragments: stamped });
  }

  /**
   * Overwrites the relationships list on an existing source document — the
   * affinities this source's fragments have to fragments in other sources.
   * Stored per-source (keyed by the relationship's `source` fragment id) so the
   * library's affinity graph survives a restart.
   *
   * Caution: this replaces the list wholesale. Passing an empty or recomputed
   * array destroys curated edges, which has already happened once in this
   * project's history. Prefer merge-or-explicit-edit at the call site.
   */
  async function updateRelationships(
    sourceId: string,
    relationships: RelationshipDocument[],
  ): Promise<SourceDocument> {
    validateRelationships(relationships);
    const existing = await readSourceDocument(sourceId);
    return writeSourceDocument({ ...existing, relationships });
  }

  return {
    beginImport,
    finalizeImport,
    cancelImport,
    listSources,
    archiveSource,
    resolveAudioPath,
    updateSourceAnalysis,
    updateSourceSettings,
    updateFragments,
    updateRelationships,
  };
}
