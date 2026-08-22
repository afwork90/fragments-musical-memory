"use client";

import { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_WEIGHTS,
  DEFAULT_TOLERANCES,
  FRAGMENTS,
  IMPORTED_FRAGMENT_IDS,
  MESSY_PHONE_PROFILE,
  RELATIONSHIPS,
  SOURCE_FILES,
  Fragment,
  MatchTolerances,
  Relationship,
  RelationshipStatus,
  SearchContext,
  SearchWeights,
  SourceFile,
} from "./prototype-data";
import { Waveform } from "@/components/audio/waveform";
import { DuplicateTakesDialog } from "./features/library/duplicate-takes-dialog";
import { LibraryView } from "./features/library/library-view";
import { LibraryFilterMenu, LibrarySort, LibrarySortColumn } from "./features/library/types";
import { ImportDialog, ImportedSource } from "./features/sources/import-dialog";
import { SourcesView } from "./features/sources/sources-view";
import { SourceSort } from "./features/sources/types";
import { CombineCandidate, CombineWorkspace, ExportSheet } from "./hero-workflow";
import { EditableRange, FragmentationWorkbench } from "./fragmentation-workbench";
import { LibraryFilters, createLibraryFilters } from "./library-filter-popover";
import { formatSeconds } from "@/lib/format";
import { bindSourceAudio, retainCachedAudio } from "@/lib/audio/audio-service";
import { MAP_WORLD, clampMapCamera, fitMapCamera, musicalMapPoint, panMapCamera, zoomMapCameraAt } from "./map-layout.mjs";

type View = "library" | "source" | "map" | "archive";
type RangeMode = "reasonable" | "experimental";
type ScoredRelationship = Relationship & { score: number; otherId: string };
type MapCamera = { x:number;y:number;scale:number };
type ReturnSnapshot = { kind:"source-edit" | "map-full";view:View;selectedId:string;selectedSourceId:string;connectionsOpen:boolean;advancedOpen:boolean;mapSelectedId:string | null;mapCamera:MapCamera;scrollY:number };
type CorrectionPhase = "edit" | "recompute" | "prompt";

const CONTEXTS: { id: SearchContext; label: string }[] = [
  { id: "whole", label: "Whole" }, { id: "melody", label: "Melody" }, { id: "rhythm", label: "Rhythm" },
  { id: "harmony", label: "Harmony" }, { id: "bass", label: "Bass" },
];
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

function scoreRelationship(relationship: Relationship, weights: SearchWeights, context: SearchContext, mode: RangeMode) {
  const multipliers: Record<SearchContext, SearchWeights> = {
    whole:{ rhythm:1, harmony:1, melody:1, timbre:1 },
    melody:{ rhythm:.28, harmony:.72, melody:2.5, timbre:.55 },
    rhythm:{ rhythm:2.8, harmony:.22, melody:.18, timbre:.72 },
    harmony:{ rhythm:.42, harmony:2.6, melody:.66, timbre:.5 },
    bass:{ rhythm:1.8, harmony:1.45, melody:.24, timbre:1.25 },
  };
  const adjusted: SearchWeights = {
    rhythm: weights.rhythm * multipliers[context].rhythm,
    harmony: weights.harmony * multipliers[context].harmony,
    melody: weights.melody * multipliers[context].melody,
    timbre: weights.timbre * multipliers[context].timbre,
  };
  const weighted = relationship.metrics.rhythm * adjusted.rhythm + relationship.metrics.harmony * adjusted.harmony + relationship.metrics.melody * adjusted.melody + relationship.metrics.timbre * adjusted.timbre;
  const fixed = relationship.metrics.tempo * 12 + relationship.metrics.pitch * 10 + relationship.metrics.brightness * 8;
  const totalWeight = adjusted.rhythm + adjusted.harmony + adjusted.melody + adjusted.timbre + 30;
  const similarity = (weighted + fixed) / totalWeight;
  const penalty = relationship.transformationCost * (mode === "experimental" ? .46 : 1);
  return Math.round(Math.max(0, Math.min(99, (similarity * .9 + relationship.base * .1 - penalty) * 100)));
}

function TransformChips({ relationship }: { relationship:Relationship }) {
  return <div className="chips">{(relationship.transform?.labels ?? ["As recorded"]).map((label) => <span key={label}>{label}</span>)}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>("library");
  const [selectedId, setSelectedId] = useState("f02");
  const [query, setQuery] = useState("");
  const [libraryFilters,setLibraryFilters] = useState<LibraryFilters>(createLibraryFilters);
  const [filterMenu,setFilterMenu] = useState<LibraryFilterMenu | null>(null);
  const [sort, setSort] = useState<LibrarySort>({ column:"date", direction:"desc" });
  const [context, setContext] = useState<SearchContext>("whole");
  const [rangeMode, setRangeMode] = useState<RangeMode>("reasonable");
  const [weights, setWeights] = useState<SearchWeights>({ ...DEFAULT_WEIGHTS });
  const [tolerances,setTolerances] = useState<MatchTolerances>({ ...DEFAULT_TOLERANCES });
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [duplicateExclusions, setDuplicateExclusions] = useState<Set<string>>(new Set());
  const [duplicateGroup, setDuplicateGroup] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceFile[]>(SOURCE_FILES.filter((source) => !source.imported).map((source) => ({ ...source })));
  const [selectedSourceId, setSelectedSourceId] = useState(OPENING_SOURCE_ID);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [connectionsWidth, setConnectionsWidth] = useState(520);
  const [resizingConnections, setResizingConnections] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceSort, setSourceSort] = useState<SourceSort>({ column:"date", direction:"desc" });
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const [sourceEditorModal, setSourceEditorModal] = useState(false);
  const [sourceRanges, setSourceRanges] = useState<Record<string,EditableRange[]>>(initialSourceRanges);
  const [importOpen,setImportOpen] = useState(false);
  const [importComplete,setImportComplete] = useState(false);
  const [fragmentOverrides,setFragmentOverrides] = useState<Record<string,Partial<Fragment>>>({});
  const [combineCandidates,setCombineCandidates] = useState<CombineCandidate[] | null>(null);
  const [correctionRelationship,setCorrectionRelationship] = useState<CombineCandidate | null>(null);
  const [correctionPhase,setCorrectionPhase] = useState<CorrectionPhase>("edit");
  const [correctionOriginal,setCorrectionOriginal] = useState<Pick<Fragment,"duration" | "key" | "bpm" | "bars" | "beats" | "confidence" | "analysisRevision"> | null>(null);
  const [combineDraftRanges,setCombineDraftRanges] = useState<EditableRange[] | null>(null);
  const [combineDraftSensitivity,setCombineDraftSensitivity] = useState<number | null>(null);
  const [exportRelationship,setExportRelationship] = useState<CombineCandidate | null>(null);
  const [relationshipStatuses,setRelationshipStatuses] = useState<Record<string,RelationshipStatus>>({ ...INITIAL_RELATIONSHIP_STATUSES });
  const [manualRelationshipIds,setManualRelationshipIds] = useState<Set<string>>(() => new Set(INITIAL_MANUAL_RELATIONSHIP_IDS));
  const [mapSelectedId,setMapSelectedId] = useState<string | null>(null);
  const [hoveredMapId,setHoveredMapId] = useState<string | null>(null);
  const [mapCamera,setMapCamera] = useState<MapCamera>({ x:0,y:0,scale:1 });
  const [mapPanning,setMapPanning] = useState(false);
  const returnScroll = useRef(0);
  const returnStack = useRef<ReturnSnapshot[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapSizeRef = useRef({ width:0,height:0 });
  const mapDragRef = useRef<{ pointerId:number;startX:number;startY:number;origin:MapCamera } | null>(null);
  const mapInspectorCloseRef = useRef<HTMLButtonElement>(null);
  const mapDidFit = useRef(false);
  const filterMenuOpenRef=useRef(false);
  const closeFilterMenu=useCallback(() => setFilterMenu(null),[]);

  useEffect(() => { filterMenuOpenRef.current=Boolean(filterMenu); },[filterMenu]);

  const activeFragments = useMemo(() => FRAGMENTS.filter((fragment) => importComplete || !IMPORTED_FRAGMENT_IDS.includes(fragment.id)).map((fragment) => ({ ...fragment,...fragmentOverrides[fragment.id] })),[importComplete,fragmentOverrides]);
  const activeFragmentById = (id:string) => activeFragments.find((fragment) => fragment.id === id) ?? ({ ...fragmentById(id),...fragmentOverrides[id] });
  const selected = activeFragmentById(selectedId);
  const selectedSource = sources.find((source) => source.id === selectedSourceId)!;
  const selectedRanges = sourceRanges[selectedSourceId] ?? [];

  const stopAllAudio = () => {
    if (previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; }
    setPreviewingId(null);
  };

  const navigate = (next:View) => { stopAllAudio();returnStack.current=[];setFilterMenu(null);setConnectionsOpen(false);setAdvancedOpen(false);setSourceEditorOpen(false);setSourceEditorModal(false);setCorrectionRelationship(null);setCorrectionPhase("edit");if (next !== "map") setMapSelectedId(null);setView(next); };
  const notify = (message:string) => { setToast(message); window.setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    const handler = (event:KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("library"); window.setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.key === "Escape") { if (filterMenuOpenRef.current) return;setDuplicateGroup(null);setMapSelectedId(null);stopAllAudio(); }
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

  useEffect(() => {
    if (view !== "map") return;
    const viewport=mapViewportRef.current;
    if (!viewport) return;
    const measure=() => {
      const rect=viewport.getBoundingClientRect();
      const size={ width:rect.width,height:rect.height };
      if (!size.width || !size.height) return;
      mapSizeRef.current=size;
      if (!mapDidFit.current) { mapDidFit.current=true;setMapCamera(fitMapCamera(size)); }
      else setMapCamera((camera) => clampMapCamera(camera,size));
    };
    const observer=new ResizeObserver(measure);
    observer.observe(viewport);measure();
    const wheel=(event:WheelEvent) => {
      if (mapDragRef.current || (event.target as HTMLElement).closest(".map-inspector,.map-controls")) return;
      event.preventDefault();
      const rect=viewport.getBoundingClientRect();
      const unit=event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      const delta=Math.max(-100,Math.min(100,event.deltaY * unit));
      const cursor={ x:event.clientX - rect.left,y:event.clientY - rect.top };
      setMapCamera((camera) => zoomMapCameraAt(camera,camera.scale * Math.exp(-delta * .002),cursor,mapSizeRef.current));
    };
    viewport.addEventListener("wheel",wheel,{ passive:false });
    return () => { observer.disconnect();viewport.removeEventListener("wheel",wheel); };
  },[view]);

  const rankedConnectionsFor = (sourceId:string,limit=6):ScoredRelationship[] => {
    const sourceFragment=activeFragmentById(sourceId);
    const seen=new Set<string>();
    return RELATIONSHIPS.filter((relationship) => relationship.source === sourceId || relationship.target === sourceId)
      .map((relationship) => {
        const correctedHero=relationship.id === "r01" && Boolean(fragmentOverrides.f02?.analysisRevision);
        const effectiveRelationship=correctedHero && relationship.transform ? { ...relationship,transform:{ ...relationship.transform,bpm:2,labels:["−3 st","+2 BPM"] } } : relationship;
        const score=correctedHero ? 76 : relationship.id === "r01" && sourceId === "f01" && context === "whole" && rangeMode === "reasonable" && Object.keys(DEFAULT_WEIGHTS).every((key) => weights[key as keyof SearchWeights] === DEFAULT_WEIGHTS[key as keyof SearchWeights]) ? 94 : scoreRelationship(effectiveRelationship,weights,context,rangeMode);
        return { ...effectiveRelationship,score,otherId:otherIdFor(effectiveRelationship,sourceId) };
      })
      .filter((relationship) => {
        const target=activeFragments.find((fragment) => fragment.id === relationship.otherId);
        if (!target || seen.has(target.id) || archived.has(target.id)) return false;
        if (sourceFragment.duplicateGroup && target.duplicateGroup === sourceFragment.duplicateGroup) return false;
        const isManual=manualRelationshipIds.has(relationship.id);
        if (!isManual) {
          if (rangeMode === "reasonable" && (relationship.experimental || relationship.transformationCost > .12)) return false;
          const transformedBpm=target.bpm + (relationship.transform?.bpm ?? 0);
          if (Math.abs(transformedBpm - sourceFragment.bpm) / Math.max(1,sourceFragment.bpm) * 100 > tolerances.tempoWindow) return false;
          const pitchFloor=tolerances.keyFlexibility === "exact" ? .96 : tolerances.keyFlexibility === "related" ? .78 : .62;
          if (relationship.metrics.pitch < pitchFloor) return false;
          const barDelta=Math.abs(target.bars - sourceFragment.bars);
          if (tolerances.lengthTolerance === "same" && barDelta !== 0) return false;
          if (tolerances.lengthTolerance === "one" && barDelta > 1) return false;
          if (!tolerances.allowRepetition && (relationship.transform?.repeat ?? 1) > 1) return false;
        }
        seen.add(target.id);return true;
      })
      .sort((a,b) => b.score - a.score)
      .slice(0,limit);
  };

  const linkSummaryFor = (fragmentId:string) => {
    const eligible=rankedConnectionsFor(fragmentId,RELATIONSHIPS.length);
    return { total:eligible.length,manual:eligible.filter((relationship) => manualRelationshipIds.has(relationship.id)).length };
  };

  const relatedTakeCountFor=(fragment:Fragment) => fragment.duplicateGroup && !duplicateExclusions.has(fragment.id) ? activeFragments.filter((item) => item.duplicateGroup === fragment.duplicateGroup && item.id !== fragment.id && !archived.has(item.id) && !duplicateExclusions.has(item.id)).length : 0;
  const filterableFragments=useMemo(() => activeFragments.filter((fragment) => !archived.has(fragment.id)),[activeFragments,archived]);

  const openColumnFilter = (column:LibrarySortColumn,trigger:HTMLButtonElement) => {
    if (filterMenu?.column === column) { setFilterMenu(null);return; }
    const rect=trigger.getBoundingClientRect();
    setFilterMenu({ column,left:rect.left,top:rect.bottom + 5,trigger });
  };

  const resizeRangesForSensitivity = (ranges:EditableRange[],source:SourceFile,value:number) => {
    const count=fragmentCountForSensitivity(value);
    return count <= ranges.length ? ranges.slice(0,count) : [...ranges,...Array.from({ length:count - ranges.length },(_,offset) => rangeForIndex(source,ranges.length + offset))];
  };

  const updateSourceSensitivity = (value:number) => {
    setSources((current) => current.map((source) => source.id === selectedSourceId ? { ...source,sensitivity:value } : source));
    setSourceRanges((current) => ({ ...current,[selectedSourceId]:resizeRangesForSensitivity(current[selectedSourceId] ?? [],selectedSource,value) }));
  };

  const addManualFragment = () => {
    const index=selectedRanges.length;
    const next={ ...rangeForIndex(selectedSource,index),fragmentId:undefined,id:`${selectedSource.id}-manual-${Date.now()}` };
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
    setCombineDraftRanges((current) => resizeRangesForSensitivity(current ?? selectedRanges,selectedSource,value));
  };

  const connections=rankedConnectionsFor(selectedId);

  const selectedDuplicates = duplicateGroup ? activeFragments.filter((fragment) => fragment.duplicateGroup === duplicateGroup && !duplicateExclusions.has(fragment.id) && !archived.has(fragment.id)) : [];

  const previewSingle = (fragment:Fragment) => {
    if (previewingId === fragment.id && previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; setPreviewingId(null); return; }
    stopAllAudio();
    const audio = new Audio(fragment.audio); audio.loop = true; audio.volume = .72; previewAudio.current = audio; setPreviewingId(fragment.id);
    audio.play().catch(() => notify("Playback needs one more click in this browser."));
  };

  const previewSource = (source: SourceFile) => {
    const previewKey = `source:${source.id}`;
    if (previewingId === previewKey && previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; setPreviewingId(null); return; }
    if (!source.audioUrl) return;
    stopAllAudio();
    const audio = new Audio(source.audioUrl); audio.loop = true; audio.volume = .72; previewAudio.current = audio; setPreviewingId(previewKey);
    audio.play().catch(() => notify("Playback needs one more click in this browser."));
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
  const resetDemo = () => {
    stopAllAudio(); setView("library"); setSelectedId("f02"); setQuery("");setLibraryFilters(createLibraryFilters());setFilterMenu(null);setSort({ column:"date", direction:"desc" });
    setContext("whole"); setRangeMode("reasonable"); setWeights({ ...DEFAULT_WEIGHTS }); setTolerances({ ...DEFAULT_TOLERANCES });setArchived(new Set()); setDuplicateExclusions(new Set());
    returnStack.current=[];setDuplicateGroup(null);setConnectionsOpen(false);setAdvancedOpen(false);setConnectionsWidth(520);setSources(SOURCE_FILES.filter((source) => !source.imported).map((source) => ({ ...source })));setSourceRanges(initialSourceRanges());setSelectedSourceId(OPENING_SOURCE_ID);setSourceQuery("");setSourceSort({ column:"date",direction:"desc" });setSourceEditorOpen(false);setSourceEditorModal(false);setImportOpen(false);setImportComplete(false);setFragmentOverrides({});setCombineCandidates(null);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);setExportRelationship(null);setRelationshipStatuses({ ...INITIAL_RELATIONSHIP_STATUSES });setManualRelationshipIds(new Set(INITIAL_MANUAL_RELATIONSHIP_IDS));setMapSelectedId(null);setHoveredMapId(null);setMapCamera({ x:0,y:0,scale:1 });mapDidFit.current=false;notify("Demo restored to 24 fragments before import.");
  };
  const pushReturn = (kind:ReturnSnapshot["kind"]) => returnStack.current.push({ kind,view,selectedId,selectedSourceId,connectionsOpen,advancedOpen,mapSelectedId,mapCamera:{ ...mapCamera },scrollY:window.scrollY });
  const restoreReturn = (kind:ReturnSnapshot["kind"]) => {
    const snapshot=returnStack.current.at(-1);
    if (!snapshot || snapshot.kind !== kind) return false;
    returnStack.current.pop();stopAllAudio();setView(snapshot.view);setSelectedId(snapshot.selectedId);setSelectedSourceId(snapshot.selectedSourceId);setConnectionsOpen(snapshot.connectionsOpen);setAdvancedOpen(snapshot.advancedOpen);setMapSelectedId(snapshot.mapSelectedId);setMapCamera(snapshot.mapCamera);setSourceEditorOpen(false);window.setTimeout(() => window.scrollTo({ top:snapshot.scrollY }),0);return true;
  };
  const openFragment = (id:string) => { stopAllAudio(); setSelectedId(id); setConnectionsOpen(true); setAdvancedOpen(false); setView("library"); };
  const openFragmentFromMap = (id:string) => { pushReturn("map-full");openFragment(id); };
  const closeConnections = () => { if (restoreReturn("map-full")) return;stopAllAudio();setConnectionsOpen(false);setAdvancedOpen(false); };
  const closeSourceEditor = () => {
    if (correctionRelationship) { setSourceEditorOpen(false);setSourceEditorModal(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);return; }
    if (restoreReturn("source-edit")) return;
    stopAllAudio();setSourceEditorOpen(false);setSourceEditorModal(false);
  };
  const openSourceEditor = (sourceId: string, modal: boolean) => {
    stopAllAudio();
    setSelectedSourceId(sourceId);
    setSourceEditorModal(modal);
    setSourceEditorOpen(true);
  };
  const editSourceForFragment = (id:string) => { const fragment=activeFragmentById(id);pushReturn("source-edit");stopAllAudio();setSelectedSourceId(fragment.sourceId);setSourceEditorOpen(true);setConnectionsOpen(false);setAdvancedOpen(false);setView("source"); };
  const handleImportSource = (imported: ImportedSource) => {
    const id = `source-import-${Date.now()}`;
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
      sensitivity: MESSY_PHONE_PROFILE.sensitivity,
      start: 0,
      end: imported.duration,
      sourceTypes: imported.sourceTypes,
      analysisProfile: MESSY_PHONE_PROFILE,
      imported: true,
      audioUrl: imported.objectUrl,
      audioCacheKey: imported.cacheKey,
      bpm: imported.analysis.bpm,
      key: imported.analysis.key,
      scale: imported.analysis.scale,
    };
    setSources((current) => [...current, newSource]);
    setSourceRanges((current) => ({ ...current, [id]: [] }));
    setSelectedSourceId(id);
    setSourceEditorOpen(true);
    setImportComplete(true);
    setView("source");
    notify(`Imported ${imported.name}.`);
  };
  const openCombine = (relationship:ScoredRelationship) => { stopAllAudio();returnScroll.current=window.scrollY;setRelationshipStatuses((current) => ({ ...current,[relationship.id]:current[relationship.id] ?? "auditioned" }));setCombineCandidates([relationship,...connections.filter((item) => item.id !== relationship.id)].slice(0,3));window.scrollTo({ top:0 }); };
  const closeCombine = () => { stopAllAudio();setSourceEditorOpen(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);setExportRelationship(null);setCombineCandidates(null);window.setTimeout(() => window.scrollTo({ top:returnScroll.current }),0); };
  const markRelationship = (relationship:CombineCandidate,status:RelationshipStatus) => setRelationshipStatuses((current) => ({ ...current,[relationship.id]:status }));
  const rejectRelationship = (relationship:CombineCandidate) => { const next=(combineCandidates ?? []).filter((item) => item.id !== relationship.id);markRelationship(relationship,"rejected");setCombineCandidates(next.length ? next : null);if (!next.length) window.setTimeout(() => window.scrollTo({ top:returnScroll.current }),0);notify(next.length ? "Candidate rejected for this session." : "Last candidate rejected. Returned to the search."); };
  const beginCombineSourceEdit = (relationship:CombineCandidate) => {
    const candidate=activeFragmentById(relationship.otherId);const source=sources.find((item) => item.id === candidate.sourceId) ?? SOURCE_FILES.find((item) => item.id === candidate.sourceId)!;
    stopAllAudio();setSelectedSourceId(source.id);setCombineDraftRanges((sourceRanges[source.id] ?? []).map((range) => ({ ...range })));setCombineDraftSensitivity(source.sensitivity);setCorrectionOriginal({ duration:candidate.duration,key:candidate.key,bpm:candidate.bpm,bars:candidate.bars,beats:candidate.beats,confidence:candidate.confidence,analysisRevision:candidate.analysisRevision });setCorrectionPhase("edit");setCorrectionRelationship(relationship);setSourceEditorOpen(true);
  };
  const saveSourceBoundaries = () => {
    const patches:Record<string,Partial<Fragment>>={};
    selectedRanges.forEach((range) => { const id=range.fragmentId;if (!id) return;const fragment=activeFragmentById(id);patches[id]={ start:range.start,end:range.end,duration:formatSeconds(range.end-range.start),analysisRevision:fragment.analysisRevision + 1 }; });
    setFragmentOverrides((current) => ({ ...current,...patches }));notify("Boundaries saved; library references updated.");
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
  mapFragments.filter((fragment) => !archived.has(fragment.id)).forEach((fragment) => rankedConnectionsFor(fragment.id,RELATIONSHIPS.length).forEach((relationship) => mapRelationshipScores.set(relationship.id,Math.max(mapRelationshipScores.get(relationship.id) ?? 0,relationship.score))));
  const mapRelationships=RELATIONSHIPS.filter((relationship) => mapRelationshipScores.has(relationship.id) && !archived.has(relationship.source) && !archived.has(relationship.target) && relationshipStatuses[relationship.id] !== "rejected");
  const mapDegreeFor=(id:string) => mapRelationships.filter((relationship) => relationship.source === id || relationship.target === id);
  const mapFragment=mapSelectedId && !archived.has(mapSelectedId) ? activeFragments.find((fragment) => fragment.id === mapSelectedId) ?? null : null;
  const mapConnections:ScoredRelationship[]=mapFragment ? mapDegreeFor(mapFragment.id).map((relationship) => ({ ...relationship,score:mapRelationshipScores.get(relationship.id) ?? Math.round(relationship.base * 100),otherId:otherIdFor(relationship,mapFragment.id) })).sort((a,b) => b.score - a.score).slice(0,4) : [];
  const mapFragmentRelationships=mapFragment ? mapDegreeFor(mapFragment.id) : [];
  const mapLinks=mapFragment ? { total:mapFragmentRelationships.length,manual:mapFragmentRelationships.filter((relationship) => manualRelationshipIds.has(relationship.id)).length } : { total:0,manual:0 };
  const mapTakes=mapFragment?.duplicateGroup ? activeFragments.filter((fragment) => fragment.duplicateGroup === mapFragment.duplicateGroup && fragment.id !== mapFragment.id && !archived.has(fragment.id) && !duplicateExclusions.has(fragment.id)).length : 0;
  const fitCurrentMap=() => { const size=mapSizeRef.current;if (size.width && size.height) setMapCamera(fitMapCamera(size)); };
  const zoomMapBy=(factor:number) => {
    const size=mapSizeRef.current;
    if (!size.width || !size.height) return;
    setMapCamera((camera) => zoomMapCameraAt(camera,camera.scale * factor,{ x:size.width / 2,y:size.height / 2 },size));
  };
  const beginMapPan=(event:ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || mapDragRef.current || event.button !== 0 || (event.target as HTMLElement).closest("button,.map-inspector,.map-controls")) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll:true });
    mapDragRef.current={ pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,origin:mapCamera };
    event.currentTarget.setPointerCapture(event.pointerId);setMapPanning(true);
  };
  const moveMapPan=(event:ReactPointerEvent<HTMLDivElement>) => {
    const drag=mapDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setMapCamera(panMapCamera(drag.origin,event.clientX - drag.startX,event.clientY - drag.startY,mapSizeRef.current));
  };
  const endMapPan=(event:ReactPointerEvent<HTMLDivElement>) => {
    if (mapDragRef.current?.pointerId !== event.pointerId) return;
    mapDragRef.current=null;setMapPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleMapKeyboard=(event:ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const size=mapSizeRef.current;
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","+","=","-","0","Home"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") setMapCamera((camera) => panMapCamera(camera,40,0,size));
    if (event.key === "ArrowRight") setMapCamera((camera) => panMapCamera(camera,-40,0,size));
    if (event.key === "ArrowUp") setMapCamera((camera) => panMapCamera(camera,0,40,size));
    if (event.key === "ArrowDown") setMapCamera((camera) => panMapCamera(camera,0,-40,size));
    if (event.key === "+" || event.key === "=") zoomMapBy(1.25);
    if (event.key === "-") zoomMapBy(.8);
    if (event.key === "0" || event.key === "Home") fitCurrentMap();
  };
  const focusMapInspector=() => window.setTimeout(() => mapInspectorCloseRef.current?.focus({ preventScroll:true }),0);
  const closeMapInspector=() => { const id=mapSelectedId;stopAllAudio();setMapSelectedId(null);if (id) window.setTimeout(() => document.querySelector<HTMLButtonElement>(`[data-map-node="${id}"]`)?.focus({ preventScroll:true }),0); };
  const selectAndRevealMapNode=(id:string,moveFocus=false) => {
    stopAllAudio();setSelectedId(id);setMapSelectedId(id);
    const point=mapPoints.get(id),size=mapSizeRef.current;
    if (moveFocus) focusMapInspector();
    if (!point || !size.width || !size.height) return;
    setMapCamera((camera) => {
      const screenX=camera.x + point.x * camera.scale,screenY=camera.y + point.y * camera.scale;
      const safeSize={ width:size.width,height:Math.max(280,size.height - 175) };
      const left=42,right=Math.max(left,safeSize.width - 42),top=50,bottom=Math.max(top,safeSize.height - 24);
      const dx=screenX < left ? left - screenX : screenX > right ? right - screenX : 0;
      const dy=screenY < top ? top - screenY : screenY > bottom ? bottom - screenY : 0;
      return dx || dy ? panMapCamera(camera,dx,dy,safeSize) : camera;
    });
  };
  const editorRanges=correctionRelationship ? (combineDraftRanges ?? []) : selectedRanges;
  const editorSensitivity=correctionRelationship ? (combineDraftSensitivity ?? selectedSource.sensitivity) : selectedSource.sensitivity;
  const correctedRange=correctionRelationship ? editorRanges.find((range) => range.fragmentId === correctionRelationship.otherId) : null;
  const correctionFooter=correctionRelationship && correctionPhase === "recompute" ? <div className="recompute workbench-result"><i/><strong>Recomputing metadata and active match…</strong><span>Revision {(correctionOriginal?.analysisRevision ?? 1) + 1}</span></div> : correctionRelationship && correctionPhase === "prompt" && correctionOriginal ? <div className="correction-result workbench-result"><div className="metadata-diff"><span>Field</span><span>Before</span><span>After</span>{[["Duration",correctionOriginal.duration,formatSeconds((correctedRange?.end ?? 0) - (correctedRange?.start ?? 0))],["Key",correctionOriginal.key,"C minor"],["BPM",correctionOriginal.bpm,"90"],["Bars",correctionOriginal.bars,"3"],["Beats",correctionOriginal.beats,"17"],["Confidence",`${Math.round(correctionOriginal.confidence * 100)}%`,`93%`],["Match",`${correctionRelationship.score}%`,`76%`]].map((row) => row.map((cell,index) => <span className={index === 2 ? "changed" : ""} key={`${row[0]}-${index}`}>{cell}</span>))}</div><div className="link-prompt"><span className="relationship-badge manual">criteria changed</span><h3>This fragment no longer matches the original search. Keep it linked to this comparison?</h3><p>The boundary correction is saved either way. A manual link preserves your musical judgment.</p><div><button onClick={rejectCorrectionLink}>Reject and show next</button><button className="primary-button" onClick={keepCorrectionLink}>Yes, keep linked</button></div></div></div> : null;
  const fragmentationPanel=sourceEditorOpen ? <FragmentationWorkbench source={selectedSource} ranges={editorRanges} fragments={activeFragments} sensitivity={editorSensitivity} focusedFragmentId={correctionRelationship?.otherId} onRangesChange={(ranges) => correctionRelationship ? setCombineDraftRanges(ranges) : setSourceRanges((current) => ({ ...current,[selectedSource.id]:ranges }))} onSensitivityChange={correctionRelationship ? updateCombineSensitivity : updateSourceSensitivity} onAddRange={correctionRelationship ? addCombineFragment : addManualFragment} onSave={correctionRelationship ? saveCombineSourceBoundaries : saveSourceBoundaries} onClose={closeSourceEditor} onOpenFragment={correctionRelationship ? undefined : (id) => { setSourceEditorOpen(false);setSourceEditorModal(false);openFragment(id); }} saveLabel={correctionRelationship ? "Save & recompute" : "Save boundaries"} footerContent={correctionFooter}/> : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("library")} aria-label="Fragments home"><span className="brand-mark">F</span><span>Fragments</span></button>
        <nav aria-label="Primary">
          <button className={view === "library" ? "nav-active" : ""} onClick={() => navigate("library")}>Library</button>
          <button className={view === "source" ? "nav-active" : ""} onClick={() => navigate("source")}>Sources</button>
          <button className={view === "map" ? "nav-active" : ""} onClick={() => navigate("map")}>Map</button>
          {/* <button className={view === "archive" ? "nav-active" : ""} onClick={() => navigate("archive")}>Archive {archived.size > 0 && <b>{archived.size}</b>}</button> */}
        </nav>
        <div className="index-status"><span /><small>{activeFragments.length} surfaced · 2,418 indexed</small></div>
        {/* <button className="reset" onClick={resetDemo}>↺ Reset demo</button> */}
      </header>

      {combineCandidates && <CombineWorkspace
        key={combineCandidates.map((item) => item.id).join(":")}
        anchor={selected}
        candidates={combineCandidates}
        fragments={activeFragments}
        statuses={relationshipStatuses}
        onClose={closeCombine}
        onEdit={beginCombineSourceEdit}
        onExport={setExportRelationship}
        onSave={(relationship) => { markRelationship(relationship,"preferred");notify("Combination saved as Preferred."); }}
        onReject={rejectRelationship}
        onAuditioned={(relationship) => { if (!relationshipStatuses[relationship.id]) markRelationship(relationship,"auditioned"); }}
      />}
      {combineCandidates && correctionRelationship && sourceEditorOpen && <div className="source-editor-overlay" role="dialog" aria-modal="true" aria-label="Edit source boundaries">{fragmentationPanel}</div>}
      {!combineCandidates && sourceEditorOpen && sourceEditorModal && <div className="source-editor-overlay" role="dialog" aria-modal="true" aria-label="Fragmentation">{fragmentationPanel}</div>}

      {!combineCandidates && view === "library" && <LibraryView
        fragments={filterableFragments}
        selectedId={selectedId}
        connectionsOpen={connectionsOpen}
        resizingConnections={resizingConnections}
        connectionsWidth={connectionsWidth}
        previewingId={previewingId}
        query={query}
        sort={sort}
        filters={libraryFilters}
        filterMenu={filterMenu}
        searchRef={searchRef}
        sourceNameFor={sourceNameFor}
        linkSummaryFor={linkSummaryFor}
        relatedTakeCountFor={relatedTakeCountFor}
        onQueryChange={setQuery}
        onSortChange={setSort}
        onFiltersChange={setLibraryFilters}
        onOpenColumnFilter={openColumnFilter}
        onCloseFilterMenu={closeFilterMenu}
        onSelectFragment={openFragment}
        onPreviewFragment={previewSingle}
        onOpenTakes={(fragment) => { setSelectedId(fragment.id); setDuplicateGroup(fragment.duplicateGroup!); }}
        connectionsPanel={<aside className="connections">
          <button type="button" className="panel-resizer" role="slider" aria-label="Resize connections panel" aria-orientation="vertical" aria-valuemin={420} aria-valuemax={760} aria-valuenow={connectionsWidth} onPointerDown={(event) => { event.preventDefault(); setResizingConnections(true); }} onDoubleClick={() => setConnectionsWidth(520)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setConnectionsWidth((width) => Math.min(760,width + 20)); } if (event.key === "ArrowRight") { event.preventDefault(); setConnectionsWidth((width) => Math.max(420,width - 20)); } }}><span /></button>
          <div className="connections-head"><h2>Connections</h2><div><button className={`advanced-toggle ${advancedOpen ? "active" : ""}`} onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>Advanced</button><button className="panel-close" onClick={closeConnections} aria-label="Close connections">×</button></div></div>
          <p className="selected-caption"><span>From</span><strong>{selected.name}</strong><button onClick={() => editSourceForFragment(selected.id)}>Edit source</button></p>
          <div className="connection-controls">
            <div className="context-switch" aria-label="Search musical object">{CONTEXTS.map((item) => <button key={item.id} className={context === item.id ? "active" : ""} onClick={() => { stopAllAudio();setContext(item.id); }}>{item.label}</button>)}</div>
            {advancedOpen && <div className="advanced-popover">
              <div className="shape-title"><div><span>Weights & tolerances</span></div><button onClick={() => { setWeights({ ...DEFAULT_WEIGHTS });setTolerances({ ...DEFAULT_TOLERANCES });setRangeMode("reasonable"); }}>Balanced</button></div>
              <div className="weight-presets"><button onClick={() => setWeights({ rhythm:100,harmony:16,melody:12,timbre:42 })}>Rhythm</button><button onClick={() => setWeights({ rhythm:18,harmony:100,melody:74,timbre:22 })}>Harmony</button></div>
              {(Object.keys(weights) as (keyof SearchWeights)[]).map((key) => <label className="weight-row" key={key}><span>{key}</span><input type="range" min="0" max="100" value={weights[key]} onChange={(event) => setWeights((current) => ({ ...current, [key]:Number(event.target.value) }))} /><output>{weights[key]}</output></label>)}
              <div className="tolerance-grid"><label><span>Tempo window</span><input aria-label="Tempo window" type="range" min="2" max="40" value={tolerances.tempoWindow} onChange={(event) => setTolerances((current) => ({ ...current,tempoWindow:Number(event.target.value) }))}/><output>±{tolerances.tempoWindow}%</output></label><label><span>Key flexibility</span><select value={tolerances.keyFlexibility} onChange={(event) => setTolerances((current) => ({ ...current,keyFlexibility:event.target.value as MatchTolerances["keyFlexibility"] }))}><option value="exact">Exact</option><option value="related">Related</option><option value="nearby">Nearby</option></select></label><label><span>Length</span><select value={tolerances.lengthTolerance} onChange={(event) => setTolerances((current) => ({ ...current,lengthTolerance:event.target.value as MatchTolerances["lengthTolerance"] }))}><option value="same">Same bars</option><option value="one">±1 bar</option><option value="any">Any</option></select></label><label className="check-row"><input type="checkbox" checked={tolerances.allowRepetition} onChange={(event) => setTolerances((current) => ({ ...current,allowRepetition:event.target.checked }))}/><span>Allow repetition</span></label></div>
              <div className="range-toggle advanced-range"><button className={rangeMode === "reasonable" ? "active" : ""} onClick={() => setRangeMode("reasonable")}>Reasonable</button><button className={rangeMode === "experimental" ? "active experimental" : ""} onClick={() => setRangeMode("experimental")}>Experimental</button></div>
            </div>}
          </div>
          {selected.objects && context !== "whole" && <div className="object-note"><span>Isolated {context}</span><small>Prepared musical-object view</small></div>}
          <div className="connection-table" role="table" aria-label={`Connections for ${selected.name}`}>
            <div className="connection-row connection-header" role="row"><span>Fit</span><span>Fragment</span><span>Signal</span><span>Key</span><span>BPM</span><span>Role</span><span>Change</span><span>Actions</span></div>
            {connections.map((relationship,index) => {
            const target = activeFragmentById(relationship.otherId);
            return <div className={`connection-row ${index === 0 ? "featured" : ""}`} role="row" key={relationship.id}>
              <span className="connection-fit"><strong>{relationship.score}</strong><small>%</small></span>
              <span className="connection-name">{target.id === "f02" && selectedId === "f01" && <i>Rediscovered · 2018</i>}<b>{target.name}</b><small title={relationship.reason}>{relationship.reason}</small></span>
              <button className={`wave-play connection-wave ${previewingId === target.id ? "playing" : ""}`} onClick={(event) => { event.stopPropagation();previewSingle(target);markRelationship(relationship,"auditioned"); }} aria-label={`${previewingId === target.id ? "Stop" : "Play"} ${target.name}`}><Waveform values={target.waveform} active={previewingId === target.id}/></button>
              <span className="connection-key" title={target.alternateKeys.length ? `${target.key}; also ${target.alternateKeys.join(", ")}` : target.key}>{target.key}</span>
              <span className="connection-tempo">{target.bpm}</span>
              <span className="connection-role">{target.role}</span>
              <span className="connection-change"><TransformChips relationship={relationship} /></span>
              <span className="connection-actions"><button className="connection-edit-button" onClick={() => editSourceForFragment(target.id)} aria-label={`Edit source for ${target.name}`}>Edit source</button><button className="combine-button" onClick={() => openCombine(relationship)} aria-label={`Combine ${target.name} with ${selected.name}`}>Combine</button></span>
            </div>;
          })}{connections.length === 0 && <div className="connection-empty">No authored connections for this fragment.</div>}</div>
        </aside>}
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
        onSelectSource={(sourceId) => openSourceEditor(sourceId, false)}
        onOpenFragmentation={(sourceId) => openSourceEditor(sourceId, true)}
        onPreviewFragment={previewSingle}
        onPreviewSource={previewSource}
        getFragmentById={fragmentById}
        editorPanel={fragmentationPanel}
      />}

      {!combineCandidates && view === "map" && <section className="page-view map-page">
        <div className="panel-titlebar map-heading"><h1>Map</h1><div className="map-legend"><span><i className="dot violet"/>Direct affinity</span><span><i className="line amber"/>Transformed bridge</span><span><i className="line take"/>Related takes</span><span><i className="node-size"/>Size = links</span><span className="dimension-legend">Position · tonal focus × timbral brightness</span></div></div>
        {/* A focusable region provides keyboard pan/zoom without forcing screen readers into application mode. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div ref={mapViewportRef} className={`graph-board ${mapPanning ? "panning" : ""}`} role="region" aria-label="Musical fragment map" aria-describedby="map-help" tabIndex={0} onPointerDown={beginMapPan} onPointerMove={moveMapPan} onPointerUp={endMapPan} onPointerCancel={endMapPan} onLostPointerCapture={endMapPan} onKeyDown={handleMapKeyboard}>
          <div className="map-controls" role="group" aria-label="Map zoom controls"><button onClick={() => zoomMapBy(.8)} aria-label="Zoom out">−</button><output aria-label="Map zoom" aria-live="polite">{Math.round(mapCamera.scale * 100)}%</output><button onClick={() => zoomMapBy(1.25)} aria-label="Zoom in">＋</button><button className="map-fit" onClick={fitCurrentMap}>Fit</button></div>
          <div className="graph-canvas" style={{ width:MAP_WORLD.width,height:MAP_WORLD.height,transform:`translate3d(${mapCamera.x}px,${mapCamera.y}px,0) scale(${mapCamera.scale})`,"--axis-font":`${7 / mapCamera.scale}px`,"--edge-height":`${1 / mapCamera.scale}px` } as CSSProperties}>
            <div className="map-grid" aria-hidden="true"/>
            <div className="map-axis map-axis-x" aria-hidden="true"><span>Unpitched / textural</span><b>Tonal focus</b><span>Pitched / melodic</span></div>
            <div className="map-axis map-axis-y" aria-hidden="true"><span>Bright / airy</span><b>Timbral brightness</b><span>Dark / warm</span></div>
            {mapTakeEdges.map((edge) => { const a=mapPoints.get(edge.source),b=mapPoints.get(edge.target);if (!a || !b || archived.has(edge.source) || archived.has(edge.target)) return null;const dx=b.x-a.x,dy=b.y-a.y;return <i key={`take-${edge.source}-${edge.target}`} className="graph-line take-edge" style={{ left:a.x,top:a.y,width:Math.hypot(dx,dy),transform:`rotate(${Math.atan2(dy,dx)*180/Math.PI}deg)` }}/>; })}
            {mapRelationships.map((relationship) => {
              const a=mapPoints.get(relationship.source),b=mapPoints.get(relationship.target);
              if (!a || !b || archived.has(relationship.source) || archived.has(relationship.target)) return null;
              const dx=b.x-a.x,dy=b.y-a.y;const highlighted=hoveredMapId === relationship.source || hoveredMapId === relationship.target;
              return <i key={relationship.id} className={`graph-line ${relationshipIsTransformed(relationship) ? "bridge" : ""} ${highlighted ? "highlighted" : ""}`} style={{ left:a.x,top:a.y,width:Math.hypot(dx,dy),transform:`rotate(${Math.atan2(dy,dx)*180/Math.PI}deg)`,"--edge-opacity":Math.max(.24,relationship.base * .62) } as CSSProperties}/>;
            })}
            {mapFragments.map((fragment) => { if (archived.has(fragment.id)) return null;const point=mapPoints.get(fragment.id)!;const shortName=fragment.name.length > 19 ? `${fragment.name.slice(0,18)}…` : fragment.name;const links=mapDegreeFor(fragment.id);const size=17 + Math.min(6,links.length) * 1.25;const compensation=Math.max(1,24 / Math.max(1,size * mapCamera.scale));return <button key={fragment.id} data-map-node={fragment.id} title={fragment.name} className={`graph-node role-${fragment.role.toLowerCase()} ${mapSelectedId === fragment.id ? "selected" : ""}`} style={{ left:point.x,top:point.y,"--node-size":`${size}px`,"--node-compensation":compensation,"--node-hover-compensation":compensation * 1.25,"--label-opacity":mapCamera.scale < .45 ? 0 : .58 } as CSSProperties} onMouseEnter={() => setHoveredMapId(fragment.id)} onMouseLeave={() => setHoveredMapId(null)} onFocus={() => setHoveredMapId(fragment.id)} onBlur={() => setHoveredMapId(null)} onClick={(event) => { stopAllAudio();setSelectedId(fragment.id);setMapSelectedId(fragment.id);if (event.detail === 0) focusMapInspector(); }} aria-label={`Inspect ${fragment.name}, ${fragment.role}, ${fragment.key}, ${fragment.bpm} BPM, ${links.length} links`}><i/><span>{shortName}</span><small>{fragment.name}</small></button>; })}
          </div>
          <span id="map-help" className="sr-only">Drag the background to pan. Use the mouse wheel or plus and minus buttons to zoom. Arrow keys pan, and Home fits the map. Horizontal position moves from unpitched and textural to pitched and melodic. Vertical position moves from bright and airy to dark and warm.</span>
          {mapFragment && <section className="map-inspector" aria-label={`Map details for ${mapFragment.name}`}>
            <button ref={mapInspectorCloseRef} className="map-inspector-close" onClick={closeMapInspector} aria-label="Close map details">×</button>
            <div className="map-fragment-mini" role="row"><button className={`wave-play ${previewingId === mapFragment.id ? "playing" : ""}`} onClick={() => previewSingle(mapFragment)} aria-label={`${previewingId === mapFragment.id ? "Stop" : "Play"} ${mapFragment.name}`}><Waveform values={mapFragment.waveform} active={previewingId === mapFragment.id}/></button><span><b>{mapFragment.name}</b><small>{sourceNameFor(mapFragment)}</small></span><em>{mapFragment.key}</em><em>{mapFragment.bpm} BPM</em><em>{mapFragment.role}</em><span className="map-link-count"><b>{mapLinks.total} links</b>{mapLinks.manual > 0 && <i>Manual links {mapLinks.manual}</i>}</span><span>{mapTakes > 0 ? `${mapTakes + 1} takes` : "—"}</span></div>
            <div className="map-connections-mini"><header><b>Connections</b><button onClick={() => openFragmentFromMap(mapFragment.id)}>Open full view →</button></header>{mapConnections.map((relationship) => { const target=activeFragmentById(relationship.otherId);return <div className="map-connection-mini" key={relationship.id}><strong>{relationship.score}%</strong><button className={`wave-play ${previewingId === target.id ? "playing" : ""}`} onClick={() => previewSingle(target)} aria-label={`${previewingId === target.id ? "Stop" : "Play"} ${target.name}`}><Waveform values={target.waveform} active={previewingId === target.id}/></button><button className="map-target" onClick={(event) => selectAndRevealMapNode(target.id,event.detail === 0)}>{target.name}</button><TransformChips relationship={relationship}/></div>;})}{mapConnections.length === 0 && <p>No active connections under the current criteria.</p>}</div>
          </section>}
        </div>
      </section>}

      {!combineCandidates && view === "archive" && <section className="page-view archive-page">
        <div className="panel-titlebar"><h1>Archive</h1></div>
        {archived.size === 0 ? <div className="empty-state"><span>◌</span><h2>Nothing archived yet</h2><p>When you tidy alternate takes, they remain safely recoverable here.</p><button onClick={() => navigate("library")}>Return to library</button></div> : <div className="archive-list">{activeFragments.filter((fragment) => archived.has(fragment.id)).map((fragment) => <div className="archive-row" key={fragment.id}><Waveform values={fragment.waveform}/><span><b>{fragment.name}</b><small>{sourceNameFor(fragment)} · {fragment.dateLabel}</small></span><em>{fragment.role}</em><button onClick={() => restoreFragment(fragment.id)}>↟ Restore to matching</button></div>)}</div>}
      </section>}

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
