// The renderer <-> main process contract. Dually compiled (Electron main and the
// renderer bundle), so: relative imports, no extensions, no `node:*`, no DOM.
//
// Channel names live here as constants so the preload, the main-process
// handlers, and the renderer cannot drift apart by a typo.

import type {
  FinalizeMetadata,
  FragmentInput,
  MeasuredAnalysis,
  RelationshipDocument,
  SourceDocument,
  SourceType,
} from "../domain/source-document";

export const FRAGMENTS_CHANNELS = {
  pickAudio: "fragments:pick-audio",
  beginImport: "fragments:begin-import",
  finalizeImport: "fragments:finalize-import",
  cancelImport: "fragments:cancel-import",
  archiveSource: "fragments:archive-source",
  deleteSource: "fragments:delete-source",
  listSources: "fragments:list-sources",
  updateSourceAnalysis: "fragments:update-source-analysis",
  updateSourceSettings: "fragments:update-source-settings",
  updateFragments: "fragments:update-fragments",
  updateRelationships: "fragments:update-relationships",
  readWaveform: "fragments:read-waveform",
  writeWaveform: "fragments:write-waveform",
  readRender: "fragments:read-render",
  writeRender: "fragments:write-render",
  startDrag: "fragments:start-drag",
} as const;

/**
 * A source document as the renderer receives it: the persisted document plus the
 * custom-protocol URL the main process mints for its managed audio copy. The URL
 * is not persisted, so it belongs here rather than in `SourceDocument`.
 */
export type SourceRecord = SourceDocument & { audioUrl: string };

/** `beginImport` reports whether it revived a soft-deleted source. */
export type BeginImportResult = SourceRecord & { restored?: boolean };

export type SourceSettingsPatch = {
  sourceTypes?: SourceType[];
  sensitivity?: number;
};

export type DragTarget = {
  sourceId?: string;
  assetPath?: string;
  /**
   * A rendered match under the source's `renders/` folder, preferred over the whole
   * managed file when it is there.
   *
   * This is how dragging a fragment hands over the fragment: the render is already
   * the slice, tempo- and pitch-matched if the user asked for that. A name that has
   * been pruned or never written falls back to the source rather than failing, so a
   * drag always delivers something.
   */
  renderFile?: string;
  /**
   * What to call the file the other application receives. Without it the drop is
   * named after the source id, which is a uuid.
   */
  label?: string;
};

/**
 * What the host can actually do.
 *
 * The renderer must branch on these rather than on whether a bridge exists. The
 * web build has a bridge too — backed by HTTP against the same library folder —
 * and it can read everything but cannot write to disk, open a native file picker,
 * or start an OS drag. Treating "a bridge is present" as "we are in Electron" is
 * what forced the prototype dataset to double as the web build's data source.
 */
export type BridgeCapabilities = {
  /** Can copy a file into the managed library: native picker plus a filesystem write. */
  import: boolean;
  /** Can persist edits back to `source.json`. */
  persist: boolean;
  /** Can hand a real file to another application via an OS drag. */
  drag: boolean;
};

/** Where the web bridge reads the library. Mirrors the Electron IPC channels. */
export const WEB_LIBRARY_ROUTES = {
  sources: "/__library/sources",
  audio: "/__library/audio",
  waveform: "/__library/waveform",
  render: "/__library/render",
} as const;

export type FragmentsBridge = {
  readonly capabilities: BridgeCapabilities;
  /** Opens the OS file picker. Resolves `null` when the user cancels. */
  pickAudioFile(): Promise<string | null>;
  beginImport(filePath: string): Promise<BeginImportResult>;
  finalizeImport(id: string, metadata: FinalizeMetadata): Promise<SourceRecord>;
  cancelImport(id: string): Promise<void>;
  /** Soft delete: the folder stays and re-importing the same filename restores it. */
  archiveSource(id: string): Promise<SourceRecord>;
  /**
   * Hard delete: removes the source's folder from disk. Requires the `persist`
   * capability, and there is nothing to restore afterwards.
   */
  deleteSource(id: string): Promise<void>;
  listSources(): Promise<SourceRecord[]>;
  updateSourceAnalysis(id: string, analysis: MeasuredAnalysis): Promise<SourceRecord>;
  updateSourceSettings(id: string, settings: SourceSettingsPatch): Promise<SourceRecord>;
  updateFragments(id: string, fragments: FragmentInput[]): Promise<SourceRecord>;
  updateRelationships(id: string, relationships: RelationshipDocument[]): Promise<SourceRecord>;
  /**
   * The high-resolution waveform sidecar, or `null` when the source has none.
   *
   * Kept off `SourceRecord` deliberately: it is fetched per source on screen, not
   * for every row of the library, which is the whole reason it is not in
   * `source.json`. Encoded by `lib/analysis/peaks`.
   */
  readWaveform(id: string): Promise<ArrayBuffer | null>;
  /** Requires the `persist` capability. */
  writeWaveform(id: string, bytes: ArrayBuffer): Promise<void>;
  /**
   * A previously rendered match, or `null` when this one has not been rendered — or
   * was pruned to keep the cache bounded. Both are ordinary: the renderer makes it
   * again. `fileName` comes from `renderFileName` in `lib/affinity/transform`, which
   * is what keeps the two hosts naming the same render identically.
   */
  readRender(id: string, fileName: string): Promise<ArrayBuffer | null>;
  /**
   * Requires the `persist` capability. Without it, transformed audio still plays —
   * it is rendered per session and held in memory rather than cached on disk.
   */
  writeRender(id: string, fileName: string, bytes: ArrayBuffer): Promise<void>;
  /** Fire-and-forget: starts an OS-level file drag. */
  startDrag(target: DragTarget): void;
};
