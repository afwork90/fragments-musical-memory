"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { CombineCandidate, CombineWorkspace, CorrectionOverlay, ExportSheet, ImportSheet } from "./hero-workflow";

type View = "library" | "source" | "map" | "archive";
type RangeMode = "reasonable" | "experimental";
type SortColumn = "name" | "source" | "signal" | "date" | "start" | "end" | "duration" | "bars" | "key" | "tempo" | "confidence" | "tags" | "role" | "takes";
type SortDirection = "asc" | "desc";
type SourceSortColumn = "name" | "signal" | "date" | "duration" | "type" | "profile" | "format" | "device" | "fragments";
type ScoredRelationship = Relationship & { score: number; otherId: string };
type EditableRange = { id:string; start:number; end:number; color:string };
type DraggedEdge = { sourceId:string; rangeId:string; edge:"start" | "end" };

const CONTEXTS: { id: SearchContext; label: string }[] = [
  { id: "whole", label: "Whole" }, { id: "melody", label: "Melody" }, { id: "rhythm", label: "Rhythm" },
  { id: "harmony", label: "Harmony" }, { id: "bass", label: "Bass" },
];
const ROLES: ("All" | MusicalRole)[] = ["All", "Melody", "Rhythm", "Harmony", "Bass", "Voice", "Texture"];
const LIBRARY_COLUMNS: { id:SortColumn; label:string }[] = [
  { id:"name", label:"Fragment" }, { id:"source", label:"Source" }, { id:"signal", label:"Signal" },
  { id:"date", label:"Recorded" }, { id:"start", label:"Start" }, { id:"end", label:"End" }, { id:"duration", label:"Length" },
  { id:"bars", label:"Bars/Beats" }, { id:"key", label:"Key" }, { id:"tempo", label:"BPM" }, { id:"confidence", label:"Confidence" },
  { id:"tags", label:"Tags" }, { id:"role", label:"Role" }, { id:"takes", label:"Takes" },
];
const SOURCE_COLUMNS: { id:SourceSortColumn; label:string }[] = [
  { id:"name", label:"Source" }, { id:"signal", label:"Signal" }, { id:"date", label:"Recorded" },
  { id:"duration", label:"Length" }, { id:"type", label:"Type" }, { id:"profile", label:"Profile" }, { id:"format", label:"Format" }, { id:"device", label:"Device" },
  { id:"fragments", label:"Fragments" },
];
const RANGE_COLORS = ["#a99cff","#74d8ff","#ffbc65","#c8fa78","#ff849b","#75e2c2"];
const OPENING_SOURCE_ID = SOURCE_FILES.find((source) => !source.imported)!.id;
const CONNECTED_FRAGMENT_IDS = new Set(RELATIONSHIPS.flatMap((relationship) => [relationship.source,relationship.target]));
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
  if (referenced) return { id:`${source.id}-range-${index + 1}`,start:referenced.start,end:referenced.end,color:RANGE_COLORS[index % RANGE_COLORS.length] };
  if (index === 0) return { id:`${source.id}-range-1`, start:source.start, end:source.end, color:RANGE_COLORS[0] };
  const length = Math.max(8,Math.min(32,source.duration * (.12 + (index % 3) * .025)));
  const proposed = source.start + index * source.duration * .105 - (index % 2 ? source.duration * .028 : 0);
  const start = Math.max(0,Math.min(source.duration - length,proposed));
  return { id:`${source.id}-range-${index + 1}`, start, end:start + length, color:RANGE_COLORS[index % RANGE_COLORS.length] };
}

const initialSourceRanges = () => Object.fromEntries(SOURCE_FILES.map((source) => [source.id,Array.from({ length:fragmentCountForSensitivity(source.sensitivity) },(_,index) => rangeForIndex(source,index))]));

function waveformPath(values:number[],width=1000,height=160) {
  const middle = height / 2;
  const upper = values.map((value,index) => `${index ? "L" : "M"}${index / Math.max(1,values.length - 1) * width},${middle - value / 100 * middle * .88}`).join(" ");
  const lower = [...values].reverse().map((value,reverseIndex) => { const index=values.length - 1 - reverseIndex; return `L${index / Math.max(1,values.length - 1) * width},${middle + value / 100 * middle * .88}`; }).join(" ");
  return `${upper} ${lower} Z`;
}

function waveformSlice(values:number[],time:number,duration:number) {
  const center = Math.round(time / duration * (values.length - 1));
  const start = Math.max(0,center - 5);
  const slice = values.slice(start,Math.min(values.length,center + 6));
  return slice.length > 2 ? slice : values;
}

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

function ContinuousWaveform({ values, className="" }: { values:number[]; className?:string }) {
  return <svg className={`continuous-wave ${className}`} viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true"><path d={waveformPath(values)} /></svg>;
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
  const [draggedEdge, setDraggedEdge] = useState<DraggedEdge | null>(null);
  const [magnifier, setMagnifier] = useState<{ x:number; time:number; edge:"start" | "end" } | null>(null);
  const [importOpen,setImportOpen] = useState(false);
  const [importComplete,setImportComplete] = useState(false);
  const [fragmentOverrides,setFragmentOverrides] = useState<Record<string,Partial<Fragment>>>({});
  const [combineCandidates,setCombineCandidates] = useState<CombineCandidate[] | null>(null);
  const [correctionRelationship,setCorrectionRelationship] = useState<CombineCandidate | null>(null);
  const [exportRelationship,setExportRelationship] = useState<CombineCandidate | null>(null);
  const [relationshipStatuses,setRelationshipStatuses] = useState<Record<string,RelationshipStatus>>({});
  const returnScroll = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const sourceWaveRef = useRef<HTMLDivElement>(null);
  const sensitivityDrag = useRef<{ y:number; value:number } | null>(null);

  const activeFragments = useMemo(() => FRAGMENTS.filter((fragment) => importComplete || !IMPORTED_FRAGMENT_IDS.includes(fragment.id)).map((fragment) => ({ ...fragment,...fragmentOverrides[fragment.id] })),[importComplete,fragmentOverrides]);
  const activeFragmentById = (id:string) => activeFragments.find((fragment) => fragment.id === id) ?? ({ ...fragmentById(id),...fragmentOverrides[id] });
  const selected = activeFragmentById(selectedId);
  const selectedSource = sources.find((source) => source.id === selectedSourceId)!;
  const selectedRanges = sourceRanges[selectedSourceId] ?? [];

  const stopAllAudio = () => {
    if (previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; }
    setPreviewingId(null);
  };

  const navigate = (next:View) => { stopAllAudio(); setConnectionsOpen(false); setAdvancedOpen(false); setSourceEditorOpen(false); setView(next); };
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

  useEffect(() => {
    if (!draggedEdge) return;
    const move = (event:PointerEvent) => {
      const rect = sourceWaveRef.current?.getBoundingClientRect();
      const source = sources.find((item) => item.id === draggedEdge.sourceId);
      if (!rect || !source) return;
      const x = Math.max(0,Math.min(rect.width,event.clientX - rect.left));
      const time = x / rect.width * source.duration;
      setSourceRanges((current) => ({ ...current,[source.id]:(current[source.id] ?? []).map((range) => {
        if (range.id !== draggedEdge.rangeId) return range;
        return draggedEdge.edge === "start" ? { ...range,start:Math.max(0,Math.min(time,range.end - .5)) } : { ...range,end:Math.min(source.duration,Math.max(time,range.start + .5)) };
      }) }));
      setMagnifier({ x,time,edge:draggedEdge.edge });
    };
    const finish = () => { setDraggedEdge(null); setMagnifier(null); };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",finish,{ once:true });
    return () => { window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",finish); };
  }, [draggedEdge,sources]);

  const visibleFragments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = activeFragments.filter((fragment) => !archived.has(fragment.id))
      .filter((fragment) => roleFilter === "All" || fragment.roles.includes(roleFilter))
      .filter((fragment) => !normalized || `${fragment.name} ${sourceNameFor(fragment)} ${fragment.key} ${fragment.roles.join(" ")} ${fragment.userTags.join(" ")}`.toLowerCase().includes(normalized));
    return [...filtered].sort((a,b) => {
      const takeCount = (fragment:Fragment) => fragment.duplicateGroup ? FRAGMENTS.filter((item) => item.duplicateGroup === fragment.duplicateGroup && item.id !== fragment.id && !archived.has(item.id) && !duplicateExclusions.has(item.id)).length : 0;
      let comparison = 0;
      if (sort.column === "name") comparison = a.name.localeCompare(b.name);
      if (sort.column === "source") comparison = sourceNameFor(a).localeCompare(sourceNameFor(b));
      if (sort.column === "signal") comparison = a.brightness - b.brightness;
      if (sort.column === "date") comparison = a.date.localeCompare(b.date);
      if (sort.column === "start") comparison = a.start - b.start;
      if (sort.column === "end") comparison = a.end - b.end;
      if (sort.column === "duration") comparison = (a.end - a.start) - (b.end - b.start);
      if (sort.column === "bars") comparison = a.bars - b.bars || a.beats - b.beats;
      if (sort.column === "key") comparison = a.key.localeCompare(b.key);
      if (sort.column === "tempo") comparison = a.bpm - b.bpm;
      if (sort.column === "confidence") comparison = a.confidence - b.confidence;
      if (sort.column === "tags") comparison = a.userTags.join(" ").localeCompare(b.userTags.join(" "));
      if (sort.column === "role") comparison = a.role.localeCompare(b.role);
      if (sort.column === "takes") comparison = takeCount(a) - takeCount(b);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [activeFragments, query, roleFilter, sort, archived, duplicateExclusions]);

  const changeSort = (column:SortColumn) => setSort((current) => ({
    column,
    direction:current.column === column ? (current.direction === "asc" ? "desc" : "asc") : (["date","signal","tempo","takes"].includes(column) ? "desc" : "asc"),
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

  const updateRangeEdge = (sourceId:string,rangeId:string,edge:"start" | "end",value:number) => {
    const source=sources.find((item) => item.id === sourceId); if (!source) return;
    setSourceRanges((current) => ({ ...current,[sourceId]:(current[sourceId] ?? []).map((range) => range.id !== rangeId ? range : edge === "start" ? { ...range,start:Math.max(0,Math.min(value,range.end - .5)) } : { ...range,end:Math.min(source.duration,Math.max(value,range.start + .5)) }) }));
  };

  const beginRangeDrag = (event:ReactPointerEvent,range:EditableRange,edge:"start" | "end") => {
    event.preventDefault(); event.stopPropagation();
    const rect=sourceWaveRef.current?.getBoundingClientRect();
    const time=edge === "start" ? range.start : range.end;
    setMagnifier({ x:rect ? time / selectedSource.duration * rect.width : 0,time,edge });
    setDraggedEdge({ sourceId:selectedSourceId,rangeId:range.id,edge });
  };

  const updateSourceSensitivity = (value:number) => {
    setSources((current) => current.map((source) => source.id === selectedSourceId ? { ...source,sensitivity:value } : source));
    setSourceRanges((current) => {
      const existing=current[selectedSourceId] ?? [];
      const count=fragmentCountForSensitivity(value);
      const next=count <= existing.length ? existing.slice(0,count) : [...existing,...Array.from({ length:count - existing.length },(_,offset) => rangeForIndex(selectedSource,existing.length + offset))];
      return { ...current,[selectedSourceId]:next };
    });
  };

  const beginSensitivityDrag = (event:ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sensitivityDrag.current={ y:event.clientY,value:selectedSource.sensitivity };
  };
  const moveSensitivityDrag = (event:ReactPointerEvent<HTMLButtonElement>) => {
    if (!sensitivityDrag.current) return;
    updateSourceSensitivity(Math.max(10,Math.min(90,Math.round(sensitivityDrag.current.value + (sensitivityDrag.current.y - event.clientY) * .75))));
  };
  const finishSensitivityDrag = (event:ReactPointerEvent<HTMLButtonElement>) => {
    sensitivityDrag.current=null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const addManualFragment = () => {
    const index=selectedRanges.length;
    const next={ ...rangeForIndex(selectedSource,index),id:`${selectedSource.id}-manual-${Date.now()}` };
    setSourceRanges((current) => ({ ...current,[selectedSource.id]:[...(current[selectedSource.id] ?? []),next] }));
    notify(`Fragment ${index + 1} added. Adjust its range above.`);
  };

  const connections = useMemo<ScoredRelationship[]>(() => {
    const sourceRelationships = RELATIONSHIPS.filter((relationship) => relationship.source === selectedId || relationship.target === selectedId);
    const seen = new Set<string>();
    return sourceRelationships
      .map((relationship) => {
        const correctedHero=relationship.id === "r01" && Boolean(fragmentOverrides.f02?.analysisRevision);
        const effectiveRelationship=correctedHero && relationship.transform ? { ...relationship,transform:{ ...relationship.transform,bpm:2,labels:["−3 st","+2 BPM"] } } : relationship;
        const score=correctedHero ? 76 : relationship.id === "r01" && context === "whole" && rangeMode === "reasonable" && Object.keys(DEFAULT_WEIGHTS).every((key) => weights[key as keyof SearchWeights] === DEFAULT_WEIGHTS[key as keyof SearchWeights]) ? 94 : scoreRelationship(effectiveRelationship, weights, context, rangeMode);
        return { ...effectiveRelationship,score,otherId:otherIdFor(effectiveRelationship,selectedId) };
      })
      .filter((relationship) => {
        const target = activeFragments.find((fragment) => fragment.id === relationship.otherId) ?? fragmentById(relationship.otherId);
        if (!activeFragments.some((fragment) => fragment.id === target.id)) return false;
        if (seen.has(relationship.otherId) || archived.has(relationship.otherId)) return false;
        if (selected.duplicateGroup && target.duplicateGroup === selected.duplicateGroup) return false;
        if (rangeMode === "reasonable" && (relationship.experimental || relationship.transformationCost > .12)) return false;
        const transformedBpm=target.bpm + (relationship.transform?.bpm ?? 0);
        if (Math.abs(transformedBpm - selected.bpm) / Math.max(1,selected.bpm) * 100 > tolerances.tempoWindow) return false;
        const pitchFloor=tolerances.keyFlexibility === "exact" ? .96 : tolerances.keyFlexibility === "related" ? .78 : .62;
        if (relationship.metrics.pitch < pitchFloor) return false;
        const barDelta=Math.abs(target.bars - selected.bars);
        if (tolerances.lengthTolerance === "same" && barDelta !== 0) return false;
        if (tolerances.lengthTolerance === "one" && barDelta > 1) return false;
        if (!tolerances.allowRepetition && (relationship.transform?.repeat ?? 1) > 1) return false;
        seen.add(relationship.otherId); return true;
      })
      .sort((a,b) => b.score - a.score)
      .slice(0, 6);
  }, [selectedId, weights, context, rangeMode, archived, selected.duplicateGroup,selected.bpm,selected.bars,tolerances,activeFragments,fragmentOverrides]);

  const selectedDuplicates = duplicateGroup ? activeFragments.filter((fragment) => fragment.duplicateGroup === duplicateGroup && !duplicateExclusions.has(fragment.id)) : [];

  const previewSingle = (fragment:Fragment) => {
    if (previewingId === fragment.id && previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; setPreviewingId(null); return; }
    stopAllAudio();
    const audio = new Audio(fragment.audio); audio.loop = true; audio.volume = .72; previewAudio.current = audio; setPreviewingId(fragment.id);
    audio.play().catch(() => notify("Playback needs one more click in this browser."));
  };

  const archiveFragment = (id:string) => {
    stopAllAudio(); setArchived((current) => new Set([...current, id]));
    if (id === selectedId) setSelectedId("f01");
    notify("Archived from ordinary matching. You can restore it anytime.");
  };
  const restoreFragment = (id:string) => { setArchived((current) => { const next = new Set(current); next.delete(id); return next; }); notify("Fragment restored to matching."); };
  const keepTake = (id:string) => {
    const group = fragmentById(id).duplicateGroup;
    if (!group) return;
    const others = FRAGMENTS.filter((fragment) => fragment.duplicateGroup === group && fragment.id !== id).map((fragment) => fragment.id);
    setArchived((current) => new Set([...current, ...others])); setSelectedId(id); setDuplicateGroup(null); notify("Kept this take for matching and archived the rest.");
  };
  const resetDemo = () => {
    stopAllAudio(); setView("library"); setSelectedId("f02"); setQuery(""); setRoleFilter("All"); setSort({ column:"date", direction:"desc" });
    setContext("whole"); setRangeMode("reasonable"); setWeights({ ...DEFAULT_WEIGHTS }); setTolerances({ ...DEFAULT_TOLERANCES });setArchived(new Set()); setDuplicateExclusions(new Set());
    setDuplicateGroup(null); setConnectionsOpen(false); setAdvancedOpen(false); setConnectionsWidth(520); setSources(SOURCE_FILES.filter((source) => !source.imported).map((source) => ({ ...source }))); setSourceRanges(initialSourceRanges()); setSelectedSourceId(OPENING_SOURCE_ID); setSourceQuery(""); setSourceSort({ column:"date", direction:"desc" }); setSourceEditorOpen(false); setDraggedEdge(null); setMagnifier(null);setImportOpen(false);setImportComplete(false);setFragmentOverrides({});setCombineCandidates(null);setCorrectionRelationship(null);setExportRelationship(null);setRelationshipStatuses({}); notify("Demo restored to 24 fragments before import.");
  };
  const openFragment = (id:string) => { stopAllAudio(); setSelectedId(id); setConnectionsOpen(true); setAdvancedOpen(false); setView("library"); };
  const closeConnections = () => { stopAllAudio(); setConnectionsOpen(false); setAdvancedOpen(false); };
  const editSourceForFragment = (id:string) => { const fragment=activeFragmentById(id);stopAllAudio();setSelectedSourceId(fragment.sourceId);setSourceEditorOpen(true);setConnectionsOpen(false);setAdvancedOpen(false);setView("source"); };
  const completeImport = () => {
    setImportComplete(true);setImportOpen(false);setSources(SOURCE_FILES.map((source) => ({ ...source })));setSourceRanges(initialSourceRanges());setSelectedSourceId(STAGED_SOURCE_ID);
    setView("library");setQuery("Balcony");setSelectedId("f01");setConnectionsOpen(false);notify("4 fragment references added. Select one to find connections.");
  };
  const openCombine = (relationship:ScoredRelationship) => { stopAllAudio();returnScroll.current=window.scrollY;setRelationshipStatuses((current) => ({ ...current,[relationship.id]:current[relationship.id] ?? "auditioned" }));setCombineCandidates([relationship,...connections.filter((item) => item.id !== relationship.id)].slice(0,3));window.scrollTo({ top:0 }); };
  const closeCombine = () => { stopAllAudio();setCorrectionRelationship(null);setExportRelationship(null);setCombineCandidates(null);window.setTimeout(() => window.scrollTo({ top:returnScroll.current }),0); };
  const markRelationship = (relationship:CombineCandidate,status:RelationshipStatus) => setRelationshipStatuses((current) => ({ ...current,[relationship.id]:status }));
  const rejectRelationship = (relationship:CombineCandidate) => { markRelationship(relationship,"rejected");setCombineCandidates((current) => current ? current.filter((item) => item.id !== relationship.id) : current);notify("Candidate rejected for this session."); };
  const saveSourceBoundaries = () => {
    const patches:Record<string,Partial<Fragment>>={};
    selectedRanges.forEach((range,index) => { const id=selectedSource.fragmentIds[index];if (!id) return;const fragment=activeFragmentById(id);patches[id]={ start:range.start,end:range.end,duration:formatSeconds(range.end-range.start),analysisRevision:fragment.analysisRevision + 1 }; });
    setFragmentOverrides((current) => ({ ...current,...patches }));notify("Boundaries saved; library references updated.");
  };

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

      {combineCandidates && <CombineWorkspace anchor={selected} candidates={combineCandidates} fragments={activeFragments} statuses={relationshipStatuses} onClose={closeCombine} onEdit={setCorrectionRelationship} onExport={setExportRelationship} onSave={(relationship) => { markRelationship(relationship,"preferred");notify("Combination saved as Preferred."); }} onReject={rejectRelationship} onAuditioned={(relationship) => { if (!relationshipStatuses[relationship.id]) markRelationship(relationship,"auditioned"); }}/>} 

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
              const relatedTakes = fragment.duplicateGroup ? FRAGMENTS.filter((item) => item.duplicateGroup === fragment.duplicateGroup && item.id !== fragment.id && !archived.has(item.id) && !duplicateExclusions.has(item.id)).length : 0;
              return <div key={fragment.id} className={`table-row fragment-row ${connectionsOpen && selectedId === fragment.id ? "selected" : ""} ${CONNECTED_FRAGMENT_IDS.has(fragment.id) ? "" : "no-connections"}`} role="row" tabIndex={0} onClick={() => openFragment(fragment.id)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFragment(fragment.id); } }}>
                <span className="track-name"><b>{fragment.name}</b></span>
                <span className="source-cell" title={sourceNameFor(fragment)}>{sourceNameFor(fragment)}</span>
                <button className={`wave-play ${previewingId === fragment.id ? "playing" : ""}`} onClick={(event) => { event.stopPropagation(); previewSingle(fragment); }} aria-label={`${previewingId === fragment.id ? "Stop" : "Play"} ${fragment.name}`}><Waveform values={fragment.waveform} active={previewingId === fragment.id} /></button>
                <span className="date-cell">{fragment.dateLabel}</span>
                <span>{formatSeconds(fragment.start)}</span><span>{formatSeconds(fragment.end)}</span>
                <span className="duration-cell">{formatSeconds(fragment.end - fragment.start)}</span>
                <span className="bars-cell">{fragment.bars} / {fragment.beats}</span>
                <span className="key-cell" title={fragment.alternateKeys.length ? `Also: ${fragment.alternateKeys.join(", ")}` : fragment.key}>{fragment.key}{fragment.alternateKeys.length > 0 && <small>+{fragment.alternateKeys.length}</small>}</span>
                <span className="tempo-cell">{fragment.bpm}</span><span className="confidence-cell">{Math.round(fragment.confidence * 100)}%</span><span className="tags-cell" title={fragment.userTags.join(", ")}>{fragment.userTags.join(" · ")}</span><span className="role-cell"><em>{fragment.role}</em></span>
                <span className="takes-cell">{relatedTakes > 0 ? <button className="take-link" onClick={(event) => { event.stopPropagation(); setDuplicateGroup(fragment.duplicateGroup!); }}>{relatedTakes + 1}</button> : "—"}</span>
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
          {sourceEditorOpen && <aside className="source-editor">
            <div className="source-editor-title"><h2>Fragmentation</h2><button className="panel-close" onClick={() => { stopAllAudio(); setSourceEditorOpen(false); }} aria-label="Close fragmentation panel">×</button></div>
            <div className="source-editor-head"><div><h3>{selectedSource.name}</h3><p>{selectedSource.format} · {selectedSource.device}</p></div><button className="soft-button" onClick={() => previewSingle(fragmentById(selectedSource.fragmentIds[0]))}>{previewingId === selectedSource.fragmentIds[0] ? "Ⅱ Stop" : "▶ Play"}</button></div>
            <div className="timeline-card">
              <div className="fragment-lanes-scroll"><div className="fragment-lanes" style={{ height:`${selectedRanges.length * 23 + 4}px` }}>{selectedRanges.map((range,index) => <div className="fragment-lane" key={range.id} style={{ top:`${index * 23}px`,"--fragment-color":range.color } as CSSProperties}>
                <div className="fragment-bar" style={{ left:`${range.start / selectedSource.duration * 100}%`,width:`${(range.end - range.start) / selectedSource.duration * 100}%` }}>
                  <button className="range-handle start" onPointerDown={(event) => beginRangeDrag(event,range,"start")} onKeyDown={(event) => { const step=event.shiftKey ? 1 : .25; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); updateRangeEdge(selectedSourceId,range.id,"start",range.start + (event.key === "ArrowLeft" ? -step : step)); } }} aria-label={`Adjust start of fragment ${index + 1}`} />
                  <span>F{String(index + 1).padStart(2,"0")} · {formatSeconds(range.start)}–{formatSeconds(range.end)}</span>
                  <button className="range-handle end" onPointerDown={(event) => beginRangeDrag(event,range,"end")} onKeyDown={(event) => { const step=event.shiftKey ? 1 : .25; if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); updateRangeEdge(selectedSourceId,range.id,"end",range.end + (event.key === "ArrowLeft" ? -step : step)); } }} aria-label={`Adjust end of fragment ${index + 1}`} />
                </div>
              </div>)}</div></div>
              <div className="timeline-labels"><span>0:00</span><span>{formatSeconds(selectedSource.duration / 2)}</span><span>{formatSeconds(selectedSource.duration)}</span></div>
              <div className="continuous-wave-wrap" ref={sourceWaveRef}>
                <ContinuousWaveform values={selectedSource.waveform} />
                {selectedRanges.map((range,index) => <div className="wave-range" key={range.id} style={{ left:`${range.start / selectedSource.duration * 100}%`,width:`${(range.end - range.start) / selectedSource.duration * 100}%`,"--fragment-color":range.color } as CSSProperties}><span>F{index + 1}</span></div>)}
                {magnifier && draggedEdge?.sourceId === selectedSourceId && <div className="edge-magnifier" style={{ left:`${magnifier.x}px` }}><strong>{magnifier.edge} · {formatSeconds(magnifier.time)}</strong><ContinuousWaveform values={waveformSlice(selectedSource.waveform,magnifier.time,selectedSource.duration)} /></div>}
              </div>
              <div className="fragment-summary"><strong>{selectedRanges.length} fragments</strong><span>Drag any colored bar edge to trim · Shift + arrow for 1 second</span></div>
            </div>
            <div className="source-lower">
              <div className="sensitivity-card"><div><h3>Sensitivity</h3><p>Higher sensitivity surfaces shorter gestures and adds fragment ranges.</p></div><div className="knob-control"><button className="knob" role="slider" aria-label="Fragmentation sensitivity" aria-valuemin={10} aria-valuemax={90} aria-valuenow={selectedSource.sensitivity} style={{ "--angle":`${-130 + selectedSource.sensitivity * 2.6}deg` } as CSSProperties} onPointerDown={beginSensitivityDrag} onPointerMove={moveSensitivityDrag} onPointerUp={finishSensitivityDrag} onPointerCancel={finishSensitivityDrag} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault();updateSourceSensitivity(Math.min(90,selectedSource.sensitivity + 4)); } if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault();updateSourceSensitivity(Math.max(10,selectedSource.sensitivity - 4)); } }}><i /></button><strong>{selectedSource.sensitivity < 36 ? "Broad" : selectedSource.sensitivity > 66 ? "Sensitive" : "Balanced"}</strong></div></div>
              <div className="detected-card"><div className="detected-head"><h3>Fragments</h3><div className="detected-actions"><button onClick={addManualFragment}>＋ Add fragment</button><button onClick={saveSourceBoundaries}>Save boundaries</button></div></div>{selectedRanges.map((range,index) => { const id=selectedSource.fragmentIds[index]; const fragment=id ? activeFragmentById(id) : null; return <div className="detected-row" key={range.id}><i className="range-swatch" style={{ background:range.color }} /><span><b>{fragment?.name ?? `Untitled fragment ${index + 1}`}</b><small>{formatSeconds(range.start)}–{formatSeconds(range.end)} · {Math.round(range.end - range.start)} sec</small></span>{fragment ? <button onClick={() => openFragment(id)}>Open →</button> : <em>New</em>}</div>; })}</div>
            </div>
          </aside>}
        </div>
      </section>}

      {!combineCandidates && view === "map" && <section className="page-view map-page">
        <div className="panel-titlebar map-heading"><h1>Map</h1><div className="map-legend"><span><i className="dot violet"/>Direct affinity</span><span><i className="line amber"/>Transformed bridge</span><span><i className="dot lime"/>Selected idea</span></div></div>
        <div className="graph-board">
          <div className="cluster-label cluster-one">VOICE & MELODY</div><div className="cluster-label cluster-two">POCKET & RHYTHM</div><div className="cluster-label cluster-three">HARMONIC WORLDS</div>
          {RELATIONSHIPS.slice(0,18).map((relationship) => {
            const aIndex=activeFragments.slice(0,18).findIndex((fragment) => fragment.id === relationship.source); const bIndex=activeFragments.slice(0,18).findIndex((fragment) => fragment.id === relationship.target);
            if (aIndex < 0 || bIndex < 0 || archived.has(relationship.source) || archived.has(relationship.target)) return null;
            const [ax,ay]=GRAPH_POSITIONS[aIndex], [bx,by]=GRAPH_POSITIONS[bIndex]; const dx=bx-ax, dy=by-ay; const width=Math.sqrt(dx*dx+dy*dy); const angle=Math.atan2(dy,dx)*180/Math.PI;
            return <i key={relationship.id} className={`graph-line ${relationship.transformationCost > .1 ? "bridge" : ""}`} style={{ left:`${ax}%`, top:`${ay}%`, width:`${width}%`, transform:`rotate(${angle}deg)` }} />;
          })}
          {activeFragments.slice(0,18).map((fragment,index) => archived.has(fragment.id) ? null : <button key={fragment.id} className={`graph-node role-${fragment.role.toLowerCase()} ${selectedId === fragment.id ? "selected" : ""}`} style={{ left:`${GRAPH_POSITIONS[index][0]}%`, top:`${GRAPH_POSITIONS[index][1]}%` }} onClick={() => openFragment(fragment.id)} aria-label={`Open ${fragment.name}`}><i/><span>{fragment.name}</span><small>{fragment.date.slice(0,4)} · {fragment.role}</small></button>)}
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
      {correctionRelationship && (() => { const candidate=activeFragmentById(correctionRelationship.otherId);const source=SOURCE_FILES.find((item) => item.id === candidate.sourceId)!;const surrounding=activeFragments.filter((fragment) => fragment.sourceId === source.id);return <CorrectionOverlay candidate={candidate} source={source} surrounding={surrounding} score={correctionRelationship.score} onCancel={() => setCorrectionRelationship(null)} onApply={(patch) => { setFragmentOverrides((current) => ({ ...current,[candidate.id]:{ ...current[candidate.id],...patch } }));setCombineCandidates((current) => current?.map((item) => item.id === correctionRelationship.id ? { ...item,score:76,transform:item.transform ? { ...item.transform,bpm:2,labels:["−3 st","+2 BPM"] } : item.transform } : item) ?? null); }} onKeep={() => { markRelationship(correctionRelationship,"manual");setCorrectionRelationship(null);notify("Manual relationship preserved in this comparison."); }} onDrop={() => { rejectRelationship(correctionRelationship);setCorrectionRelationship(null); }}/>; })()}
      {exportRelationship && (() => { const candidate=activeFragmentById(exportRelationship.otherId);return <ExportSheet anchor={selected} candidate={candidate} relationship={exportRelationship} onClose={() => setExportRelationship(null)} onSaved={() => { markRelationship(exportRelationship,"preferred");setExportRelationship(null);notify("Package ready and relationship marked Preferred."); }}/>; })()}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
