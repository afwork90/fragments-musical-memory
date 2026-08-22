"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_WEIGHTS,
  DEFAULT_TOLERANCES,
  FRAGMENTS,
  IMPORTED_FRAGMENT_IDS,
  RELATIONSHIPS,
  SOURCE_FILES,
  STAGED_SOURCE_ID,
  Fragment,
  MatchTolerances,
  MusicalRole,
  Relationship,
  RelationshipStatus,
  SearchContext,
  SearchWeights,
  SourceFile,
} from "./prototype-data";
import { CombineCandidate, CombineWorkspace, ExportSheet, ImportSheet } from "./hero-workflow";
import { EditableRange, FragmentationWorkbench } from "./fragmentation-workbench";

type View = "library" | "source" | "map" | "archive";
type RangeMode = "reasonable" | "experimental";
type SortColumn = "name" | "source" | "signal" | "date" | "start" | "end" | "duration" | "bars" | "key" | "tempo" | "confidence" | "tags" | "role" | "links" | "takes";
type SortDirection = "asc" | "desc";
type SourceSortColumn = "name" | "signal" | "date" | "duration" | "type" | "profile" | "format" | "device" | "fragments";
type ScoredRelationship = Relationship & { score: number; otherId: string };
type ReturnSnapshot = { kind:"source-edit" | "map-full";view:View;selectedId:string;selectedSourceId:string;connectionsOpen:boolean;advancedOpen:boolean;mapSelectedId:string | null;scrollY:number };
type CorrectionPhase = "edit" | "recompute" | "prompt";

const CONTEXTS: { id: SearchContext; label: string }[] = [
  { id: "whole", label: "Whole" }, { id: "melody", label: "Melody" }, { id: "rhythm", label: "Rhythm" },
  { id: "harmony", label: "Harmony" }, { id: "bass", label: "Bass" },
];
const ROLES: ("All" | MusicalRole)[] = ["All", "Melody", "Rhythm", "Harmony", "Bass", "Voice", "Texture"];
const LIBRARY_COLUMNS: { id:SortColumn; label:string }[] = [
  { id:"name", label:"Fragment" }, { id:"source", label:"Source" }, { id:"signal", label:"Signal" },
  { id:"date", label:"Recorded" }, { id:"start", label:"Start" }, { id:"end", label:"End" }, { id:"duration", label:"Length" },
  { id:"bars", label:"Bars/Beats" }, { id:"key", label:"Key" }, { id:"tempo", label:"BPM" }, { id:"confidence", label:"Confidence" },
  { id:"tags", label:"Tags" }, { id:"role", label:"Role" }, { id:"links", label:"Links" }, { id:"takes", label:"Takes" },
];
const SOURCE_COLUMNS: { id:SourceSortColumn; label:string }[] = [
  { id:"name", label:"Source" }, { id:"signal", label:"Signal" }, { id:"date", label:"Recorded" },
  { id:"duration", label:"Length" }, { id:"type", label:"Type" }, { id:"profile", label:"Profile" }, { id:"format", label:"Format" }, { id:"device", label:"Device" },
  { id:"fragments", label:"Fragments" },
];
const RANGE_COLORS = ["#a99cff","#74d8ff","#ffbc65","#c8fa78","#ff849b","#75e2c2"];
const OPENING_SOURCE_ID = SOURCE_FILES.find((source) => !source.imported)!.id;
const INITIAL_RELATIONSHIP_STATUSES = Object.fromEntries(RELATIONSHIPS.filter((relationship) => relationship.status).map((relationship) => [relationship.id,relationship.status!])) as Record<string,RelationshipStatus>;
const INITIAL_MANUAL_RELATIONSHIP_IDS = new Set(RELATIONSHIPS.filter((relationship) => relationship.status === "manual").map((relationship) => relationship.id));
const GRAPH_POSITIONS = [
  [15,20],[38,16],[64,22],[80,14],[24,42],[49,39],[71,44],[89,36],[12,66],[33,62],[55,66],[76,61],[91,70],[21,84],[44,83],[67,85],[82,88],[54,19],
];

const fragmentById = (id: string) => FRAGMENTS.find((fragment) => fragment.id === id)!;
const sourceNameFor = (fragment:Fragment) => SOURCE_FILES.find((source) => source.id === fragment.sourceId)?.name ?? fragment.source;
const otherIdFor = (relationship: Relationship, selectedId: string) => relationship.source === selectedId ? relationship.target : relationship.source;
const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const fragmentCountForSensitivity = (sensitivity:number) => Math.max(1,Math.min(6,Math.floor((sensitivity - 10) / 16) + 1));

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

function Waveform({ values, active=false, large=false }: { values:number[]; active?:boolean; large?:boolean }) {
  return <div className={`wave ${active ? "active" : ""} ${large ? "large" : ""}`} aria-hidden="true">{values.map((height,index) => <i key={index} style={{ height:`${height}%` }} />)}</div>;
}

function TransformChips({ relationship }: { relationship:Relationship }) {
  return <div className="chips">{(relationship.transform?.labels ?? ["As recorded"]).map((label) => <span key={label}>{label}</span>)}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>("library");
  const [selectedId, setSelectedId] = useState("f02");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<(typeof ROLES)[number]>("All");
  const [sort, setSort] = useState<{ column:SortColumn; direction:SortDirection }>({ column:"date", direction:"desc" });
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
  const [sourceSort, setSourceSort] = useState<{ column:SourceSortColumn; direction:SortDirection }>({ column:"date", direction:"desc" });
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
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
  const returnScroll = useRef(0);
  const returnStack = useRef<ReturnSnapshot[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  const activeFragments = useMemo(() => FRAGMENTS.filter((fragment) => importComplete || !IMPORTED_FRAGMENT_IDS.includes(fragment.id)).map((fragment) => ({ ...fragment,...fragmentOverrides[fragment.id] })),[importComplete,fragmentOverrides]);
  const activeFragmentById = (id:string) => activeFragments.find((fragment) => fragment.id === id) ?? ({ ...fragmentById(id),...fragmentOverrides[id] });
  const selected = activeFragmentById(selectedId);
  const selectedSource = sources.find((source) => source.id === selectedSourceId)!;
  const selectedRanges = sourceRanges[selectedSourceId] ?? [];

  const stopAllAudio = () => {
    if (previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; }
    setPreviewingId(null);
  };

  const navigate = (next:View) => { stopAllAudio();returnStack.current=[];setConnectionsOpen(false);setAdvancedOpen(false);setSourceEditorOpen(false);setCorrectionRelationship(null);setCorrectionPhase("edit");if (next !== "map") setMapSelectedId(null);setView(next); };
  const notify = (message:string) => { setToast(message); window.setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    const handler = (event:KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("library"); window.setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.key === "Escape") { setDuplicateGroup(null); stopAllAudio(); }
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

  const normalizedQuery=query.trim().toLowerCase();
  const visibleFragments=activeFragments.filter((fragment) => !archived.has(fragment.id))
    .filter((fragment) => roleFilter === "All" || fragment.roles.includes(roleFilter))
    .filter((fragment) => !normalizedQuery || `${fragment.name} ${sourceNameFor(fragment)} ${fragment.key} ${fragment.roles.join(" ")} ${fragment.userTags.join(" ")}`.toLowerCase().includes(normalizedQuery))
    .sort((a,b) => {
      const takeCount=(fragment:Fragment) => fragment.duplicateGroup ? activeFragments.filter((item) => item.duplicateGroup === fragment.duplicateGroup && item.id !== fragment.id && !archived.has(item.id) && !duplicateExclusions.has(item.id)).length : 0;
      let comparison=0;
      if (sort.column === "name") comparison=a.name.localeCompare(b.name);
      if (sort.column === "source") comparison=sourceNameFor(a).localeCompare(sourceNameFor(b));
      if (sort.column === "signal") comparison=a.brightness - b.brightness;
      if (sort.column === "date") comparison=a.date.localeCompare(b.date);
      if (sort.column === "start") comparison=a.start - b.start;
      if (sort.column === "end") comparison=a.end - b.end;
      if (sort.column === "duration") comparison=(a.end - a.start) - (b.end - b.start);
      if (sort.column === "bars") comparison=a.bars - b.bars || a.beats - b.beats;
      if (sort.column === "key") comparison=a.key.localeCompare(b.key);
      if (sort.column === "tempo") comparison=a.bpm - b.bpm;
      if (sort.column === "confidence") comparison=a.confidence - b.confidence;
      if (sort.column === "tags") comparison=a.userTags.join(" ").localeCompare(b.userTags.join(" "));
      if (sort.column === "role") comparison=a.role.localeCompare(b.role);
      if (sort.column === "links") comparison=linkSummaryFor(a.id).total - linkSummaryFor(b.id).total;
      if (sort.column === "takes") comparison=takeCount(a) - takeCount(b);
      return sort.direction === "asc" ? comparison : -comparison;
    });

  const changeSort = (column:SortColumn) => setSort((current) => ({
    column,
    direction:current.column === column ? (current.direction === "asc" ? "desc" : "asc") : (["date","signal","tempo","links","takes"].includes(column) ? "desc" : "asc"),
  }));

  const visibleSources = useMemo(() => {
    const normalized = sourceQuery.trim().toLowerCase();
    return sources
      .filter((source) => !normalized || `${source.name} ${source.date} ${source.format} ${source.device}`.toLowerCase().includes(normalized))
      .sort((a,b) => {
        let comparison = 0;
        if (sourceSort.column === "name") comparison = a.name.localeCompare(b.name);
        if (sourceSort.column === "signal") comparison = a.waveform.reduce((sum,value) => sum + value,0) - b.waveform.reduce((sum,value) => sum + value,0);
        if (sourceSort.column === "date") comparison = Date.parse(a.date) - Date.parse(b.date);
        if (sourceSort.column === "duration") comparison = a.duration - b.duration;
        if (sourceSort.column === "type") comparison = a.sourceTypes.join(" ").localeCompare(b.sourceTypes.join(" "));
        if (sourceSort.column === "profile") comparison = a.analysisProfile.name.localeCompare(b.analysisProfile.name);
        if (sourceSort.column === "format") comparison = a.format.localeCompare(b.format);
        if (sourceSort.column === "device") comparison = a.device.localeCompare(b.device);
        if (sourceSort.column === "fragments") comparison = a.fragmentIds.length - b.fragmentIds.length;
        return sourceSort.direction === "asc" ? comparison : -comparison;
      });
  }, [sources, sourceQuery, sourceSort]);

  const changeSourceSort = (column:SourceSortColumn) => setSourceSort((current) => ({
    column,
    direction:current.column === column ? (current.direction === "asc" ? "desc" : "asc") : (["date","signal","duration","fragments"].includes(column) ? "desc" : "asc"),
  }));

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
    stopAllAudio(); setView("library"); setSelectedId("f02"); setQuery(""); setRoleFilter("All"); setSort({ column:"date", direction:"desc" });
    setContext("whole"); setRangeMode("reasonable"); setWeights({ ...DEFAULT_WEIGHTS }); setTolerances({ ...DEFAULT_TOLERANCES });setArchived(new Set()); setDuplicateExclusions(new Set());
    returnStack.current=[];setDuplicateGroup(null);setConnectionsOpen(false);setAdvancedOpen(false);setConnectionsWidth(520);setSources(SOURCE_FILES.filter((source) => !source.imported).map((source) => ({ ...source })));setSourceRanges(initialSourceRanges());setSelectedSourceId(OPENING_SOURCE_ID);setSourceQuery("");setSourceSort({ column:"date",direction:"desc" });setSourceEditorOpen(false);setImportOpen(false);setImportComplete(false);setFragmentOverrides({});setCombineCandidates(null);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);setExportRelationship(null);setRelationshipStatuses({ ...INITIAL_RELATIONSHIP_STATUSES });setManualRelationshipIds(new Set(INITIAL_MANUAL_RELATIONSHIP_IDS));setMapSelectedId(null);setHoveredMapId(null);notify("Demo restored to 24 fragments before import.");
  };
  const pushReturn = (kind:ReturnSnapshot["kind"]) => returnStack.current.push({ kind,view,selectedId,selectedSourceId,connectionsOpen,advancedOpen,mapSelectedId,scrollY:window.scrollY });
  const restoreReturn = (kind:ReturnSnapshot["kind"]) => {
    const snapshot=returnStack.current.at(-1);
    if (!snapshot || snapshot.kind !== kind) return false;
    returnStack.current.pop();stopAllAudio();setView(snapshot.view);setSelectedId(snapshot.selectedId);setSelectedSourceId(snapshot.selectedSourceId);setConnectionsOpen(snapshot.connectionsOpen);setAdvancedOpen(snapshot.advancedOpen);setMapSelectedId(snapshot.mapSelectedId);setSourceEditorOpen(false);window.setTimeout(() => window.scrollTo({ top:snapshot.scrollY }),0);return true;
  };
  const openFragment = (id:string) => { stopAllAudio(); setSelectedId(id); setConnectionsOpen(true); setAdvancedOpen(false); setView("library"); };
  const openFragmentFromMap = (id:string) => { pushReturn("map-full");openFragment(id); };
  const closeConnections = () => { if (restoreReturn("map-full")) return;stopAllAudio();setConnectionsOpen(false);setAdvancedOpen(false); };
  const closeSourceEditor = () => {
    if (correctionRelationship) { setSourceEditorOpen(false);setCorrectionRelationship(null);setCorrectionPhase("edit");setCorrectionOriginal(null);setCombineDraftRanges(null);setCombineDraftSensitivity(null);return; }
    if (restoreReturn("source-edit")) return;
    stopAllAudio();setSourceEditorOpen(false);
  };
  const editSourceForFragment = (id:string) => { const fragment=activeFragmentById(id);pushReturn("source-edit");stopAllAudio();setSelectedSourceId(fragment.sourceId);setSourceEditorOpen(true);setConnectionsOpen(false);setAdvancedOpen(false);setView("source"); };
  const completeImport = () => {
    setImportComplete(true);setImportOpen(false);setSources(SOURCE_FILES.map((source) => ({ ...source })));setSourceRanges(initialSourceRanges());setSelectedSourceId(STAGED_SOURCE_ID);
    setView("library");setQuery("Balcony");setSelectedId("f01");setConnectionsOpen(false);notify("4 fragment references added. Select one to find connections.");
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
  const mapFragment=mapSelectedId ? activeFragments.find((fragment) => fragment.id === mapSelectedId) ?? null : null;
  const mapConnections=mapFragment ? rankedConnectionsFor(mapFragment.id,4) : [];
  const mapLinks=mapFragment ? linkSummaryFor(mapFragment.id) : { total:0,manual:0 };
  const mapTakes=mapFragment?.duplicateGroup ? activeFragments.filter((fragment) => fragment.duplicateGroup === mapFragment.duplicateGroup && fragment.id !== mapFragment.id && !archived.has(fragment.id) && !duplicateExclusions.has(fragment.id)).length : 0;
  const graphY=(value:number) => 8 + value * .68;
  const editorRanges=correctionRelationship ? (combineDraftRanges ?? []) : selectedRanges;
  const editorSensitivity=correctionRelationship ? (combineDraftSensitivity ?? selectedSource.sensitivity) : selectedSource.sensitivity;
  const correctedRange=correctionRelationship ? editorRanges.find((range) => range.fragmentId === correctionRelationship.otherId) : null;
  const correctionFooter=correctionRelationship && correctionPhase === "recompute" ? <div className="recompute workbench-result"><i/><strong>Recomputing metadata and active match…</strong><span>Revision {(correctionOriginal?.analysisRevision ?? 1) + 1}</span></div> : correctionRelationship && correctionPhase === "prompt" && correctionOriginal ? <div className="correction-result workbench-result"><div className="metadata-diff"><span>Field</span><span>Before</span><span>After</span>{[["Duration",correctionOriginal.duration,formatSeconds((correctedRange?.end ?? 0) - (correctedRange?.start ?? 0))],["Key",correctionOriginal.key,"C minor"],["BPM",correctionOriginal.bpm,"90"],["Bars",correctionOriginal.bars,"3"],["Beats",correctionOriginal.beats,"17"],["Confidence",`${Math.round(correctionOriginal.confidence * 100)}%`,`93%`],["Match",`${correctionRelationship.score}%`,`76%`]].map((row) => row.map((cell,index) => <span className={index === 2 ? "changed" : ""} key={`${row[0]}-${index}`}>{cell}</span>))}</div><div className="link-prompt"><span className="relationship-badge manual">criteria changed</span><h3>This fragment no longer matches the original search. Keep it linked to this comparison?</h3><p>The boundary correction is saved either way. A manual link preserves your musical judgment.</p><div><button onClick={rejectCorrectionLink}>Reject and show next</button><button className="primary-button" onClick={keepCorrectionLink}>Yes, keep linked</button></div></div></div> : null;
  const fragmentationPanel=sourceEditorOpen ? <FragmentationWorkbench source={selectedSource} ranges={editorRanges} fragments={activeFragments} sensitivity={editorSensitivity} focusedFragmentId={correctionRelationship?.otherId} onRangesChange={(ranges) => correctionRelationship ? setCombineDraftRanges(ranges) : setSourceRanges((current) => ({ ...current,[selectedSource.id]:ranges }))} onSensitivityChange={correctionRelationship ? updateCombineSensitivity : updateSourceSensitivity} onAddRange={correctionRelationship ? addCombineFragment : addManualFragment} onSave={correctionRelationship ? saveCombineSourceBoundaries : saveSourceBoundaries} onClose={closeSourceEditor} onOpenFragment={correctionRelationship ? undefined : (id) => { setSourceEditorOpen(false);openFragment(id); }} saveLabel={correctionRelationship ? "Save & recompute" : "Save boundaries"} footerContent={correctionFooter}/> : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate("library")} aria-label="Fragments home"><span className="brand-mark">F</span><span>Fragments</span></button>
        <nav aria-label="Primary">
          <button className={view === "library" ? "nav-active" : ""} onClick={() => navigate("library")}>Library</button>
          <button className={view === "source" ? "nav-active" : ""} onClick={() => navigate("source")}>Sources</button>
          <button className={view === "map" ? "nav-active" : ""} onClick={() => navigate("map")}>Map</button>
          <button className={view === "archive" ? "nav-active" : ""} onClick={() => navigate("archive")}>Archive {archived.size > 0 && <b>{archived.size}</b>}</button>
        </nav>
        <div className="index-status"><span /><small>{activeFragments.length} surfaced · 2,418 indexed</small></div>
        <button className="reset" onClick={resetDemo}>↺ Reset demo</button>
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

      {!combineCandidates && view === "library" && <section className={`workspace ${connectionsOpen ? "connections-open" : ""} ${resizingConnections ? "resizing" : ""}`} style={{ "--connections-width":`${connectionsWidth}px` } as CSSProperties}>
        <div className="library">
          <div className="panel-titlebar"><h1>Fragments</h1></div>
          <div className="toolbar">
            <div className="filter-row" aria-label="Filter by musical role">{ROLES.map((role) => <button key={role} className={roleFilter === role ? "filter-active" : ""} onClick={() => setRoleFilter(role)}>{role === "All" ? "All fragments" : role}</button>)}</div>
            <label className="search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search fragments" /><kbd>⌘ K</kbd></label>
          </div>
          <div className="table" role="table" aria-label="Fragment library">
            <div className="table-row table-header" role="row">{LIBRARY_COLUMNS.map((column) => <span role="columnheader" aria-sort={sort.column === column.id ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} key={column.id}><button onClick={() => changeSort(column.id)} aria-label={`Sort by ${column.label}${sort.column === column.id ? `, currently ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`}>{column.label}<i aria-hidden="true">{sort.column === column.id ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</i></button></span>)}</div>
            {visibleFragments.map((fragment) => {
              const relatedTakes = fragment.duplicateGroup ? activeFragments.filter((item) => item.duplicateGroup === fragment.duplicateGroup && item.id !== fragment.id && !archived.has(item.id) && !duplicateExclusions.has(item.id)).length : 0;
              const links=linkSummaryFor(fragment.id);
              return <div key={fragment.id} className={`table-row fragment-row ${connectionsOpen && selectedId === fragment.id ? "selected" : ""} ${links.total > 0 ? "" : "no-connections"}`} role="row" tabIndex={0} onClick={() => openFragment(fragment.id)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFragment(fragment.id); } }}>
                <span className="track-name"><b>{fragment.name}</b></span>
                <span className="source-cell" title={sourceNameFor(fragment)}>{sourceNameFor(fragment)}</span>
                <button className={`wave-play ${previewingId === fragment.id ? "playing" : ""}`} onClick={(event) => { event.stopPropagation(); previewSingle(fragment); }} aria-label={`${previewingId === fragment.id ? "Stop" : "Play"} ${fragment.name}`}><Waveform values={fragment.waveform} active={previewingId === fragment.id} /></button>
                <span className="date-cell">{fragment.dateLabel}</span>
                <span>{formatSeconds(fragment.start)}</span><span>{formatSeconds(fragment.end)}</span>
                <span className="duration-cell">{formatSeconds(fragment.end - fragment.start)}</span>
                <span className="bars-cell">{fragment.bars} / {fragment.beats}</span>
                <span className="key-cell" title={fragment.alternateKeys.length ? `Also: ${fragment.alternateKeys.join(", ")}` : fragment.key}>{fragment.key}{fragment.alternateKeys.length > 0 && <small>+{fragment.alternateKeys.length}</small>}</span>
                <span className="tempo-cell">{fragment.bpm}</span><span className="confidence-cell">{Math.round(fragment.confidence * 100)}%</span><span className="tags-cell" title={fragment.userTags.join(", ")}>{fragment.userTags.join(" · ")}</span><span className="role-cell"><em>{fragment.role}</em></span>
                <span className="links-cell"><b>{links.total}</b>{links.manual > 0 && <em>Manual links {links.manual}</em>}</span>
                <span className="takes-cell">{relatedTakes > 0 ? <button className="take-link" onClick={(event) => { event.stopPropagation();setSelectedId(fragment.id);setDuplicateGroup(fragment.duplicateGroup!); }}>{relatedTakes + 1}</button> : "—"}</span>
              </div>;
            })}
            {visibleFragments.length === 0 && <div className="empty-inline">No fragments match that search.</div>}
          </div>
        </div>

        {connectionsOpen && <aside className="connections">
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
      </section>}

      {!combineCandidates && view === "source" && <section className="page-view source-page">
        <div className={`source-workspace ${sourceEditorOpen ? "editor-open" : ""}`}>
          <div className="sources-panel">
            <div className="panel-titlebar"><h1>Sources</h1></div>
            <div className="sources-toolbar"><button className="import-button" onClick={() => importComplete ? notify("The staged recording is already imported. Reset to replay it.") : setImportOpen(true)}>{importComplete ? "✓ Imported" : "＋ Import"}</button><label className="search"><span aria-hidden="true">⌕</span><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search" aria-label="Search sources" /></label></div>
            <div className="source-table" role="table" aria-label="Source files">
              <div className="source-table-row source-table-header" role="row">{SOURCE_COLUMNS.map((column) => <span role="columnheader" aria-sort={sourceSort.column === column.id ? (sourceSort.direction === "asc" ? "ascending" : "descending") : "none"} key={column.id}><button onClick={() => changeSourceSort(column.id)}>{column.label}<i aria-hidden="true">{sourceSort.column === column.id ? (sourceSort.direction === "asc" ? "↑" : "↓") : "↕"}</i></button></span>)}</div>
              {visibleSources.map((source) => { const auditionId = source.fragmentIds[0]; return <div className={`source-table-row ${sourceEditorOpen && selectedSourceId === source.id ? "selected" : ""}`} role="row" tabIndex={0} key={source.id} onClick={() => { stopAllAudio(); setSelectedSourceId(source.id); setSourceEditorOpen(true); }} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); stopAllAudio(); setSelectedSourceId(source.id); setSourceEditorOpen(true); } }}>
                <span className="source-name-cell" title={source.name}><b>{source.name}</b></span>
                <button className={`wave-play ${previewingId === auditionId ? "playing" : ""}`} onClick={(event) => { event.stopPropagation(); previewSingle(fragmentById(auditionId)); }} aria-label={`${previewingId === auditionId ? "Stop" : "Play"} ${source.name}`}><Waveform values={source.waveform.slice(0,36)} active={previewingId === auditionId} /></button>
                <span>{source.date}</span><span>{formatSeconds(source.duration)}</span><span title={source.sourceTypes.join(", ")}>{source.sourceTypes.join(" · ")}</span><span title={`${source.analysisProfile.detectors.join(", ")} · ${source.analysisProfile.tempoStrategy}`}>{source.analysisProfile.name}</span><span title={source.format}>{source.format.split(" · ")[0]}</span><span title={source.device}>{source.device}</span><span>{sourceRanges[source.id]?.length ?? 0}</span>
              </div>; })}
              {visibleSources.length === 0 && <div className="empty-inline">No sources match that search.</div>}
            </div>
          </div>
          {sourceEditorOpen && fragmentationPanel}
        </div>
      </section>}

      {!combineCandidates && view === "map" && <section className="page-view map-page">
        <div className="panel-titlebar map-heading"><h1>Map</h1><div className="map-legend"><span><i className="dot violet"/>Direct affinity</span><span><i className="line amber"/>Transformed bridge</span><span><i className="dot lime"/>Selected idea</span></div></div>
        <div className="graph-board">
          <div className="cluster-label cluster-one">VOICE & MELODY</div><div className="cluster-label cluster-two">POCKET & RHYTHM</div><div className="cluster-label cluster-three">HARMONIC WORLDS</div>
          {RELATIONSHIPS.map((relationship) => {
            const aIndex=activeFragments.slice(0,18).findIndex((fragment) => fragment.id === relationship.source); const bIndex=activeFragments.slice(0,18).findIndex((fragment) => fragment.id === relationship.target);
            if (aIndex < 0 || bIndex < 0 || archived.has(relationship.source) || archived.has(relationship.target)) return null;
            const [ax,rawAy]=GRAPH_POSITIONS[aIndex], [bx,rawBy]=GRAPH_POSITIONS[bIndex];const ay=graphY(rawAy),by=graphY(rawBy); const dx=bx-ax, dy=by-ay; const width=Math.sqrt(dx*dx+dy*dy); const angle=Math.atan2(dy,dx)*180/Math.PI;const highlighted=hoveredMapId === relationship.source || hoveredMapId === relationship.target;
            return <i key={relationship.id} className={`graph-line ${relationship.transformationCost > .1 ? "bridge" : ""} ${highlighted ? "highlighted" : ""}`} style={{ left:`${ax}%`, top:`${ay}%`, width:`${width}%`, transform:`rotate(${angle}deg)` }} />;
          })}
          {activeFragments.slice(0,18).map((fragment,index) => { const shortName=fragment.name.length > 19 ? `${fragment.name.slice(0,18)}…` : fragment.name;return archived.has(fragment.id) ? null : <button key={fragment.id} title={fragment.name} className={`graph-node role-${fragment.role.toLowerCase()} ${mapSelectedId === fragment.id ? "selected" : ""}`} style={{ left:`${GRAPH_POSITIONS[index][0]}%`, top:`${graphY(GRAPH_POSITIONS[index][1])}%` }} onMouseEnter={() => setHoveredMapId(fragment.id)} onMouseLeave={() => setHoveredMapId(null)} onFocus={() => setHoveredMapId(fragment.id)} onBlur={() => setHoveredMapId(null)} onClick={() => { stopAllAudio();setSelectedId(fragment.id);setMapSelectedId(fragment.id); }} aria-label={`Inspect ${fragment.name}`}><i/><span>{shortName}</span><small>{fragment.name}</small></button>; })}
          {mapFragment && <section className="map-inspector" aria-label={`Map details for ${mapFragment.name}`}>
            <button className="map-inspector-close" onClick={() => { stopAllAudio();setMapSelectedId(null); }} aria-label="Close map details">×</button>
            <div className="map-fragment-mini" role="row"><button className={`wave-play ${previewingId === mapFragment.id ? "playing" : ""}`} onClick={() => previewSingle(mapFragment)} aria-label={`${previewingId === mapFragment.id ? "Stop" : "Play"} ${mapFragment.name}`}><Waveform values={mapFragment.waveform} active={previewingId === mapFragment.id}/></button><span><b>{mapFragment.name}</b><small>{sourceNameFor(mapFragment)}</small></span><em>{mapFragment.key}</em><em>{mapFragment.bpm} BPM</em><em>{mapFragment.role}</em><span className="map-link-count"><b>{mapLinks.total} links</b>{mapLinks.manual > 0 && <i>Manual links {mapLinks.manual}</i>}</span><span>{mapTakes > 0 ? `${mapTakes + 1} takes` : "—"}</span></div>
            <div className="map-connections-mini"><header><b>Connections</b><button onClick={() => openFragmentFromMap(mapFragment.id)}>Open full view →</button></header>{mapConnections.map((relationship) => { const target=activeFragmentById(relationship.otherId);return <div className="map-connection-mini" key={relationship.id}><strong>{relationship.score}%</strong><button className={`wave-play ${previewingId === target.id ? "playing" : ""}`} onClick={() => previewSingle(target)} aria-label={`${previewingId === target.id ? "Stop" : "Play"} ${target.name}`}><Waveform values={target.waveform} active={previewingId === target.id}/></button><button className="map-target" onClick={() => { stopAllAudio();setSelectedId(target.id);setMapSelectedId(target.id); }}>{target.name}</button><TransformChips relationship={relationship}/></div>;})}{mapConnections.length === 0 && <p>No active connections under the current criteria.</p>}</div>
          </section>}
        </div>
      </section>}

      {!combineCandidates && view === "archive" && <section className="page-view archive-page">
        <div className="panel-titlebar"><h1>Archive</h1></div>
        {archived.size === 0 ? <div className="empty-state"><span>◌</span><h2>Nothing archived yet</h2><p>When you tidy alternate takes, they remain safely recoverable here.</p><button onClick={() => navigate("library")}>Return to library</button></div> : <div className="archive-list">{activeFragments.filter((fragment) => archived.has(fragment.id)).map((fragment) => <div className="archive-row" key={fragment.id}><Waveform values={fragment.waveform}/><span><b>{fragment.name}</b><small>{sourceNameFor(fragment)} · {fragment.dateLabel}</small></span><em>{fragment.role}</em><button onClick={() => restoreFragment(fragment.id)}>↟ Restore to matching</button></div>)}</div>}
      </section>}

      {duplicateGroup && <div className="modal-backdrop" role="presentation"><section className="duplicate-modal" role="dialog" aria-modal="true" aria-label="Manage related takes">
        <header><h2>Takes</h2><button className="modal-close" onClick={() => { setDuplicateGroup(null); stopAllAudio(); }} aria-label="Close takes">×</button></header>
        <div className="duplicate-list">{selectedDuplicates.map((fragment,index) => <div className={`duplicate-row ${fragment.id === selectedId ? "current" : ""}`} key={fragment.id}><button className="round-play" onClick={() => previewSingle(fragment)}>{previewingId === fragment.id ? "Ⅱ" : "▶"}</button><Waveform values={fragment.waveform} active={previewingId === fragment.id}/><span><b>{fragment.name}</b><small>{fragment.dateLabel} · {fragment.duration} {index === 0 && "· strongest recording"}</small></span><div className="duplicate-actions"><button onClick={() => { setDuplicateExclusions((current) => new Set([...current,fragment.id])); notify("Marked as a separate idea."); }}>Not a duplicate</button><button onClick={() => archiveFragment(fragment.id)}>Archive</button></div><button className="keep-button" onClick={() => keepTake(fragment.id)}>Keep this for matching</button></div>)}</div>
        <footer><span>No cleanup is required. Fragments will keep working either way.</span><button onClick={() => setDuplicateGroup(null)}>Done</button></footer>
      </section></div>}

      {importOpen && <ImportSheet source={SOURCE_FILES.find((source) => source.id === STAGED_SOURCE_ID)!} onCancel={() => setImportOpen(false)} onComplete={completeImport}/>} 
      {exportRelationship && (() => { const candidate=activeFragmentById(exportRelationship.otherId);return <ExportSheet anchor={selected} candidate={candidate} relationship={exportRelationship} onClose={() => setExportRelationship(null)} onSaved={() => { markRelationship(exportRelationship,"preferred");setExportRelationship(null);notify("Package ready and relationship marked Preferred."); }}/>; })()}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
