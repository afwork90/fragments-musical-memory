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
  listSources: "fragments:list-sources",
  updateSourceAnalysis: "fragments:update-source-analysis",
  updateSourceSettings: "fragments:update-source-settings",
  updateFragments: "fragments:update-fragments",
  updateRelationships: "fragments:update-relationships",
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
} as const;

export type FragmentsBridge = {
  readonly capabilities: BridgeCapabilities;
  /** Opens the OS file picker. Resolves `null` when the user cancels. */
  pickAudioFile(): Promise<string | null>;
  beginImport(filePath: string): Promise<BeginImportResult>;
  finalizeImport(id: string, metadata: FinalizeMetadata): Promise<SourceRecord>;
  cancelImport(id: string): Promise<void>;
  archiveSource(id: string): Promise<SourceRecord>;
  listSources(): Promise<SourceRecord[]>;
  updateSourceAnalysis(id: string, analysis: MeasuredAnalysis): Promise<SourceRecord>;
  updateSourceSettings(id: string, settings: SourceSettingsPatch): Promise<SourceRecord>;
  updateFragments(id: string, fragments: FragmentInput[]): Promise<SourceRecord>;
  updateRelationships(id: string, relationships: RelationshipDocument[]): Promise<SourceRecord>;
  /** Fire-and-forget: starts an OS-level file drag. */
  startDrag(target: DragTarget): void;
};
