// Minimal flat-file persistence core for the audio library.
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
// This module is intentionally framework-free so it can be unit tested with
// `node:test` against a real temporary directory, independent of Electron.

import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const SOURCES_DIR_NAME = "sources";
const SOURCE_DOCUMENT_FILENAME = "source.json";
const SAFE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function assertSafeSourceId(id) {
  if (typeof id !== "string" || id.length === 0 || !SAFE_ID_PATTERN.test(id) || id === "." || id === "..") {
    throw new Error("source id must be a non-empty identifier without path traversal segments");
  }
  return id;
}

function assertSafeRelativeFilename(filename, label = "audioFile") {
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
function resolveWithinDir(dir, filename) {
  const resolvedDir = path.resolve(dir);
  const resolved = path.resolve(resolvedDir, filename);
  const prefix = `${resolvedDir}${path.sep}`;
  if (resolved !== resolvedDir && !resolved.startsWith(prefix)) {
    throw new Error("resolved path escapes its managed directory (traversal rejected)");
  }
  return resolved;
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Writes JSON via a temp file + rename so readers never observe a partial
 * write. The temp file is created exclusively, written, fsync'd, and closed
 * before the rename; if any step fails, the temp file is always removed so
 * no `.tmp` litter survives a failed write.
 */
async function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const json = `${JSON.stringify(value, null, 2)}\n`;

  let handle;
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

function emptyMeasuredAnalysis() {
  return { bpm: null, key: null, scale: null, keyStrength: null };
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value) {
  return isFiniteNumber(value) && value > 0;
}

function isNullableFiniteNumber(value) {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value) {
  return value === null || typeof value === "string";
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateFinalizeWaveform(waveform) {
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

function validateFinalizeAnalysis(analysis) {
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
 * Validates renderer-supplied finalize metadata before anything is written,
 * so a rejected `finalizeImport` call never mutates a pending `source.json`.
 */
function validateFinalizeMetadata(metadata) {
  if (!isPlainObject(metadata)) throw new Error("metadata must be an object");
  if (!isPositiveFiniteNumber(metadata.duration)) {
    throw new Error("metadata.duration must be a finite number greater than 0");
  }
  if (!isPositiveFiniteNumber(metadata.sampleRate)) {
    throw new Error("metadata.sampleRate must be a finite number greater than 0");
  }
  validateFinalizeWaveform(metadata.waveform);
  validateFinalizeAnalysis(metadata.analysis);
}

export function createLibraryService(libraryRoot) {
  const sourcesRoot = path.join(libraryRoot, SOURCES_DIR_NAME);

  function sourceDirFor(sourceId) {
    return path.join(sourcesRoot, assertSafeSourceId(sourceId));
  }

  function sourceDocumentPathFor(sourceId) {
    return path.join(sourceDirFor(sourceId), SOURCE_DOCUMENT_FILENAME);
  }

  async function ensureSourcesRoot() {
    await fs.mkdir(sourcesRoot, { recursive: true });
  }

  async function readSourceDocument(sourceId) {
    const raw = await fs.readFile(sourceDocumentPathFor(sourceId), "utf8");
    return JSON.parse(raw);
  }

  /**
   * Copies `audioPath` into a new `sources/<id>/original.<ext>` directory and
   * writes a pending `source.json`. Measured fields stay `null` and
   * `fragments` stays empty until `finalizeImport` runs.
   *
   * If copying, hashing, or writing the document fails, the newly-created
   * source directory is removed so no orphaned, half-populated source is
   * left behind.
   */
  async function beginImport(audioPath) {
    await ensureSourcesRoot();
    const id = randomUUID();
    const originalName = path.basename(audioPath);
    const extension = path.extname(audioPath);
    const audioFile = `original${extension}`;
    const sourceDir = sourceDirFor(id);

    try {
      await fs.mkdir(sourceDir, { recursive: true });

      const destination = resolveWithinDir(sourceDir, audioFile);
      await fs.copyFile(audioPath, destination);
      const contentHash = await sha256File(destination);

      const document = {
        schemaVersion: SCHEMA_VERSION,
        id,
        originalName,
        audioFile,
        contentHash,
        importedAt: new Date().toISOString(),
        duration: null,
        format: null,
        sampleRate: null,
        waveform: null,
        analysis: emptyMeasuredAnalysis(),
        fragments: [],
      };

      await atomicWriteJson(sourceDocumentPathFor(id), document);
      return document;
    } catch (error) {
      await fs.rm(sourceDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Validates, then merges, measured metadata (duration, format, sample
   * rate, waveform, analysis) into a pending source and adds its single
   * whole-file fragment. Invalid metadata is rejected before any write, so
   * a pending `source.json` is left untouched on rejection.
   */
  async function finalizeImport(sourceId, metadata) {
    validateFinalizeMetadata(metadata);
    const existing = await readSourceDocument(sourceId);
    const { duration, sampleRate, waveform, analysis } = metadata;

    const document = {
      ...existing,
      duration,
      format: metadata.format ?? existing.format,
      sampleRate,
      waveform,
      analysis,
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
        },
      ],
    };

    await atomicWriteJson(sourceDocumentPathFor(sourceId), document);
    return document;
  }

  /**
   * Re-reads every source.json under `sources/<id>/` from disk. Nothing is
   * cached in memory, so a freshly created service instance (e.g. after an
   * app restart) sees documents written by an earlier instance.
   *
   * A single corrupt or unreadable `source.json` is skipped rather than
   * failing the whole listing, so the rest of the library still loads.
   */
  async function listSources() {
    await ensureSourcesRoot();
    const entries = await fs.readdir(sourcesRoot, { withFileTypes: true });
    const documents = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        documents.push(await readSourceDocument(entry.name));
      } catch (error) {
        if (error && (error.code === "ENOENT" || error instanceof SyntaxError)) continue;
        throw error;
      }
    }
    documents.sort((a, b) => (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0));
    return documents;
  }

  /** Resolves the on-disk path of a source's managed audio copy, rejecting traversal. */
  function resolveAudioPath(sourceId, audioFile) {
    assertSafeRelativeFilename(audioFile);
    return resolveWithinDir(sourceDirFor(sourceId), audioFile);
  }

  async function cancelImport(sourceId) {
    await fs.rm(sourceDirFor(sourceId), { recursive: true, force: true });
  }

  /**
   * Updates measured analysis on an existing source document. Fragments are
   * left unchanged so fragment-level metadata can diverge later.
   */
  async function updateSourceAnalysis(sourceId, analysis) {
    validateFinalizeAnalysis(analysis);
    const existing = await readSourceDocument(sourceId);
    const document = { ...existing, analysis };
    await atomicWriteJson(sourceDocumentPathFor(sourceId), document);
    return document;
  }

  /**
   * Overwrites the fragment list on an existing source document. Used after
   * the renderer slices a source into fragments (or edits their bounds) so
   * that segmentation survives an app restart, the same way `duration` and
   * `waveform` already do.
   */
  async function updateFragments(sourceId, fragments) {
    if (!Array.isArray(fragments)) throw new Error("fragments must be an array");
    const existing = await readSourceDocument(sourceId);
    const document = { ...existing, fragments };
    await atomicWriteJson(sourceDocumentPathFor(sourceId), document);
    return document;
  }

  return {
    beginImport,
    finalizeImport,
    listSources,
    resolveAudioPath,
    cancelImport,
    updateSourceAnalysis,
    updateFragments,
  };
}
