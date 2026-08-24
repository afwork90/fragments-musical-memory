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

export type SonogramData = {
  bands: number;
  frames: number[][];
};

/**
 * Where an analysis value came from. Batch extraction needs to tell three cases
 * apart: never measured, measured by a given extractor version, and corrected by
 * hand. Only the first two may be refreshed by a re-run — `"edited"` values are
 * the user's judgement and must survive.
 */
export type AnalysisProvenance = {
  origin: "measured" | "edited";
  /** Extractor identity and version, e.g. `"essentia.js@0.1.3"`. `null` when hand-edited. */
  extractor: string | null;
  at: string;
};

/**
 * Measured only. `null` means analysis did not produce a value — never guess one.
 *
 * Additively extensible: more Essentia features are coming and will be extracted
 * in batch. New fields must be optional so documents written before they existed
 * stay valid. Anything absent means "not measured", which is not the same as zero.
 *
 * Deliberately no index signature. Unmodeled extractor output survives a
 * read/write cycle at runtime (`normalizeSourceDocument` spreads rather than
 * rebuilds), but reading it requires declaring it here first — otherwise a typo
 * like `analysis.bmp` would type-check everywhere in the UI. Adding a feature is
 * one optional line.
 */
export type MeasuredAnalysis = {
  bpm: number | null;
  key: string | null;
  scale: string | null;
  keyStrength: number | null;
  /**
   * @deprecated Never populated. The extractor that produced it aborted inside
   * WASM on every call (see `lib/audio/types.ts`), so every document on disk
   * carries `{ bands: 0, frames: [] }`. Kept only so those documents still
   * validate; nothing writes it and nothing reads it.
   */
  sonogram?: SonogramData | null;
  provenance?: AnalysisProvenance;

  /**
   * How confident the beat tracker was. Low confidence with a plausible-looking
   * BPM is the normal outcome for short or unrhythmic audio, so this decides
   * whether the tempo is worth using rather than merely worth showing.
   */
  bpmConfidence?: number | null;

  /**
   * Mean MFCC across frames — a timbre fingerprint. Compared between fragments by
   * cosine distance; this is the axis that finds "sounds like it belongs with".
   */
  timbre?: number[] | null;

  /**
   * Mean HPCP chroma, 12 bins starting at A. Harmonic content without committing
   * to a key label, so two fragments can be compared even when neither has a
   * confident key.
   */
  chroma?: number[] | null;

  /** Mean spectral centroid in Hz: the measured basis for "brightness". */
  centroidHz?: number | null;

  /**
   * Onset times in seconds from the start of the source. Both the input to real
   * slicing and, via inter-onset intervals, the honest basis for a rhythm axis.
   */
  onsets?: number[] | null;

  /**
   * The rate every feature above was computed at. Mel filterbanks and chroma bins
   * depend on it, so features computed at different rates are not comparable —
   * recording it is what makes a mixed-format library safe to compare across.
   */
  featureSampleRate?: number | null;
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

/**
 * `origin` distinguishes machine-generated affinities from human ones. Every one
 * of the relationships currently on disk is `"algorithmic"`; telling them apart
 * is what lets them be labelled in the UI and retired without destroying
 * curated work.
 */
export type RelationshipOrigin =
  | "algorithmic"
  | "manual"
  | "auditioned"
  | "rejected"
  | "preferred";

export type RelationshipMetrics = {
  rhythm: number;
  harmony: number;
  melody: number;
  timbre: number;
  tempo: number;
  pitch: number;
  brightness: number;
};

/**
 * An affinity between two fragments. Every field is required because every field
 * is present on all relationships in the real library, including all seven
 * metric axes — the writer always emits the full shape.
 */
export type RelationshipDocument = {
  id: string;
  source: string;
  target: string;
  base: number;
  metrics: RelationshipMetrics;
  transformationCost: number;
  reason: string;
  origin: RelationshipOrigin;
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
  relationships: RelationshipDocument[];
};

/**
 * A fragment as the renderer submits it. `createdAt` is optional because
 * `updateFragments` stamps it authoritatively: it reuses the existing value when
 * the id is already known and otherwise sets it to now, so a rename or re-slice
 * cannot bump a fragment to the top of a "latest uploaded" sort.
 */
export type FragmentInput = Omit<FragmentDocument, "createdAt"> & { createdAt?: string };

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

/**
 * Checks the four fields every build understands. Extra fields are deliberately
 * not rejected: a newer extractor may have written features this build does not
 * model, and refusing them would make the library unreadable after a downgrade.
 */
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

export function validateFragments(fragments: unknown): asserts fragments is FragmentInput[] {
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

export function validateRelationships(value: unknown): asserts value is RelationshipDocument[] {
  if (!Array.isArray(value)) throw new Error("relationships must be an array");
  for (const relationship of value) {
    if (!isPlainObject(relationship)) throw new Error("each relationship must be an object");
    for (const field of ["id", "source", "target"] as const) {
      if (typeof relationship[field] !== "string" || relationship[field] === "") {
        throw new Error(`each relationship must have a non-empty ${field}`);
      }
    }
  }
}

/**
 * The read-side migration seam. Fills defaults for fields added after a document
 * was written, and refuses documents from a newer build rather than silently
 * dropping fields it does not understand.
 *
 * Deliberately forgiving about missing optional fields: the library can contain
 * hand-placed source folders that never went through `beginImport`.
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
    // Spread rather than replace, so extractor features this build does not
    // model survive a read/write cycle instead of being silently dropped.
    analysis: isPlainObject(raw.analysis)
      ? { ...emptyMeasuredAnalysis(), ...(raw.analysis as MeasuredAnalysis) }
      : emptyMeasuredAnalysis(),
    sourceTypes: Array.isArray(raw.sourceTypes) ? (raw.sourceTypes as SourceType[]) : [],
    sensitivity: isFiniteNumber(raw.sensitivity) ? raw.sensitivity : DEFAULT_SENSITIVITY,
    fragments: Array.isArray(raw.fragments) ? (raw.fragments as FragmentDocument[]) : [],
    relationships: Array.isArray(raw.relationships)
      ? (raw.relationships as RelationshipDocument[])
      : [],
  };
}
