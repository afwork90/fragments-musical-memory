"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  FRAGMENTS,
  IMPORTED_FRAGMENT_IDS,
  RELATIONSHIPS,
  SEED_ANALYSIS,
  SOURCE_FILES,
} from "./prototype-data";
import type { Fragment } from "@/lib/view/fragment";
import type { Relationship } from "@/lib/view/relationship";
import type { SourceFile } from "@/lib/view/source-file";
import { scoreRelationship } from "@/lib/affinity/score";
import { DEFAULT_TOLERANCES, DEFAULT_WEIGHTS } from "@/lib/view/search";
import type { MatchTolerances, SearchWeights } from "@/lib/view/search";
import type { MusicalRole, RangeMode, RelationshipStatus, SearchContext } from "@/lib/view/vocabulary";
import { Waveform } from "@/lib/audio/waveform";
import { Button } from "@/lib/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/lib/ui/dialog";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { DuplicateTakesDialog } from "./features/library/duplicate-takes-dialog";
import { ConnectionsTable } from "./features/library/connections-table";
import { LibraryView } from "./features/library/library-view";
import { LibrarySort } from "./features/library/types";
import { ImportDialog, ImportedSource } from "./features/sources/import-dialog";
import { FragmentLibraryMeta, SourceDetailPanel } from "./features/sources/source-detail-panel";
import { SourcesView } from "./features/sources/sources-view";
import { SourceSort } from "./features/sources/types";
import { CombineCandidate, CombineWorkspace, ExportSheet } from "./hero-workflow";
import { FRAGMENTS_LOGO_SRC } from "./fragments-logo";
import { defaultFragmentName, draftFragmentForRange, EditableRange, FragmentationWorkbench, hasUnsavedRanges } from "./fragmentation-workbench";
import { LibraryFilters, createLibraryFilters } from "./library-filter-popover";
import { formatSeconds } from "@/lib/format";
import { bindSourceAudio, getCachedAudio, retainCachedAudio, updateCachedAnalysis } from "@/lib/audio/audio-service";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import {
  PreviewScope,
  buildFragmentPreviewScope,
  buildSourcePreviewScope,
  applyPreviewTime,
  progressForAudio,
  resolveSourceAudioUrl,
} from "@/lib/audio/source-playback";
import { armBrowserAudioUnlock, playMediaElement } from "@/lib/audio/browser-audio";
import { resolveAudioUrl } from "@/lib/audio/resolve-audio-url";
import {
  parseMusicalKeyLabel,
  resolvedMusicalKey,
  resolvedSourceAnalysis,
} from "@/lib/audio/source-metadata";
import { SourceAnalysisValues } from "./features/sources/source-detail-panel";
import { LibraryCard } from "./features/library/library-card";
import { FractureMapView } from "./features/fracture-map/fracture-map-view";
import { MAP_WORLD, musicalMapPoint } from "./map-layout.mjs";
import { DEFAULT_SENSITIVITY } from "@/lib/domain/source-document";
import { measuredSummaryFrom } from "@/lib/domain/measured-summary";
import type { FragmentDocument, SourceDocument } from "@/lib/domain/source-document";
import type { MusicalRole as DomainMusicalRole } from "@/lib/domain/source-document";
import type { SourceRecord } from "@/lib/ipc/contract";
import { getFragmentsBridge } from "@/lib/web/bridge";

type View = "library" | "source" | "map" | "archive";
/** The Map page shows one set of audio two ways. Not a view: the tab is the same tab. */
type MapMode = "graph" | "shatter";
type ScoredRelationship = Relationship & { score: number; otherId: string };
type ReturnSnapshot = { kind:"source-edit";view:View;selectedId:string;selectedSourceId:string;connectionsOpen:boolean;advancedOpen:boolean;scrollY:number };
type CorrectionPhase = "edit" | "recompute" | "prompt";
type SourcePanelMode = "detail" | "fragmentation";

const RANGE_COLORS = ["#a99cff","#74d8ff","#ffbc65","#c8fa78","#ff849b","#75e2c2"];
const OPENING_SOURCE_ID = SOURCE_FILES.find((source) => !source.imported)!.id;
const INITIAL_RELATIONSHIP_STATUSES = Object.fromEntries(RELATIONSHIPS.filter((relationship) => relationship.status).map((relationship) => [relationship.id,relationship.status!])) as Record<string,RelationshipStatus>;
const INITIAL_MANUAL_RELATIONSHIP_IDS = new Set(RELATIONSHIPS.filter((relationship) => relationship.status === "manual").map((relationship) => relationship.id));
const fragmentById = (id: string) => FRAGMENTS.find((fragment) => fragment.id === id)!;
const sourceNameFor = (fragment:Fragment) => SOURCE_FILES.find((source) => source.id === fragment.sourceId)?.name ?? fragment.source;
const otherIdFor = (relationship: Relationship, selectedId: string) => relationship.source === selectedId ? relationship.target : relationship.source;
const fragmentCountForSensitivity = (sensitivity:number) => Math.max(1,Math.min(6,Math.floor((sensitivity - 10) / 16) + 1));
const relationshipIsTransformed = (relationship:Relationship) => Boolean(relationship.transform && ((relationship.transform.pitch ?? 0) !== 0 || (relationship.transform.bpm ?? 0) !== 0 || relationship.transform.timing || (relationship.transform.beatOffset ?? 0) !== 0 || (relationship.transform.repeat ?? 1) !== 1 || relationship.transform.labels.some((label) => label !== "As recorded")));

function rangeForIndex(source:SourceFile,index:number):EditableRange {
  const referenced=FRAGMENTS.find((fragment) => fragment.id === source.fragmentIds[index]);
  if (referenced) return { id:`${source.id}-range-${index + 1}`,fragmentId:referenced.id,start:referenced.start,end:referenced.end,color:RANGE_COLORS[index % RANGE_COLORS.length] };
  if (index === 0) return { id:`${source.id}-range-1`, start:source.start, end:source.end, color:RANGE_COLORS[0] };
  const length = Math.max(8,Math.min(32,source.duration * (.12 + (index % 3) * .025)));
  const proposed = source.start + index * source.duration * .105 - (index % 2 ? source.duration * .028 : 0);
  const start = Math.max(0,Math.min(source.duration - length,proposed));
  return { id:`${source.id}-range-${index + 1}`, start, end:start + length, color:RANGE_COLORS[index % RANGE_COLORS.length] };
}

const initialSourceRanges = () => Object.fromEntries(SOURCE_FILES.map((source) => [source.id,Array.from({ length:fragmentCountForSensitivity(source.sensitivity) },(_,index) => rangeForIndex(source,index))]));

/**
 * The domain has an `"Unclassified"` role for freshly imported audio; the UI's
 * role list does not. Every fragment written by `finalizeImport` carries it, so
 * this translation is the common case, not an edge case — the previous
 * `?? "Texture"` fallback never fired because `"Unclassified"` is truthy, and an
 * unrepresentable role reached components that switch on the six real ones.
 */
function displayRole(role: DomainMusicalRole | undefined): MusicalRole {
  return role === undefined || role === "Unclassified" ? "Texture" : role;
}

/** Rebuilds an in-memory Fragment from a source.json fragment record, so persisted segmentation shows up in the Library after a reload. */
function fragmentFromDocument(fragmentDoc: FragmentDocument, index: number, source: SourceFile): Fragment {
  return {
    id: fragmentDoc.id,
    measured: measuredSummaryFrom(fragmentDoc.analysis, fragmentDoc.end - fragmentDoc.start),
    name: fragmentDoc.name || defaultFragmentName(source, index),
    sourceId: source.id,
    source: source.name,
    start: fragmentDoc.start,
    end: fragmentDoc.end,
    date: source.date,
    dateLabel: source.date,
    duration: formatSeconds(fragmentDoc.end - fragmentDoc.start),
    key: resolvedMusicalKey(fragmentDoc.analysis, source) ?? "—",
    alternateKeys: [],
    bpm: fragmentDoc.analysis?.bpm ?? source.bpm ?? 0,
    uploadedAt: fragmentDoc.createdAt ?? source.uploadedAt,
    role: displayRole(fragmentDoc.primaryRole),
    roles: fragmentDoc.roles?.length ? fragmentDoc.roles.map(displayRole) : ["Texture"],
    brightness: 0,
    waveform: slicePeaks(source.waveform, fragmentDoc.start, fragmentDoc.end, source.duration),
    beats: 0,
    bars: 0,
    confidence: 0,
    userTags: fragmentDoc.userTags ?? [],
    analysisRevision: fragmentDoc.analysisRevision ?? 1,
    audio: "",
    sourceTypes: source.sourceTypes,
  };
}

/** Inverse of `fragmentFromDocument`: the shape `library-service.mjs` persists on disk. */
function fragmentToDocument(fragment: Fragment) {
  const { key, scale } = parseMusicalKeyLabel(fragment.key);
  return {
    id: fragment.id,
    name: fragment.name,
    start: fragment.start,
    end: fragment.end,
    roles: fragment.roles,
    primaryRole: fragment.role,
    userTags: fragment.userTags,
    analysis: {
      bpm: fragment.bpm || null,
      key,
      scale,
      keyStrength: null,
    },
    analysisRevision: fragment.analysisRevision,
  };
}

const LIBRARY_FRAGMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-\d+|-whole)$/i;

function isLibraryFragmentId(id: string) {
  return LIBRARY_FRAGMENT_ID.test(id);
}

function isLibraryRelationship(relationship: Relationship) {
  return isLibraryFragmentId(relationship.source) && isLibraryFragmentId(relationship.target);
}

/**
 * A pending import has `duration`/`format` still `null`; `SourceFile` cannot
 * express that, so callers must only pass finalized documents. The main process
 * filters unfinalized sources out of `listSources`, and this throws rather than
 * substituting a zero duration that would render as a real, empty recording.
 */
function sourceFileFromDocument(document: SourceRecord, audioUrl?: string): SourceFile {
  if (document.duration === null) {
    throw new Error(`source ${document.id} is not finalized: duration is null`);
  }
  const duration = document.duration;
  const analysis = document.analysis;
  return {
    id: document.id,
    name: document.originalName,
    date: new Date(document.importedAt).toLocaleDateString("en-US", { month:"short",day:"2-digit",year:"numeric" }),
    duration,
    format: document.format ?? "—",
    device: "Managed library",
    fragmentIds: document.fragments.map((fragment) => fragment.id),
    waveform: document.waveform?.peaks ?? [],
    // Persisted, not assumed: every real source used to report the prototype
    // profile's sensitivity and claim to be a Voice memo / Jam.
    sensitivity: document.sensitivity,
    start: 0,
    end: duration,
    sourceTypes: document.sourceTypes,
    measured: measuredSummaryFrom(document.analysis, duration),
    imported: true,
    audioUrl: audioUrl ?? document.audioUrl,
    audioCacheKey: document.id,
    bpm: analysis.bpm,
    key: analysis.key,
    scale: analysis.scale,
    uploadedAt: document.importedAt,
  };
}

/** The override fields the fragmentation workbench writes, and so the ones a discard undoes. */
const WORKBENCH_OVERRIDE_KEYS = ["name","start","end","duration","analysisRevision"] as const;

function rangesFromDocument(document: SourceDocument): EditableRange[] {
  return document.fragments.map((fragment, index) => ({
    id: `${fragment.id}-range`,
    fragmentId: fragment.id,
    start: fragment.start,
    end: fragment.end,
    color: RANGE_COLORS[index % RANGE_COLORS.length],
  }));
}

export default function FragmentsApp() {
  const [view, setView] = useState<View>("library");
  const [selectedId, setSelectedId] = useState("f02");
  const [query, setQuery] = useState("");
  const [libraryFilters,setLibraryFilters] = useState<LibraryFilters>(createLibraryFilters);
  const [filterOpen,setFilterOpen] = useState(false);
  const [sort, setSort] = useState<LibrarySort>({ column:"uploaded", direction:"desc" });
  // Read-only: no control mutates these any more, so affinity scoring runs on
  // fixed inputs. Task 6 moves them into lib/affinity/ where they belong.
  const context: SearchContext = "whole";
  const rangeMode: RangeMode = "reasonable";
  const weights: SearchWeights = DEFAULT_WEIGHTS;
  const tolerances: MatchTolerances = DEFAULT_TOLERANCES;
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [duplicateExclusions, setDuplicateExclusions] = useState<Set<string>>(new Set());
  const [duplicateGroup, setDuplicateGroup] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceFile[]>(SOURCE_FILES.filter((source) => !source.imported).map((source) => ({ ...source })));
  const [selectedSourceId, setSelectedSourceId] = useState(OPENING_SOURCE_ID);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [connectionsWidth, setConnectionsWidth] = useState(640);
  const [resizingConnections, setResizingConnections] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceSort, setSourceSort] = useState<SourceSort>({ column:"date", direction:"desc" });
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourceEditorModal, setSourceEditorModal] = useState(false);
  const [sourcePanelMode, setSourcePanelMode] = useState<SourcePanelMode>("fragmentation");
  const [sourceRanges, setSourceRanges] = useState<Record<string,EditableRange[]>>(initialSourceRanges);
  const [importOpen,setImportOpen] = useState(false);
  const [importComplete,setImportComplete] = useState(false);
  const [fragmentOverrides,setFragmentOverrides] = useState<Record<string,Partial<Fragment>>>({});
  const [importedFragments,setImportedFragments] = useState<Fragment[]>([]);
  const [importedRelationships,setImportedRelationships] = useState<Relationship[]>([]);
  const [savedFragmentIds,setSavedFragmentIds] = useState<Set<string>>(new Set());
  /**
   * Sources the user has edited in this session without saving. `hasUnsavedRanges` already
   * sees boundary changes by comparing, so this is not how the save button learns it has
   * work to do — it is what separates "you have unsaved work here" from "this source was
   * never in sync", which is the difference between warning on close and nagging. It also
   * carries the one edit ranges cannot show: a rename.
   */
  const [unsavedEditSourceIds,setUnsavedEditSourceIds] = useState<Set<string>>(new Set());
  /** Set when closing would drop edits, so the close is confirmed rather than silent. */
  const [closeConfirmOpen,setCloseConfirmOpen] = useState(false);
  const [combineCandidates,setCombineCandidates] = useState<CombineCandidate[] | null>(null);
  const [correctionRelationship,setCorrectionRelationship] = useState<CombineCandidate | null>(null);
  const [correctionPhase,setCorrectionPhase] = useState<CorrectionPhase>("edit");
  const [correctionOriginal,setCorrectionOriginal] = useState<Pick<Fragment,"duration" | "key" | "bpm" | "bars" | "beats" | "confidence" | "analysisRevision"> | null>(null);
  const [combineDraftRanges,setCombineDraftRanges] = useState<EditableRange[] | null>(null);
  const [combineDraftSensitivity,setCombineDraftSensitivity] = useState<number | null>(null);
  const [exportRelationship,setExportRelationship] = useState<CombineCandidate | null>(null);
  const [relationshipStatuses,setRelationshipStatuses] = useState<Record<string,RelationshipStatus>>({ ...INITIAL_RELATIONSHIP_STATUSES });
  const [manualRelationshipIds,setManualRelationshipIds] = useState<Set<string>>(() => new Set(INITIAL_MANUAL_RELATIONSHIP_IDS));
  const [mapMode,setMapMode] = useState<MapMode>("shatter");
  const [mapSelectedId,setMapSelectedId] = useState<string | null>(null);
  // A PreviewScope id, so it is either a fragment id or `source:<id>` — the
  // shatter map treats a slice and a whole recording as the same kind of thing.
  const [fractureSelectedId,setFractureSelectedId] = useState<string | null>(null);
  const [hoveredMapId,setHoveredMapId] = useState<string | null>(null);
  const [infoFragmentId, setInfoFragmentId] = useState<string | null>(null);
  /** Whether this host can change the library on disk. False in the web preview. */
  const [canWriteFiles, setCanWriteFiles] = useState(false);
  const returnScroll = useRef(0);
  const returnStack = useRef<ReturnSnapshot[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const previewCleanupRef = useRef<(() => void) | null>(null);
  const previewScopeRef = useRef<PreviewScope | null>(null);
  const previewSessionRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const mapInspectorCloseRef = useRef<HTMLButtonElement>(null);
  const filterOpenRef = useRef(false);

  useEffect(() => {
    filterOpenRef.current = filterOpen;
  }, [filterOpen]);

  useEffect(() => {
    const bridge = getFragmentsBridge();
    if (!bridge) return;
    // Read once here rather than at every render: the host cannot change while the
    // app is open, and components that offer a destructive action need to know
    // whether this host can carry it out before they offer it.
    setCanWriteFiles(bridge.capabilities.persist);
    void bridge.listSources().then((documents) => {
      const persisted = documents.map((document) => sourceFileFromDocument(document));
      setSources((current) => [...current.filter((source) => !persisted.some((item) => item.id === source.id)),...persisted]);
      setSourceRanges((current) => ({
        ...current,
        ...Object.fromEntries(documents.map((document) => [document.id, rangesFromDocument(document)])),
      }));
      const persistedFragments = documents.flatMap((document) => {
        const source = persisted.find((item) => item.id === document.id);
        if (!source) return [];
        return document.fragments.map((fragmentDoc,index) => fragmentFromDocument(fragmentDoc,index,source));
      });
      setImportedFragments((current) => [
        ...current.filter((fragment) => !documents.some((document) => document.id === fragment.sourceId)),
        ...persistedFragments,
      ]);
      const persistedRelationships = documents.flatMap((document) => document.relationships ?? []);
      setImportedRelationships(persistedRelationships);
    }).catch((error:unknown) => console.error("Could not load managed library:", error));
  }, []);

  const activeFragments = useMemo(() => [
    ...FRAGMENTS.filter((fragment) => importComplete || !IMPORTED_FRAGMENT_IDS.includes(fragment.id)),
    ...importedFragments,
  ].map((fragment) => ({ ...fragment,...fragmentOverrides[fragment.id] })),[importComplete,fragmentOverrides,importedFragments]);
  const activeFragmentById = (id:string) => activeFragments.find((fragment) => fragment.id === id) ?? ({ ...fragmentById(id),...fragmentOverrides[id] });
  const allRelationships = useMemo(() => importedRelationships.length ? [...RELATIONSHIPS,...importedRelationships] : RELATIONSHIPS,[importedRelationships]);
  const selectedFragmentId = selectedId.startsWith("source:") ? null : selectedId;
  const selectedLibrarySourceId = selectedId.startsWith("source:") ? selectedId.slice("source:".length) : null;
  const selected = activeFragmentById(selectedFragmentId ?? "f02");
  const selectedSource = sources.find((source) => source.id === selectedSourceId)!;
  const selectedRanges = sourceRanges[selectedSourceId] ?? [];
  /** Whether this source's slices differ from the library, and so whether "Save all fragments" has work to do. */
  const editorUnsaved = hasUnsavedRanges(selectedRanges, activeFragments) || unsavedEditSourceIds.has(selectedSourceId);
  const markSourceEdited = (sourceId:string) => setUnsavedEditSourceIds((current) => current.has(sourceId) ? current : new Set([...current,sourceId]));
  const clearSourceEdited = (sourceId:string) => setUnsavedEditSourceIds((current) => { if (!current.has(sourceId)) return current; const next=new Set(current); next.delete(sourceId); return next; });

  const clearPreviewListeners = () => {
    previewCleanupRef.current?.();
    previewCleanupRef.current = null;
  };

  const stopAllAudio = () => {
    previewSessionRef.current += 1;
    pendingSeekRef.current = null;
    clearPreviewListeners();
    if (previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; }
    previewScopeRef.current = null;
    setPreviewingId(null);
    setPreviewProgress(0);
  };

  const fragmentAudioFor = (fragmentId: string) => activeFragments.find((fragment) => fragment.id === fragmentId)?.audio;

  const applyPreviewPosition = (audio: HTMLAudioElement, scope: PreviewScope, ratio: number) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    if (applyPreviewTime(audio, scope, clamped)) {
      setPreviewProgress(clamped);
      pendingSeekRef.current = null;
      return true;
    }
    pendingSeekRef.current = clamped;
    setPreviewProgress(clamped);
    return false;
  };

  const bindPreviewAudio = (audio: HTMLAudioElement, scope: PreviewScope, sessionId: number) => {
    clearPreviewListeners();
    previewScopeRef.current = scope;

    let rafId = 0;
    const updateProgress = () => {
      if (previewSessionRef.current !== sessionId || previewAudio.current !== audio) return;
      if (scope.clip && audio.currentTime >= scope.clip.end - 0.01) {
        if (audio.loop) {
          audio.currentTime = scope.clip.start;
        } else {
          audio.pause();
          setPreviewProgress(1);
          return;
        }
      }
      setPreviewProgress(progressForAudio(scope, audio.currentTime, audio.duration));
    };

    const tick = () => {
      updateProgress();
      if (previewSessionRef.current !== sessionId || previewAudio.current !== audio || audio.paused) return;
      rafId = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    };
    const onPause = () => cancelAnimationFrame(rafId);
    const onTimeUpdate = () => updateProgress();

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    previewCleanupRef.current = () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      cancelAnimationFrame(rafId);
    };

    if (!audio.paused) onPlay();
    else updateProgress();
  };

  const startPreviewScope = (scope: PreviewScope, startRatio = 0) => {
    stopAllAudio();
    const sessionId = previewSessionRef.current;
    const audio = new Audio(resolveAudioUrl(scope.url));
    previewAudio.current = audio;
    audio.loop = !scope.clip;
    audio.volume = 0.72;
    setPreviewingId(scope.id);
    pendingSeekRef.current = startRatio > 0 ? startRatio : null;

    const syncPosition = () => {
      if (previewSessionRef.current !== sessionId || previewAudio.current !== audio) return;
      applyPreviewPosition(audio, scope, pendingSeekRef.current ?? startRatio);
      bindPreviewAudio(audio, scope, sessionId);
    };

    if (audio.readyState >= 1) syncPosition();
    else {
      audio.addEventListener("loadedmetadata", syncPosition, { once: true });
      audio.addEventListener("canplay", syncPosition, { once: true });
    }

    // play() must stay in the user-gesture stack — do not wait for metadata first.
    playMediaElement(audio, () => notify("Playback needs one more click in this browser."));
  };

  const seekPreview = (ratio: number) => {
    const audio = previewAudio.current;
    const scope = previewScopeRef.current;
    if (!audio || !scope) return;
    applyPreviewPosition(audio, scope, ratio);
  };

  const navigate = (next:View) => { stopAllAudio();returnStack.current=[];setFilterOpen(false);setInfoFragmentId(null);setConnectionsOpen(false);setAdvancedOpen(false);setSourceEditorOpen(false);setSourceEditorModal(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCombineCandidates(null);setExportRelationship(null);setDuplicateGroup(null);setImportOpen(false);if (next !== "map") { setMapSelectedId(null);setFractureSelectedId(null); }setView(next); };

  /**
   * Both modes hang off one tab, but their selections are not interchangeable: the
   * graph holds a fragment id and the shatter map a `PreviewScope` id. Carrying one
   * across would leave a card for something the new mode cannot show.
   */
  const switchMapMode = (next:MapMode) => {
    if (next === mapMode) return;
    stopAllAudio();
    setMapSelectedId(null);
    setFractureSelectedId(null);
    setMapMode(next);
  };
  const notify = (message:string) => { setToast(message); window.setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    armBrowserAudioUnlock();
  }, []);

  useEffect(() => {
    const handler = (event:KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("library"); window.setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.key === "Escape") { if (filterOpenRef.current) { setFilterOpen(false); return; } setDuplicateGroup(null);setMapSelectedId(null);setFractureSelectedId(null);stopAllAudio(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // Keyboard routing deliberately captures the opening-state navigation helper once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopAllAudio(), []);

  useEffect(() => {
    if (!resizingConnections) return;
    const resize = (event:PointerEvent) => setConnectionsWidth(Math.max(420, Math.min(760, window.innerWidth - event.clientX)));
    const finish = () => setResizingConnections(false);
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", finish, { once:true });
    return () => { window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", finish); };
  }, [resizingConnections]);

  // Returns every eligible match, ranked. There used to be a limit of 6 here,
  // which silently hid matches that had passed the tolerance filters — the count
  // on the card and the rows in the panel disagreed.
  const rankedConnectionsFor = (sourceId:string):ScoredRelationship[] => {
    const sourceFragment=activeFragmentById(sourceId);
    const seen=new Set<string>();
    return allRelationships.filter((relationship) => relationship.source === sourceId || relationship.target === sourceId)
      .map((relationship) => ({
        ...relationship,
        score:scoreRelationship(relationship,weights,context,rangeMode),
        otherId:otherIdFor(relationship,sourceId),
      }))
      .filter((relationship) => {
        const target=activeFragments.find((fragment) => fragment.id === relationship.otherId);
        if (!target || seen.has(target.id) || archived.has(target.id)) return false;
        if (sourceFragment.duplicateGroup && target.duplicateGroup === sourceFragment.duplicateGroup) return false;
        const isManual=manualRelationshipIds.has(relationship.id);
        const isLibraryAffinity=isLibraryRelationship(relationship);
        if (!isManual && !isLibraryAffinity) {
          if (rangeMode === "reasonable" && (relationship.experimental || relationship.transformationCost > .12)) return false;
          const transformedBpm=target.bpm + (relationship.transform?.bpm ?? 0);
          if (Math.abs(transformedBpm - sourceFragment.bpm) / Math.max(1,sourceFragment.bpm) * 100 > tolerances.tempoWindow) return false;
          const pitchFloor=tolerances.keyFlexibility === "exact" ? .96 : tolerances.keyFlexibility === "related" ? .78 : .62;
          // An unmeasured pitch relationship cannot fail a pitch filter. Treating
          // null as 0 would silently hide every match whose key was not measurable.
          if (relationship.metrics.pitch !== null && relationship.metrics.pitch < pitchFloor) return false;
          const barDelta=Math.abs(target.bars - sourceFragment.bars);
          if (tolerances.lengthTolerance === "same" && barDelta !== 0) return false;
          if (tolerances.lengthTolerance === "one" && barDelta > 1) return false;
          if (!tolerances.allowRepetition && (relationship.transform?.repeat ?? 1) > 1) return false;
        }
        seen.add(target.id);return true;
      })
      .sort((a,b) => b.score - a.score);
  };

  const linkSummaryFor = (fragmentId:string) => {
    const eligible=rankedConnectionsFor(fragmentId);
    return { total:eligible.length,manual:eligible.filter((relationship) => manualRelationshipIds.has(relationship.id)).length };
  };

  const filterableFragments=useMemo(() => activeFragments.filter((fragment) => !archived.has(fragment.id)),[activeFragments,archived]);

  // Archived *and* duplicate-excluded. `filterableFragments` drops only the first,
  // and a fragment the user excluded from its duplicate group should not reappear
  // on the Fracture map as its own point.
  const fractureFragments=useMemo(
    () => activeFragments.filter((fragment) => !archived.has(fragment.id) && !duplicateExclusions.has(fragment.id)),
    [activeFragments,archived,duplicateExclusions],
  );

  const updateSourceSensitivity = (value:number) => {
    setSources((current) => current.map((source) => source.id === selectedSourceId ? { ...source,sensitivity:value } : source));
  };

  const applyDetectedRanges = (
    segments: { start: number; end: number; label: string }[],
  ) => {
    if (!Array.isArray(segments)) {
      notify("Unexpected response from the fragmentation backend.");
      return;
    }

    const detectedRanges: EditableRange[] = segments
      // drop silence — remove this filter if you want silence kept as its own fragment
      .filter((segment) => segment.label !== "silence")
      .map((segment, index) => ({
        id: `${selectedSource.id}-detected-${Date.now()}-${index}`,
        start: Math.round(segment.start * 100) / 100, // rounded to 2 decimals
        end: Math.round(segment.end * 100) / 100,
        color: RANGE_COLORS[index % RANGE_COLORS.length],
      }));

    setSourceRanges((current) => ({ ...current, [selectedSource.id]: detectedRanges }));
    notify(
      `Detected ${detectedRanges.length} fragment${detectedRanges.length === 1 ? "" : "s"} — click "Save boundaries" to add ${detectedRanges.length === 1 ? "it" : "them"} to the library.`,
    );
  };

  const detectionTimerRef = useRef<number | null>(null);

  const startDetectionTimer = () => {
    const startedAt = Date.now();
    setToast(`Detecting fragments… ${formatSeconds(0)}`);
    detectionTimerRef.current = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setToast(`Detecting fragments… ${formatSeconds(elapsedSeconds)}`);
    }, 1000);
  };

  const stopDetectionTimer = () => {
    if (detectionTimerRef.current !== null) {
      window.clearInterval(detectionTimerRef.current);
      detectionTimerRef.current = null;
    }
  };

  const detectFragments = async () => {
    startDetectionTimer();
    try {
      const segments = await sendSourceForFragmentation(selectedSource);
      if (!segments) return;
      applyDetectedRanges(segments);
    } finally {
      stopDetectionTimer();
      setToast(null);
    }
  };

  const sendSourceForFragmentation = async (source: SourceFile) => {
    try {
      const audioUrl = resolveSourceAudioUrl(source);
      if (!audioUrl) throw new Error("No audio available for this source.");

      const audioResponse = await fetch(audioUrl);
      const blob = await audioResponse.blob();

      const formData = new FormData();
      formData.append("file", blob, source.name);

      const response = await fetch("http://localhost:3001/segment", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(`Detection failed (${response.status})`);
      const result = await response.json();
      notify(`Detected fragments for ${source.name}.`);
      return result;
    } catch (error) {
      console.error("Could not detect fragments:", error);
      notify("Couldn't reach the detection backend.");
    }
  };

  const addManualFragment = () => {
    const index=selectedRanges.length;
    const next={ ...rangeForIndex(selectedSource,index),fragmentId:undefined,id:`${selectedSource.id}-manual-${Date.now()}` };
    markSourceEdited(selectedSource.id);
    setSourceRanges((current) => ({ ...current,[selectedSource.id]:[...(current[selectedSource.id] ?? []),next] }));
    notify(`Fragment ${index + 1} added. Adjust its range above.`);
  };

  const addCombineFragment = () => {
    if (!combineDraftRanges) return;
    const index=combineDraftRanges.length;
    const next={ ...rangeForIndex(selectedSource,index),fragmentId:undefined,id:`${selectedSource.id}-manual-${Date.now()}` };
    setCombineDraftRanges([...combineDraftRanges,next]);
    notify(`Fragment ${index + 1} added. Adjust its ruler above.`);
  };

  const updateCombineSensitivity = (value:number) => {
    setCombineDraftSensitivity(value);
  };

  const connectionAnchorFragmentId = (() => {
    if (selectedFragmentId) return selectedFragmentId;
    if (!selectedLibrarySourceId) return null;
    const source = sources.find((item) => item.id === selectedLibrarySourceId);
    const fromSource = source?.fragmentIds.find(
      (id) => activeFragments.some((fragment) => fragment.id === id) && !archived.has(id),
    );
    if (fromSource) return fromSource;
    return activeFragments.find(
      (fragment) => fragment.sourceId === selectedLibrarySourceId && !archived.has(fragment.id),
    )?.id ?? null;
  })();

  const connections = connectionAnchorFragmentId ? rankedConnectionsFor(connectionAnchorFragmentId) : [];

  const selectedDuplicates = duplicateGroup ? activeFragments.filter((fragment) => fragment.duplicateGroup === duplicateGroup && !duplicateExclusions.has(fragment.id) && !archived.has(fragment.id)) : [];

  const previewSingle = (fragment:Fragment, startRatio = 0) => {
    const scope = buildFragmentPreviewScope(fragment, sourceForId(fragment.sourceId), fragmentAudioFor);
    if (!scope) return;
    if (startRatio === 0 && previewingId === fragment.id && previewAudio.current) {
      stopAllAudio();
      return;
    }
    if (previewingId === fragment.id && previewAudio.current && startRatio > 0) {
      seekPreview(startRatio);
      if (previewAudio.current.paused) {
        playMediaElement(previewAudio.current, () => notify("Playback needs one more click in this browser."));
      }
      return;
    }
    startPreviewScope(scope, startRatio);
  };

  const previewSource = (source: SourceFile, startRatio = 0) => {
    const scope = buildSourcePreviewScope(source, fragmentAudioFor);
    if (!scope) return;
    const previewKey = scope.id;
    if (startRatio === 0 && previewingId === previewKey && previewAudio.current) {
      stopAllAudio();
      return;
    }
    if (previewingId === previewKey && previewAudio.current && startRatio > 0) {
      seekPreview(startRatio);
      if (previewAudio.current.paused) {
        playMediaElement(previewAudio.current, () => notify("Playback needs one more click in this browser."));
      }
      return;
    }
    startPreviewScope(scope, startRatio);
  };

  const saveSourceAnalysis = async (sourceId: string, analysis: SourceAnalysisValues) => {
    const bridge = getFragmentsBridge();
    if (bridge?.capabilities.persist) {
      try {
        // Marked "edited" so a later batch pass will not overwrite the correction.
        // keyStrength is cleared deliberately: a hand-typed key has no measured
        // confidence, and keeping the old number would attribute the machine's
        // certainty to the user's choice.
        await bridge.updateSourceAnalysis(sourceId, {
          ...analysis,
          keyStrength: null,
          provenance: { origin: "edited", extractor: null, at: new Date().toISOString() },
        });
      } catch (error) {
        console.error("Could not persist source analysis:", error);
        notify("Could not save metadata to disk.");
        return;
      }
    }
    setSources((current) => current.map((source) => source.id === sourceId
      ? { ...source, bpm: analysis.bpm, key: analysis.key, scale: analysis.scale }
      : source));
    notify("Source metadata saved.");
  };

  const openSourceInfo = (sourceId: string, modal = false, fragmentId?: string) => {
    stopAllAudio();
    setFilterOpen(false);
    setConnectionsOpen(false);
    setSelectedSourceId(sourceId);
    setInfoFragmentId(fragmentId ?? null);
    setSourcePanelMode("detail");
    setSourceEditorModal(modal);
    setSourceEditorOpen(true);
  };

  const openLibraryInfo = (target: { sourceId: string; fragmentId?: string }) => {
    openSourceInfo(target.sourceId, false, target.fragmentId);
  };

  /**
   * Info from the shatter map, which has to travel to the library to be seen —
   * hence the button there reads "Show in Library" rather than "Info".
   *
   * The detail panel is a side panel, hosted only by the library and sources
   * views; there is no modal form of it, so `openSourceInfo(id, true)` from a map
   * sets the state and displays nothing. `navigate` closes the editor, hence the
   * order here.
   */
  const openFractureInfo = (sourceId: string, fragmentId?: string) => {
    navigate("library");
    openLibraryInfo({ sourceId, fragmentId });
  };

  const toggleLibraryFilter = () => {
    setFilterOpen((open) => {
      const next = !open;
      if (next) {
        setConnectionsOpen(false);
        setSourceEditorOpen(false);
        setSourceEditorModal(false);
        setInfoFragmentId(null);
      }
      return next;
    });
  };

  const closeLibraryFilter = () => setFilterOpen(false);

  const saveFragmentLibraryMeta = (fragmentId: string, meta: FragmentLibraryMeta) => {
    setFragmentOverrides((current) => ({
      ...current,
      [fragmentId]: {
        ...current[fragmentId],
        role: meta.role,
        roles: [meta.role],
        userTags: meta.userTags,
      },
    }));
  };

  const archiveFragment = (id:string) => {
    stopAllAudio(); setArchived((current) => new Set([...current, id]));
    if (id === selectedId) setSelectedId(activeFragments.find((fragment) => fragment.id !== id && !archived.has(fragment.id))?.id ?? "f02");
    notify("Archived from ordinary matching. You can restore it anytime.");
  };
  const restoreFragment = (id:string) => { setArchived((current) => { const next = new Set(current); next.delete(id); return next; }); notify("Fragment restored to matching."); };
  const keepTake = (id:string) => {
    const group = fragmentById(id).duplicateGroup;
    if (!group) return;
    const others = activeFragments.filter((fragment) => fragment.duplicateGroup === group && fragment.id !== id && !duplicateExclusions.has(fragment.id)).map((fragment) => fragment.id);
    setArchived((current) => new Set([...current, ...others])); setSelectedId(id); setDuplicateGroup(null); notify("Kept this take for matching and archived the rest.");
  };
  const pushReturn = (kind:ReturnSnapshot["kind"]) => returnStack.current.push({ kind,view,selectedId,selectedSourceId,connectionsOpen,advancedOpen,scrollY:window.scrollY });
  const restoreReturn = (kind:ReturnSnapshot["kind"]) => {
    const snapshot=returnStack.current.at(-1);
    if (!snapshot || snapshot.kind !== kind) return false;
    returnStack.current.pop();stopAllAudio();setView(snapshot.view);setSelectedId(snapshot.selectedId);setSelectedSourceId(snapshot.selectedSourceId);setConnectionsOpen(snapshot.connectionsOpen);setAdvancedOpen(snapshot.advancedOpen);setSourceEditorOpen(false);window.setTimeout(() => window.scrollTo({ top:snapshot.scrollY }),0);return true;
  };
  const openFragment = (id:string) => { stopAllAudio(); setSelectedId(id); setFilterOpen(false); setConnectionsOpen(true); setAdvancedOpen(false); setView("library"); };
  const highlightLibraryFragment = (id: string) => { setSelectedId(id); };
  const highlightLibrarySource = (source: SourceFile) => { setSelectedId(`source:${source.id}`); };
  /**
   * Drops a source and its fragments out of the session. Says nothing about disk —
   * both removal paths need exactly this cleanup, and they differ only in what they
   * do to the folder and what they tell the user.
   */
  const forgetSource = (sourceId: string) => {
    stopAllAudio();
    const removedFragmentIds = activeFragments
      .filter((fragment) => fragment.sourceId === sourceId)
      .map((fragment) => fragment.id);
    const remainingSources = sources.filter((item) => item.id !== sourceId);

    setArchived((current) => new Set([...current, ...removedFragmentIds]));
    setImportedFragments((current) => current.filter((fragment) => fragment.sourceId !== sourceId));
    setSources(remainingSources);
    setSourceRanges((current) => {
      const next = { ...current };
      delete next[sourceId];
      return next;
    });

    if (selectedSourceId === sourceId) {
      setSelectedSourceId(remainingSources[0]?.id ?? OPENING_SOURCE_ID);
      setSourceEditorOpen(false);
      setSourceEditorModal(false);
    }

    if (selectedFragmentId && removedFragmentIds.includes(selectedFragmentId)) {
      setConnectionsOpen(false);
      const nextFragment = activeFragments.find(
        (fragment) =>
          fragment.sourceId !== sourceId
          && !archived.has(fragment.id)
          && !removedFragmentIds.includes(fragment.id),
      );
      setSelectedId(nextFragment?.id ?? "f02");
    }
  };

  /** Soft delete: the folder stays, so re-importing the same file brings it back. */
  const removeSource = (sourceId: string) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;

    const bridge = getFragmentsBridge();
    if (bridge?.capabilities.persist && source.imported) {
      void bridge.archiveSource(sourceId).catch((error: unknown) => console.warn("Could not archive source:", error));
    }

    forgetSource(sourceId);
    notify(`Removed ${source.name} from your library. Import a file with the same name to restore your slices.`);
  };

  /**
   * Hard delete: the folder goes.
   *
   * Unlike archiving, this waits for the disk before touching the session. A failed
   * archive is harmless — the source is out of the library either way and the file
   * is still there — but a failed delete that had already removed the row would
   * leave a folder on disk with no way back to it in the app.
   */
  const deleteSourceFromDisk = async (sourceId: string) => {
    const source = sources.find((item) => item.id === sourceId);
    if (!source) return;

    const bridge = getFragmentsBridge();
    if (!bridge?.capabilities.persist) {
      notify("Deleting files needs the desktop app. The web preview can only read your library.");
      return;
    }

    try {
      await bridge.deleteSource(sourceId);
    } catch (error) {
      console.warn("Could not delete source:", error);
      notify(`Could not delete ${source.name}. Its folder is still on disk.`);
      return;
    }

    forgetSource(sourceId);
    notify(`Deleted ${source.name} and its slices from disk.`);
  };
  const editSourceForLibrarySource = (sourceId: string) => {
    pushReturn("source-edit");
    stopAllAudio();
    setSelectedSourceId(sourceId);
    setSourcePanelMode("fragmentation");
    setSourceEditorOpen(true);
    setConnectionsOpen(false);
    setAdvancedOpen(false);
    setView("source");
  };
  const sourceForId = (sourceId: string) => sources.find((source) => source.id === sourceId);
  const closeConnections = () => { stopAllAudio();setConnectionsOpen(false);setAdvancedOpen(false); };
  const finishCloseSourceEditor = () => {
    if (restoreReturn("source-edit")) return;
    stopAllAudio();setSourceEditorOpen(false);setSourceEditorModal(false);setInfoFragmentId(null);
  };
  const closeSourceEditor = () => {
    if (correctionRelationship) { setSourceEditorOpen(false);setSourceEditorModal(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);return; }
    // "Save all fragments" is the only thing that writes, so closing with edits in hand has
    // to ask. The question is only worth asking about edits made here: a source that was
    // already out of sync with disk when it opened has nothing of the user's to lose.
    if (sourcePanelMode === "fragmentation" && unsavedEditSourceIds.has(selectedSourceId)) { setCloseConfirmOpen(true);return; }
    finishCloseSourceEditor();
  };
  const openSourceEditor = (sourceId: string, mode: SourcePanelMode, modal: boolean) => {
    stopAllAudio();
    setSelectedSourceId(sourceId);
    setSourcePanelMode(mode);
    setSourceEditorModal(modal);
    setSourceEditorOpen(true);
  };
  const editSourceForFragment = (id:string) => { const fragment=activeFragmentById(id);pushReturn("source-edit");stopAllAudio();setSelectedSourceId(fragment.sourceId);setSourcePanelMode("fragmentation");setSourceEditorOpen(true);setConnectionsOpen(false);setAdvancedOpen(false);setView("source"); };
  const handleImportSource = (imported: ImportedSource) => {
    const id = imported.persistedId ?? `source-import-${Date.now()}`;

    if (imported.restored && imported.persistedDocument) {
      const document: SourceRecord = {
        ...imported.persistedDocument,
        audioUrl: imported.persistedAudioUrl ?? imported.persistedDocument.audioUrl,
      };
      const source = sourceFileFromDocument(document, imported.persistedAudioUrl);
      const ranges = rangesFromDocument(document);
      const fragments = document.fragments.map((fragmentDoc, index) =>
        fragmentFromDocument(fragmentDoc, index, source));

      retainCachedAudio(imported.cacheKey);
      bindSourceAudio(source.id, imported.cacheKey);
      const cached = getCachedAudio(`source:${source.id}`);
      if (cached && document.analysis) {
        updateCachedAnalysis(cached.cacheKey, {
          ...cached.analysis,
          bpm: document.analysis.bpm ?? cached.analysis.bpm,
          key: document.analysis.key ?? cached.analysis.key,
          scale: document.analysis.scale ?? cached.analysis.scale,
          keyStrength: document.analysis.keyStrength ?? cached.analysis.keyStrength,
        });
      }

      setSources((current) => [...current.filter((item) => item.id !== source.id), source]);
      setSourceRanges((current) => ({ ...current, [source.id]: ranges }));
      setImportedFragments((current) => [
        ...current.filter((fragment) => fragment.sourceId !== source.id),
        ...fragments,
      ]);
      setSavedFragmentIds((current) => new Set([...current, ...fragments.map((fragment: Fragment) => fragment.id)]));
      setArchived((current) => {
        const next = new Set(current);
        for (const fragment of fragments) next.delete(fragment.id);
        return next;
      });
      setFragmentOverrides((current) => {
        const next = { ...current };
        for (const fragment of fragments) delete next[fragment.id];
        return next;
      });
      setSelectedSourceId(source.id);
      setSourcePanelMode("fragmentation");
      setSourceEditorModal(true);
      setSourceEditorOpen(true);
      setImportComplete(true);
      setView("source");
      notify(`Restored ${source.name} with your saved slices.`);
      return;
    }

    retainCachedAudio(imported.cacheKey);
    bindSourceAudio(id, imported.cacheKey);
    const newSource: SourceFile = {
      id,
      name: imported.name,
      date: new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
      duration: imported.duration,
      format: imported.format,
      device: "Local upload",
      fragmentIds: [],
      waveform: imported.peaks,
      sensitivity: DEFAULT_SENSITIVITY,
      start: 0,
      end: imported.duration,
      sourceTypes: imported.sourceTypes,
      imported: true,
      audioUrl: imported.persistedAudioUrl ?? imported.objectUrl,
      audioCacheKey: imported.cacheKey,
      bpm: imported.analysis.bpm,
      key: imported.analysis.key,
      scale: imported.analysis.scale,
    };
    setSources((current) => [...current, newSource]);
    // Pre-slice the same way an existing source's ranges are seeded, so landing here
    // right after import looks and behaves exactly like opening "Fragments" on any
    // other source instead of showing an empty editor.
    const initialRanges = Array.from(
      { length: fragmentCountForSensitivity(newSource.sensitivity) },
      (_, index) => rangeForIndex(newSource, index),
    );
    setSourceRanges((current) => ({ ...current, [id]: initialRanges }));
    setSelectedSourceId(id);
    setSourcePanelMode("fragmentation");
    setSourceEditorModal(true);
    setSourceEditorOpen(true);
    setImportComplete(true);
    setView("source");
    notify(`Imported ${imported.name}.`);
  };
  const openCombine = (relationship:ScoredRelationship) => { stopAllAudio();returnScroll.current=window.scrollY;setRelationshipStatuses((current) => ({ ...current,[relationship.id]:current[relationship.id] ?? "auditioned" }));setCombineCandidates([relationship,...connections.filter((item) => item.id !== relationship.id)]);window.scrollTo({ top:0 }); };
  const openCombineForAnchor = (fragmentId:string) => {
    const anchorConnections=rankedConnectionsFor(fragmentId);
    const top=anchorConnections[0];
    if (!top) return;
    stopAllAudio();
    setSelectedId(fragmentId);
    setFilterOpen(false);
    setConnectionsOpen(false);
    setAdvancedOpen(false);
    setView("library");
    returnScroll.current=window.scrollY;
    setRelationshipStatuses((current) => ({ ...current,[top.id]:current[top.id] ?? "auditioned" }));
    setCombineCandidates([top,...anchorConnections.filter((item) => item.id !== top.id)]);
    window.scrollTo({ top:0 });
  };
  const openMatchesForFragment = (fragmentId:string) => openCombineForAnchor(fragmentId);
  const openMatchesForSource = (source:SourceFile) => {
    let anchorId:string | null=null;
    let bestScore=-1;
    for (const id of source.fragmentIds) {
      if (!activeFragments.some((fragment) => fragment.id === id) || archived.has(id)) continue;
      const top=rankedConnectionsFor(id)[0];
      if (!top || top.score <= bestScore) continue;
      bestScore=top.score;
      anchorId=id;
    }
    if (anchorId) openCombineForAnchor(anchorId);
  };
  const closeCombine = () => { stopAllAudio();setSourceEditorOpen(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);setExportRelationship(null);setCombineCandidates(null);window.setTimeout(() => window.scrollTo({ top:returnScroll.current }),0); };
  const markRelationship = (relationship:CombineCandidate,status:RelationshipStatus) => setRelationshipStatuses((current) => ({ ...current,[relationship.id]:status }));
  const rejectRelationship = (relationship:CombineCandidate) => { const next=(combineCandidates ?? []).filter((item) => item.id !== relationship.id);markRelationship(relationship,"rejected");setCombineCandidates(next.length ? next : null);if (!next.length) window.setTimeout(() => window.scrollTo({ top:returnScroll.current }),0);notify(next.length ? "Candidate rejected for this session." : "Last candidate rejected. Returned to the search."); };
  const beginCombineSourceEdit = (relationship:CombineCandidate) => {
    const candidate=activeFragmentById(relationship.otherId);const source=sources.find((item) => item.id === candidate.sourceId) ?? SOURCE_FILES.find((item) => item.id === candidate.sourceId)!;
    stopAllAudio();setSelectedSourceId(source.id);setCombineDraftRanges((sourceRanges[source.id] ?? []).map((range) => ({ ...range })));setCombineDraftSensitivity(source.sensitivity);setCorrectionOriginal({ duration:candidate.duration,key:candidate.key,bpm:candidate.bpm,bars:candidate.bars,beats:candidate.beats,confidence:candidate.confidence,analysisRevision:candidate.analysisRevision });setCorrectionPhase("edit");setCorrectionRelationship(relationship);setSourcePanelMode("fragmentation");setSourceEditorOpen(true);
  };
  const persistFragmentsForSource = (sourceId:string,fragments:Fragment[]) => {
    const bridge=getFragmentsBridge();
    if (!bridge?.capabilities.persist) return;
    void bridge.updateFragments(sourceId,fragments.map(fragmentToDocument)).catch((error:unknown) => console.warn("Could not persist fragments:",error));
  };

  /** Turns a not-yet-real "Add fragment" range into a permanent Fragment with a stable id. */
  const promoteRangeToFragment = (range:EditableRange,index:number,source:SourceFile):{ range:EditableRange;fragment:Fragment } => {
    const cached = source.audioCacheKey ? getCachedAudio(`source:${source.id}`) : undefined;
    const peaks = cached?.peaks ?? source.waveform;
    const bpm = resolvedSourceAnalysis(source, cached).bpm ?? null;
    const fragmentId=`${source.id}-fragment-${Date.now()}-${index}`;
    const fragment=draftFragmentForRange({ ...range,id:fragmentId },index,source,peaks,bpm);
    return { range:{ ...range,fragmentId },fragment };
  };

  const saveSourceBoundaries = () => {
    // Ranges carry a `fragmentId` once they reference a real Fragment. Ranges added
    // via "Add fragment" don't have one yet - promote those into real fragments here
    // so slicing a source actually produces Library entries instead of being dropped.
    const patches:Record<string,Partial<Fragment>>={};
    const created:Fragment[]=[];
    const nextRanges = selectedRanges.map((range,index) => {
      if (range.fragmentId) {
        const fragment=activeFragmentById(range.fragmentId);
        patches[range.fragmentId]={ start:range.start,end:range.end,duration:formatSeconds(range.end-range.start),analysisRevision:fragment.analysisRevision + 1 };
        return range;
      }
      const { range:nextRange,fragment } = promoteRangeToFragment(range,index,selectedSource);
      created.push(fragment);
      return nextRange;
    });

    if (created.length) setImportedFragments((current) => [...current,...created]);
    if (Object.keys(patches).length) setFragmentOverrides((current) => ({ ...current,...patches }));
    setSourceRanges((current) => ({ ...current,[selectedSource.id]:nextRanges }));
    if (created.length) {
      setSources((current) => current.map((source) => source.id === selectedSource.id
        ? { ...source,fragmentIds:Array.from(new Set([...source.fragmentIds,...created.map((fragment) => fragment.id)])) }
        : source));
    }
    const survivingFragments = activeFragments
      .filter((fragment) => fragment.sourceId === selectedSource.id)
      .map((fragment) => ({ ...fragment,...patches[fragment.id] }));
    const written=[...survivingFragments,...created];
    persistFragmentsForSource(selectedSource.id,written);
    // Everything this source has is now on disk, so nothing about it is pending.
    setSavedFragmentIds((current) => new Set([...current,...written.map((fragment) => fragment.id)]));
    clearSourceEdited(selectedSource.id);

    notify(created.length
      ? `${written.length} fragment${written.length > 1 ? "s" : ""} saved; ${created.length} new in the library.`
      : `${written.length} fragment${written.length > 1 ? "s" : ""} saved.`);
  };

  /**
   * Puts a source back to what the library holds. Disk is authoritative, so it is re-read
   * rather than un-applied: there is no edit history to keep and nothing to drift. A source
   * with no document — the prototype dataset, or a host that cannot read — has no disk state
   * to return to, so its deterministic seed ranges are rebuilt instead.
   *
   * Only the fields the workbench writes are dropped. Role and tags come from the detail
   * panel, which is not what the user is discarding.
   */
  const discardSourceEdits = async (source:SourceFile) => {
    clearSourceEdited(source.id);
    const bridge=getFragmentsBridge();
    const documents=bridge
      ? await bridge.listSources().catch((error:unknown) => { console.warn("Could not re-read the library:",error);return [] as SourceRecord[]; })
      : [];
    const document=documents.find((item) => item.id === source.id);
    if (!document) {
      setSourceRanges((current) => ({ ...current,[source.id]:Array.from({ length:fragmentCountForSensitivity(source.sensitivity) },(_,index) => rangeForIndex(source,index)) }));
      return;
    }
    const restored=document.fragments.map((fragmentDoc,index) => fragmentFromDocument(fragmentDoc,index,source));
    setSourceRanges((current) => ({ ...current,[source.id]:rangesFromDocument(document) }));
    setImportedFragments((current) => [...current.filter((fragment) => fragment.sourceId !== source.id),...restored]);
    setSources((current) => current.map((item) => item.id === source.id ? { ...item,fragmentIds:restored.map((fragment) => fragment.id) } : item));
    setSavedFragmentIds((current) => new Set([...current,...restored.map((fragment) => fragment.id)]));
    setFragmentOverrides((current) => {
      const next={ ...current };
      for (const fragment of restored) {
        const override=next[fragment.id];
        if (!override) continue;
        const kept={ ...override };
        for (const key of WORKBENCH_OVERRIDE_KEYS) delete kept[key];
        if (Object.keys(kept).length) next[fragment.id]=kept; else delete next[fragment.id];
      }
      return next;
    });
  };

  /**
   * Commits a range's promotion into a real fragment in memory only. Nothing reaches disk
   * here: "Save all fragments" is the one commit point, so a rename must leave the source
   * reported as unsaved rather than quietly writing a slice the user has not approved.
   */
  const commitPromotedRange = (nextRange:EditableRange,fragment:Fragment,source:SourceFile) => {
    setImportedFragments((current) => [...current,fragment]);
    setSourceRanges((current) => ({ ...current,[source.id]:(current[source.id] ?? []).map((item) => item.id === nextRange.id ? nextRange : item) }));
    setSources((current) => current.map((item) => item.id === source.id
      ? { ...item,fragmentIds:Array.from(new Set([...item.fragmentIds,fragment.id])) }
      : item));
    markSourceEdited(source.id);
  };

  /** Finds the range backing a Library card's fragment id, whether it's already real (`fragmentId`) or still a draft (`range.id`). */
  const rangeForFragmentCardId = (id:string) => selectedRanges.find((range) => range.fragmentId === id) ?? selectedRanges.find((range) => range.id === id);

  /** Renames a fragment in place (via the Library card's editable title). Promotes drafts into real fragments first. */
  const renameFragmentOrRange = (id:string,name:string) => {
    const range=rangeForFragmentCardId(id);
    if (!range) return;
    if (range.fragmentId) {
      renameFragment(activeFragmentById(range.fragmentId),name);
      return;
    }
    const index=selectedRanges.indexOf(range);
    const { range:nextRange,fragment } = promoteRangeToFragment(range,index,selectedSource);
    fragment.name=name;
    commitPromotedRange(nextRange,fragment,selectedSource);
  };

  /** Renames a fragment in place (via the Library card's editable title). Marks it unsaved until "Save" is clicked again. */
  const renameFragment = (fragment:Fragment,name:string) => {
    setFragmentOverrides((current) => ({ ...current,[fragment.id]:{ ...current[fragment.id],name } }));
    setSavedFragmentIds((current) => { if (!current.has(fragment.id)) return current; const next=new Set(current); next.delete(fragment.id); return next; });
    markSourceEdited(fragment.sourceId);
  };

  /** Persists a single fragment's current state (name, bounds, etc.) to its source.json and flips its card to "Saved". */
  const saveFragment = (fragment:Fragment) => {
    setSavedFragmentIds((current) => new Set([...current,fragment.id]));
    clearSourceEdited(fragment.sourceId);
    const siblings = activeFragments.filter((item) => item.sourceId === fragment.sourceId);
    persistFragmentsForSource(fragment.sourceId,siblings);
    notify(`${fragment.name} saved.`);
  };

  /** Removes a fragment slice from the workbench and library. */
  const deleteFragmentOrRange = (id: string) => {
    const range = rangeForFragmentCardId(id);
    if (!range) return;

    const nextRanges = selectedRanges.filter((item) => item.id !== range.id);
    setSourceRanges((current) => ({ ...current, [selectedSource.id]: nextRanges }));

    if (previewingId === range.fragmentId || previewingId === range.id) {
      stopAllAudio();
    }

    if (!range.fragmentId) {
      notify("Fragment removed.");
      return;
    }

    const fragmentId = range.fragmentId;
    setImportedFragments((current) => current.filter((fragment) => fragment.id !== fragmentId));
    setFragmentOverrides((current) => {
      const next = { ...current };
      delete next[fragmentId];
      return next;
    });
    setSavedFragmentIds((current) => {
      const next = new Set(current);
      next.delete(fragmentId);
      return next;
    });
    setArchived((current) => new Set([...current, fragmentId]));
    setSources((current) => current.map((source) => source.id === selectedSource.id
      ? { ...source, fragmentIds: source.fragmentIds.filter((fid) => fid !== fragmentId) }
      : source));

    const surviving = activeFragments.filter(
      (fragment) => fragment.sourceId === selectedSource.id && fragment.id !== fragmentId,
    );
    persistFragmentsForSource(selectedSource.id, surviving);
    notify("Fragment removed.");
  };
  const saveCombineSourceBoundaries = () => {
    if (!correctionRelationship || !combineDraftRanges) return;
    const candidate=activeFragmentById(correctionRelationship.otherId);const patches:Record<string,Partial<Fragment>>={};
    combineDraftRanges.forEach((range) => { const id=range.fragmentId;if (!id) return;const fragment=activeFragmentById(id);patches[id]={ start:range.start,end:range.end,duration:formatSeconds(range.end-range.start),analysisRevision:fragment.analysisRevision + 1 }; });
    const candidateRange=combineDraftRanges.find((range) => range.fragmentId === candidate.id);
    patches[candidate.id]={ ...patches[candidate.id],start:candidateRange?.start ?? candidate.start,end:candidateRange?.end ?? candidate.end,duration:formatSeconds((candidateRange?.end ?? candidate.end) - (candidateRange?.start ?? candidate.start)),key:"C minor",bpm:90,bars:3,beats:17,confidence:.93,analysisRevision:candidate.analysisRevision + 1 };
    setSourceRanges((current) => ({ ...current,[selectedSource.id]:combineDraftRanges.map((range) => ({ ...range })) }));setSources((current) => current.map((source) => source.id === selectedSource.id ? { ...source,sensitivity:combineDraftSensitivity ?? source.sensitivity } : source));setFragmentOverrides((current) => ({ ...current,...patches }));setCombineCandidates((current) => current?.map((item) => item.id === correctionRelationship.id ? { ...item,score:76,transform:item.transform ? { ...item.transform,bpm:2,labels:["−3 st","+2 BPM"] } : item.transform } : item) ?? null);setCorrectionPhase("recompute");window.setTimeout(() => setCorrectionPhase("prompt"),900);
  };
  const keepCorrectionLink = () => { if (!correctionRelationship) return;setManualRelationshipIds((current) => new Set([...current,correctionRelationship.id]));markRelationship(correctionRelationship,"manual");setSourceEditorOpen(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCombineDraftRanges(null);setCombineDraftSensitivity(null);notify("Manual relationship preserved in this comparison."); };
  const rejectCorrectionLink = () => { if (!correctionRelationship) return;const relationship=correctionRelationship;setSourceEditorOpen(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCombineDraftRanges(null);setCombineDraftSensitivity(null);rejectRelationship(relationship); };
  const mapFragments=activeFragments;
  const mapPoints=useMemo(() => new Map(activeFragments.map((fragment) => [fragment.id,musicalMapPoint(fragment)])),[activeFragments]);
  const mapTakeEdges=useMemo(() => { const firstByGroup=new Map<string,string>();const edges:{ source:string;target:string }[]=[];activeFragments.forEach((fragment) => { if (!fragment.duplicateGroup || archived.has(fragment.id) || duplicateExclusions.has(fragment.id)) return;const first=firstByGroup.get(fragment.duplicateGroup);if (first) edges.push({ source:first,target:fragment.id });else firstByGroup.set(fragment.duplicateGroup,fragment.id); });return edges; },[activeFragments,archived,duplicateExclusions]);
  const mapRelationshipScores=new Map<string,number>();
  mapFragments.filter((fragment) => !archived.has(fragment.id)).forEach((fragment) => rankedConnectionsFor(fragment.id).forEach((relationship) => mapRelationshipScores.set(relationship.id,Math.max(mapRelationshipScores.get(relationship.id) ?? 0,relationship.score))));
  const mapRelationships=allRelationships.filter((relationship) => mapRelationshipScores.has(relationship.id) && !archived.has(relationship.source) && !archived.has(relationship.target) && relationshipStatuses[relationship.id] !== "rejected");
  const mapDegreeFor=(id:string) => mapRelationships.filter((relationship) => relationship.source === id || relationship.target === id);
  const mapFragment=mapSelectedId && !archived.has(mapSelectedId) ? activeFragments.find((fragment) => fragment.id === mapSelectedId) ?? null : null;
  const focusMapInspector=() => window.setTimeout(() => mapInspectorCloseRef.current?.focus({ preventScroll:true }),0);
  /**
   * Names the mode you would switch to, rather than the one you are in, so the
   * label is the action. Rendered inside whichever view is showing, because the
   * Map page's titlebar belongs to the view rather than to the page.
   */
  const mapModeSwitch=(
    <button
      type="button"
      className="map-mode-switch"
      onClick={() => switchMapMode(mapMode === "graph" ? "shatter" : "graph")}
    >
      {mapMode === "graph" ? "Show as shatter map" : "Show as graph"}
    </button>
  );
  // A shatter map selection is a PreviewScope id, so it is either `source:<id>`
  // or a fragment id — which is exactly what lets one selection mean either.
  const fractureSourceSelected=fractureSelectedId?.startsWith("source:") ?? false;
  const fractureSource=fractureSourceSelected
    ? sources.find((source) => source.id === fractureSelectedId!.slice("source:".length))
    : undefined;
  const fractureFragment=fractureSelectedId && !fractureSourceSelected
    ? activeFragments.find((fragment) => fragment.id === fractureSelectedId)
    : undefined;

  const closeMapInspector=() => { const id=mapSelectedId;stopAllAudio();setMapSelectedId(null);if (id) window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-map-node="${id}"]`)?.focus({ preventScroll:true }),0); };
  const editorRanges=correctionRelationship ? (combineDraftRanges ?? []) : selectedRanges;
  const editorSensitivity=correctionRelationship ? (combineDraftSensitivity ?? selectedSource.sensitivity) : selectedSource.sensitivity;
  const correctedRange=correctionRelationship ? editorRanges.find((range) => range.fragmentId === correctionRelationship.otherId) : null;
  const correctionFooter=correctionRelationship && correctionPhase === "recompute" ? <div className="recompute workbench-result"><i/><strong>Recomputing metadata and active match…</strong><span>Revision {(correctionOriginal?.analysisRevision ?? 1) + 1}</span></div> : correctionRelationship && correctionPhase === "prompt" && correctionOriginal ? <div className="correction-result workbench-result"><div className="metadata-diff"><span>Field</span><span>Before</span><span>After</span>{[["Duration",correctionOriginal.duration,formatSeconds((correctedRange?.end ?? 0) - (correctedRange?.start ?? 0))],["Key",correctionOriginal.key,"C minor"],["BPM",correctionOriginal.bpm,"90"],["Bars",correctionOriginal.bars,"3"],["Beats",correctionOriginal.beats,"17"],["Confidence",`${Math.round(correctionOriginal.confidence * 100)}%`,`93%`],["Match",`${correctionRelationship.score}%`,`76%`]].map((row) => row.map((cell,index) => <span className={index === 2 ? "changed" : ""} key={`${row[0]}-${index}`}>{cell}</span>))}</div><div className="link-prompt"><span className="relationship-badge manual">criteria changed</span><h3>This fragment no longer matches the original search. Keep it linked to this comparison?</h3><p>The boundary correction is saved either way. A manual link preserves your musical judgment.</p><div><button onClick={rejectCorrectionLink}>Reject and show next</button><button className="primary-button" onClick={keepCorrectionLink}>Yes, keep linked</button></div></div></div> : null;
  const fragmentationPanel=sourceEditorOpen ? <FragmentationWorkbench source={selectedSource} ranges={editorRanges} fragments={activeFragments} sensitivity={editorSensitivity} focusedFragmentId={correctionRelationship?.otherId} onRangesChange={(ranges) => { if (correctionRelationship) { setCombineDraftRanges(ranges);return; } markSourceEdited(selectedSource.id);setSourceRanges((current) => ({ ...current,[selectedSource.id]:ranges })); }} onSensitivityChange={correctionRelationship ? updateCombineSensitivity : updateSourceSensitivity} onDetectFragments={detectFragments} onAddRange={correctionRelationship ? addCombineFragment : addManualFragment} onSave={correctionRelationship ? saveCombineSourceBoundaries : saveSourceBoundaries} onClose={closeSourceEditor} onOpenFragment={correctionRelationship ? undefined : (id) => { setSourceEditorOpen(false);setSourceEditorModal(false);openFragment(id); }} onRenameFragment={correctionRelationship ? undefined : renameFragmentOrRange} onDeleteFragment={correctionRelationship ? undefined : deleteFragmentOrRange} unsavedChanges={correctionRelationship ? undefined : editorUnsaved} saveLabel={correctionRelationship ? "Save & recompute" : "Save all fragments"} footerContent={correctionFooter}/> : null;
  const detailFragment = infoFragmentId ? activeFragments.find((fragment) => fragment.id === infoFragmentId) ?? null : null;
  const detailPanel=sourceEditorOpen && sourcePanelMode === "detail" ? <SourceDetailPanel
    source={selectedSource}
    fragment={detailFragment}
    fragmentCount={selectedRanges.length}
    isPreviewing={previewingId === (detailFragment?.id ?? `source:${selectedSource.id}`)}
    canPlay={Boolean(detailFragment
      ? buildFragmentPreviewScope(detailFragment, selectedSource, fragmentAudioFor)
      : resolveSourceAudioUrl(selectedSource, fragmentAudioFor))}
    editable={!sourceEditorModal}
    onPreview={() => {
      if (detailFragment) previewSingle(detailFragment);
      else previewSource(selectedSource);
    }}
    onClose={closeSourceEditor}
    onSaveAnalysis={(analysis) => saveSourceAnalysis(selectedSource.id, analysis)}
    onSaveFragmentMeta={saveFragmentLibraryMeta}
  /> : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("library")} aria-label="Fragments home">
          <img src={FRAGMENTS_LOGO_SRC} alt="Fragments" className="brand-logo" width={113} height={29} />
        </button>
        <nav aria-label="Primary">
          <button className={view === "library" ? "nav-active" : ""} onClick={() => navigate("library")}>Library</button>
          <button className={view === "source" ? "nav-active" : ""} onClick={() => navigate("source")}>Sources</button>
          <button className={view === "map" ? "nav-active" : ""} onClick={() => navigate("map")}>Map</button>
          {/* <button className={view === "archive" ? "nav-active" : ""} onClick={() => navigate("archive")}>Archive {archived.size > 0 && <b>{archived.size}</b>}</button> */}
        </nav>
        {/* <div className="index-status"><span /><small>{activeFragments.length} surfaced · 2,418 indexed</small></div> */}
        {/* <button className="reset" onClick={resetDemo}>↺ Reset demo</button> */}
      </header>

      {combineCandidates && <CombineWorkspace
        key={combineCandidates.map((item) => item.id).join(":")}
        anchor={selected}
        candidates={combineCandidates}
        fragments={activeFragments}
        sources={sources}
        statuses={relationshipStatuses}
        onClose={closeCombine}
        onEdit={beginCombineSourceEdit}
        onExport={setExportRelationship}
        onSave={(relationship) => { markRelationship(relationship,"preferred");notify("Affinity saved as Preferred."); }}
        onReject={rejectRelationship}
        onAuditioned={(relationship) => { if (!relationshipStatuses[relationship.id]) markRelationship(relationship,"auditioned"); }}
      />}
      {combineCandidates && correctionRelationship && sourceEditorOpen && <div className="source-editor-overlay" role="dialog" aria-modal="true" aria-label="Edit source boundaries">{fragmentationPanel}</div>}
      {!combineCandidates && sourceEditorOpen && sourceEditorModal && sourcePanelMode === "fragmentation" && <div className="source-editor-overlay" role="dialog" aria-modal="true" aria-label="Fragment">{fragmentationPanel}</div>}

      {!combineCandidates && view === "library" && <LibraryView
        sources={sources}
        fragments={filterableFragments}
        selectedId={selectedId}
        connectionsOpen={connectionsOpen}
        resizingConnections={resizingConnections}
        connectionsWidth={connectionsWidth}
        previewingId={previewingId}
        previewProgress={previewProgress}
        query={query}
        sort={sort}
        filters={libraryFilters}
        filterOpen={filterOpen}
        searchRef={searchRef}
        sourceNameFor={sourceNameFor}
        sourceForId={sourceForId}
        linkSummaryFor={linkSummaryFor}
        onQueryChange={setQuery}
        onSortChange={setSort}
        onFiltersChange={setLibraryFilters}
        onToggleFilter={toggleLibraryFilter}
        onCloseFilter={closeLibraryFilter}
        onHighlightFragment={highlightLibraryFragment}
        onHighlightSource={highlightLibrarySource}
        onOpenMatchesFragment={openMatchesForFragment}
        onOpenMatchesSource={openMatchesForSource}
        onOpenInfo={openLibraryInfo}
        fragmentAudioFor={fragmentAudioFor}
        onPreviewFragment={previewSingle}
        onPreviewSource={previewSource}
        onSeekFragment={(fragment, ratio) => previewSingle(fragment, ratio)}
        onSeekSource={(source, ratio) => previewSource(source, ratio)}
        onRenameFragment={renameFragment}
        infoPanelOpen={sourceEditorOpen && !sourceEditorModal && sourcePanelMode === "detail"}
        infoPanel={detailPanel}
        connectionsPanel={connectionsOpen && (connectionAnchorFragmentId || selectedLibrarySourceId) ? <aside className="connections">
          <button type="button" className="panel-resizer" role="slider" aria-label="Resize matches panel" aria-orientation="vertical" aria-valuemin={420} aria-valuemax={760} aria-valuenow={connectionsWidth} onPointerDown={(event) => { event.preventDefault(); setResizingConnections(true); }} onDoubleClick={() => setConnectionsWidth(520)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setConnectionsWidth((width) => Math.min(760,width + 20)); } if (event.key === "ArrowRight") { event.preventDefault(); setConnectionsWidth((width) => Math.max(420,width - 20)); } }}><span /></button>
          <div className="connections-head"><h2>Matches</h2><button className="panel-close" onClick={closeConnections} aria-label="Close matches">×</button></div>
          <p className="selected-caption">
            <span>From</span>
            <strong>
              {selectedLibrarySourceId
                ? sources.find((source) => source.id === selectedLibrarySourceId)?.name
                : connectionAnchorFragmentId
                  ? activeFragmentById(connectionAnchorFragmentId).name
                  : ""}
            </strong>
            <button
              onClick={() => {
                if (selectedLibrarySourceId) editSourceForLibrarySource(selectedLibrarySourceId);
                else if (connectionAnchorFragmentId) editSourceForFragment(connectionAnchorFragmentId);
              }}
            >
              Edit source
            </button>
          </p>
          <ConnectionsTable
            connections={connections}
            selectedFragmentId={connectionAnchorFragmentId ?? ""}
            previewingId={previewingId}
            fragmentFor={activeFragmentById}
            sourceNameFor={sourceNameFor}
            sourceForId={sourceForId}
            onPreview={(fragment, relationship) => {
              previewSingle(fragment);
              markRelationship(relationship, "auditioned");
            }}
            onCombine={openCombine}
            onEditSource={editSourceForFragment}
          />
        </aside> : null}
      />}

      {!combineCandidates && view === "source" && <SourcesView
        sources={sources}
        sourceRanges={sourceRanges}
        selectedSourceId={selectedSourceId}
        editorOpen={sourceEditorOpen}
        editorModal={sourceEditorModal}
        importComplete={importComplete}
        previewingId={previewingId}
        query={sourceQuery}
        sort={sourceSort}
        onQueryChange={setSourceQuery}
        onSortChange={setSourceSort}
        onImportClick={() => setImportOpen(true)}
        onSelectSource={(sourceId) => openSourceInfo(sourceId, false)}
        onOpenFragmentation={(sourceId) => openSourceEditor(sourceId, "fragmentation", true)}
        onPreviewFragment={previewSingle}
        onPreviewSource={previewSource}
        onRemoveSource={removeSource}
        onDeleteSource={(sourceId) => void deleteSourceFromDisk(sourceId)}
        canDeleteFiles={canWriteFiles}
        getFragmentById={fragmentById}
        editorPanel={sourcePanelMode === "detail" ? detailPanel : fragmentationPanel}
      />}

      {!combineCandidates && view === "map" && mapMode === "graph" && <section className="page-view map-page">
        <div className="panel-titlebar map-heading"><div className="map-legend"><span><i className="dot violet"/>Direct affinity</span><span><i className="line amber"/>Transformed bridge</span><span><i className="line take"/>Related takes</span><span><i className="node-size"/>Size = matches</span><span className="dimension-legend">Position · tonal focus × timbral brightness</span></div>{mapModeSwitch}</div>
        <div className="graph-board" role="region" aria-label="Musical fragment map" aria-describedby="map-help">
          <div className="graph-canvas">
            <div className="map-grid" aria-hidden="true"/>
            <div className="map-axis map-axis-x" aria-hidden="true"><span>Unpitched / textural</span><b>Tonal focus</b><span>Pitched / melodic</span></div>
            <div className="map-axis map-axis-y" aria-hidden="true"><span>Bright / airy</span><b>Timbral brightness</b><span>Dark / warm</span></div>
            <svg className="graph-edges" viewBox={`0 0 ${MAP_WORLD.width} ${MAP_WORLD.height}`} preserveAspectRatio="none" aria-hidden="true">
              {mapTakeEdges.map((edge) => { const a=mapPoints.get(edge.source),b=mapPoints.get(edge.target);if (!a || !b || archived.has(edge.source) || archived.has(edge.target)) return null;return <line key={`take-${edge.source}-${edge.target}`} className="take-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y}/>; })}
              {mapRelationships.map((relationship) => {
                const a=mapPoints.get(relationship.source),b=mapPoints.get(relationship.target);
                if (!a || !b || archived.has(relationship.source) || archived.has(relationship.target)) return null;
                const highlighted=hoveredMapId === relationship.source || hoveredMapId === relationship.target;
                return <line key={relationship.id} className={`${relationshipIsTransformed(relationship) ? "bridge" : ""} ${highlighted ? "highlighted" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ opacity:Math.max(.24,relationship.base * .62) }}/>;
              })}
            </svg>
            {mapFragments.map((fragment) => { if (archived.has(fragment.id)) return null;const point=mapPoints.get(fragment.id)!;const shortName=fragment.name.length > 22 ? `${fragment.name.slice(0,21)}…` : fragment.name;const links=mapDegreeFor(fragment.id);const size=17 + Math.min(6,links.length) * 1.25;return <button key={fragment.id} data-map-node={fragment.id} title={fragment.name} className={`graph-node role-${fragment.role.toLowerCase()} ${mapSelectedId === fragment.id ? "selected" : ""}`} style={{ left:`${(point.x / MAP_WORLD.width) * 100}%`,top:`${(point.y / MAP_WORLD.height) * 100}%`,"--node-size":`${size}px` } as CSSProperties} onMouseEnter={() => setHoveredMapId(fragment.id)} onMouseLeave={() => setHoveredMapId(null)} onFocus={() => setHoveredMapId(fragment.id)} onBlur={() => setHoveredMapId(null)} onClick={(event) => { stopAllAudio();setSelectedId(fragment.id);setMapSelectedId(fragment.id);if (event.detail === 0) focusMapInspector(); }} aria-label={`Inspect ${fragment.name}, ${fragment.role}, ${fragment.key}, ${fragment.bpm} BPM, ${links.length} matches`}><i/><span>{shortName}</span></button>; })}
          </div>
          <span id="map-help" className="sr-only">Horizontal position moves from unpitched and textural to pitched and melodic. Vertical position moves from bright and airy to dark and warm.</span>
          {mapFragment && <section className="map-inspector" aria-label={`Map details for ${mapFragment.name}`}>
            <button ref={mapInspectorCloseRef} className="map-inspector-close" onClick={closeMapInspector} aria-label="Close map details">×</button>
            <LibraryCard
              item={{ kind:"fragment", id:mapFragment.id, fragment:mapFragment }}
              isSelected={false}
              isPreviewing={previewingId === mapFragment.id}
              previewProgress={previewingId === mapFragment.id ? previewProgress : null}
              sourceNameFor={sourceNameFor}
              sourceForId={sourceForId}
              linkSummaryFor={linkSummaryFor}
              fragmentAudioFor={fragmentAudioFor}
              onSelect={() => {}}
              onPreview={() => previewSingle(mapFragment)}
              onSeek={(ratio) => previewSingle(mapFragment, ratio)}
              onOpenMatches={() => openMatchesForFragment(mapFragment.id)}
              onOpenInfo={() => openSourceInfo(mapFragment.sourceId, true)}
              onRename={(name) => renameFragment(mapFragment, name)}
              onSave={() => saveFragment(mapFragment)}
              isSaved={savedFragmentIds.has(mapFragment.id)}
            />
          </section>}
        </div>
      </section>}

      {!combineCandidates && view === "map" && mapMode === "shatter" && <FractureMapView
        modeSwitch={mapModeSwitch}
        sources={sources}
        fragments={fractureFragments}
        seedAnalysis={SEED_ANALYSIS}
        selectedId={fractureSelectedId}
        onSelect={(assetId) => setFractureSelectedId(assetId)}
        inspector={fractureFragment
          ? <LibraryCard
              item={{ kind:"fragment", id:fractureFragment.id, fragment:fractureFragment }}
              isSelected={false}
              isPreviewing={previewingId === fractureFragment.id}
              previewProgress={previewingId === fractureFragment.id ? previewProgress : null}
              sourceNameFor={sourceNameFor}
              sourceForId={sourceForId}
              linkSummaryFor={linkSummaryFor}
              fragmentAudioFor={fragmentAudioFor}
              onSelect={() => {}}
              onPreview={() => previewSingle(fractureFragment)}
              onSeek={(ratio) => previewSingle(fractureFragment, ratio)}
              onOpenMatches={() => openMatchesForFragment(fractureFragment.id)}
              onOpenInfo={() => openFractureInfo(fractureFragment.sourceId, fractureFragment.id)}
              onRename={(name) => renameFragment(fractureFragment, name)}
              showAffinities={false}
              infoLabel="Show in Library"
            />
          : fractureSource
            ? <LibraryCard
                item={{ kind:"source", id:`source:${fractureSource.id}`, source:fractureSource }}
                isSelected={false}
                isPreviewing={previewingId === `source:${fractureSource.id}`}
                previewProgress={previewingId === `source:${fractureSource.id}` ? previewProgress : null}
                sourceNameFor={sourceNameFor}
                sourceForId={sourceForId}
                linkSummaryFor={linkSummaryFor}
                fragmentAudioFor={fragmentAudioFor}
                onSelect={() => {}}
                onPreview={() => previewSource(fractureSource)}
                onSeek={(ratio) => previewSource(fractureSource, ratio)}
                onOpenMatches={() => openMatchesForSource(fractureSource)}
                onOpenInfo={() => openFractureInfo(fractureSource.id)}
                showAffinities={false}
                infoLabel="Show in Library"
              />
            : null}
      />}

      {!combineCandidates && view === "archive" && <section className="page-view archive-page">
        <div className="panel-titlebar"><h1>Archive</h1></div>
        {archived.size === 0 ? <div className="empty-state"><span>◌</span><h2>Nothing archived yet</h2><p>When you tidy alternate takes, they remain safely recoverable here.</p><button onClick={() => navigate("library")}>Return to library</button></div> : <div className="archive-list">{activeFragments.filter((fragment) => archived.has(fragment.id)).map((fragment) => <div className="archive-row" key={fragment.id}><Waveform values={fragment.waveform}/><span><b>{fragment.name}</b><small>{sourceNameFor(fragment)} · {fragment.dateLabel}</small></span><em>{fragment.role}</em><button onClick={() => restoreFragment(fragment.id)}>↟ Restore to matching</button></div>)}</div>}
      </section>}

      <Dialog open={closeConfirmOpen} onOpenChange={(open) => { if (!open) setCloseConfirmOpen(false); }}>
        <DialogContent showCloseButton={false} className="workbench-close-confirm sm:max-w-md">
          <DialogHeader>
            <ModalTitlebar
              className="mb-0"
              eyebrow="Unsaved fragments"
              title={<DialogTitle className="modal-titlebar-title">{selectedSource.name}</DialogTitle>}
            />
            <DialogDescription className="mt-2">
              You have changed the slices for{" "}
              <strong className="font-medium text-foreground">{selectedSource.name}</strong> without
              saving. Saving writes all {selectedRanges.length} fragments to its{" "}
              <code>source.json</code>; discarding returns them to what the library already holds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloseConfirmOpen(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => { setCloseConfirmOpen(false);void discardSourceEdits(selectedSource);finishCloseSourceEditor(); }}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              variant="lime"
              onClick={() => { setCloseConfirmOpen(false);saveSourceBoundaries();finishCloseSourceEditor(); }}
            >
              Save all fragments
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DuplicateTakesDialog
        open={Boolean(duplicateGroup)}
        onOpenChange={(open) => { if (!open) { setDuplicateGroup(null); stopAllAudio(); } }}
        fragments={selectedDuplicates}
        selectedId={selectedId}
        previewingId={previewingId}
        onPreview={previewSingle}
        onMarkSeparate={(fragmentId) => { setDuplicateExclusions((current) => new Set([...current, fragmentId])); notify("Marked as a separate idea."); }}
        onArchive={archiveFragment}
        onKeepTake={keepTake}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={handleImportSource} />
      {exportRelationship && (() => { const candidate=activeFragmentById(exportRelationship.otherId);return <ExportSheet anchor={selected} candidate={candidate} relationship={exportRelationship} onClose={() => setExportRelationship(null)} onSaved={() => { markRelationship(exportRelationship,"preferred");setExportRelationship(null);notify("Package ready and relationship marked Preferred."); }}/>; })()}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
