"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_WEIGHTS,
  FRAGMENTS,
  RELATIONSHIPS,
  SOURCE_FILES,
  Fragment,
  MusicalRole,
  Relationship,
  SearchContext,
  SearchWeights,
  SourceFile,
} from "./prototype-data";

type View = "library" | "source" | "map" | "archive";
type RangeMode = "reasonable" | "experimental";
type SortColumn = "name" | "source" | "signal" | "date" | "duration" | "key" | "tempo" | "role" | "takes";
type SortDirection = "asc" | "desc";
type SourceSortColumn = "name" | "signal" | "date" | "duration" | "format" | "device" | "fragments";
type ScoredRelationship = Relationship & { score: number; otherId: string };

const CONTEXTS: { id: SearchContext; label: string }[] = [
  { id: "whole", label: "Whole" }, { id: "melody", label: "Melody" }, { id: "rhythm", label: "Rhythm" },
  { id: "harmony", label: "Harmony" }, { id: "bass", label: "Bass" },
];
const ROLES: ("All" | MusicalRole)[] = ["All", "Melody", "Rhythm", "Harmony", "Bass", "Voice", "Texture"];
const LIBRARY_COLUMNS: { id:SortColumn; label:string }[] = [
  { id:"name", label:"Fragment" }, { id:"source", label:"Source" }, { id:"signal", label:"Signal" },
  { id:"date", label:"Recorded" }, { id:"duration", label:"Length" }, { id:"key", label:"Key" },
  { id:"tempo", label:"BPM" }, { id:"role", label:"Role" }, { id:"takes", label:"Takes" },
];
const SOURCE_COLUMNS: { id:SourceSortColumn; label:string }[] = [
  { id:"name", label:"Source" }, { id:"signal", label:"Signal" }, { id:"date", label:"Recorded" },
  { id:"duration", label:"Length" }, { id:"format", label:"Format" }, { id:"device", label:"Device" },
  { id:"fragments", label:"Fragments" },
];
const GRAPH_POSITIONS = [
  [15,20],[38,16],[64,22],[80,14],[24,42],[49,39],[71,44],[89,36],[12,66],[33,62],[55,66],[76,61],[91,70],[21,84],[44,83],[67,85],[82,88],[54,19],
];

const fragmentById = (id: string) => FRAGMENTS.find((fragment) => fragment.id === id)!;
const otherIdFor = (relationship: Relationship, selectedId: string) => relationship.source === selectedId ? relationship.target : relationship.source;
const formatSeconds = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const durationSeconds = (duration:string) => { const [minutes,seconds] = duration.split(":").map(Number); return minutes * 60 + seconds; };

function fallbackRelationships(selectedId: string): Relationship[] {
  const selectedIndex = FRAGMENTS.findIndex((fragment) => fragment.id === selectedId);
  const authoredTargets = new Set(RELATIONSHIPS.filter((relationship) => relationship.source === selectedId || relationship.target === selectedId).map((relationship) => otherIdFor(relationship, selectedId)));
  return FRAGMENTS
    .filter((fragment) => fragment.id !== selectedId && !authoredTargets.has(fragment.id))
    .slice(0, 10)
    .map((fragment, index) => {
      const targetIndex = FRAGMENTS.findIndex((item) => item.id === fragment.id);
      const seed = (selectedIndex + 4) * (targetIndex + 7) + index * 13;
      const metric = (offset: number) => .38 + ((seed * offset + offset * 17) % 52) / 100;
      return {
        id: `fallback-${selectedId}-${fragment.id}`,
        source: selectedId,
        target: fragment.id,
        base: metric(3),
        metrics: { rhythm:metric(5), harmony:metric(7), melody:metric(11), timbre:metric(13), tempo:metric(17), pitch:metric(19), brightness:metric(23) },
        transformationCost: index > 6 ? .18 : .04 + (index % 3) * .02,
        reason: ["A shared contour appears beneath the recording texture.", "The accents leave complementary space.", "An alternate key lens reveals a useful overlap."][index % 3],
        transform: { labels:index % 3 === 0 ? ["As recorded"] : index % 3 === 1 ? ["+2 BPM"] : ["−1 st"], asset:fragment.audio },
        experimental: index > 6,
      };
    });
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

function TransformChips({ relationship }: { relationship:Relationship }) {
  return <div className="chips">{(relationship.transform?.labels ?? ["As recorded"]).map((label) => <span key={label}>{label}</span>)}</div>;
}

export default function Home() {
  const [view, setView] = useState<View>("library");
  const [selectedId, setSelectedId] = useState("f01");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<(typeof ROLES)[number]>("All");
  const [sort, setSort] = useState<{ column:SortColumn; direction:SortDirection }>({ column:"date", direction:"desc" });
  const [context, setContext] = useState<SearchContext>("whole");
  const [rangeMode, setRangeMode] = useState<RangeMode>("reasonable");
  const [weights, setWeights] = useState<SearchWeights>({ ...DEFAULT_WEIGHTS });
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [duplicateExclusions, setDuplicateExclusions] = useState<Set<string>>(new Set());
  const [duplicateGroup, setDuplicateGroup] = useState<string | null>(null);
  const [audition, setAudition] = useState<Relationship | null>(null);
  const [transformed, setTransformed] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [sourceVolume, setSourceVolume] = useState(72);
  const [candidateVolume, setCandidateVolume] = useState(78);
  const [muted, setMuted] = useState({ source:false, candidate:false });
  const [sources, setSources] = useState<SourceFile[]>(SOURCE_FILES.map((source) => ({ ...source })));
  const [selectedSourceId, setSelectedSourceId] = useState("s1");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [connectionsWidth, setConnectionsWidth] = useState(520);
  const [resizingConnections, setResizingConnections] = useState(false);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceSort, setSourceSort] = useState<{ column:SourceSortColumn; direction:SortDirection }>({ column:"date", direction:"desc" });
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pairAudio = useRef<{ source:HTMLAudioElement; candidate:HTMLAudioElement } | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);

  const selected = fragmentById(selectedId);
  const selectedSource = sources.find((source) => source.id === selectedSourceId)!;

  const stopAllAudio = () => {
    if (pairAudio.current) { pairAudio.current.source.pause(); pairAudio.current.candidate.pause(); pairAudio.current = null; }
    if (previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; }
    setPlaying(false); setPreviewingId(null);
  };

  const navigate = (next:View) => { stopAllAudio(); setAudition(null); setConnectionsOpen(false); setAdvancedOpen(false); setSourceEditorOpen(false); setView(next); };
  const notify = (message:string) => { setToast(message); window.setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    const handler = (event:KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); navigate("library"); window.setTimeout(() => searchRef.current?.focus(), 0); }
      if (event.key === "Escape") { setAudition(null); setDuplicateGroup(null); stopAllAudio(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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

  const visibleFragments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = FRAGMENTS.filter((fragment) => !archived.has(fragment.id))
      .filter((fragment) => roleFilter === "All" || fragment.roles.includes(roleFilter))
      .filter((fragment) => !normalized || `${fragment.name} ${fragment.source} ${fragment.key} ${fragment.roles.join(" ")}`.toLowerCase().includes(normalized));
    return [...filtered].sort((a,b) => {
      const takeCount = (fragment:Fragment) => fragment.duplicateGroup ? FRAGMENTS.filter((item) => item.duplicateGroup === fragment.duplicateGroup && item.id !== fragment.id && !archived.has(item.id) && !duplicateExclusions.has(item.id)).length : 0;
      let comparison = 0;
      if (sort.column === "name") comparison = a.name.localeCompare(b.name);
      if (sort.column === "source") comparison = a.source.localeCompare(b.source);
      if (sort.column === "signal") comparison = a.brightness - b.brightness;
      if (sort.column === "date") comparison = a.date.localeCompare(b.date);
      if (sort.column === "duration") comparison = durationSeconds(a.duration) - durationSeconds(b.duration);
      if (sort.column === "key") comparison = a.key.localeCompare(b.key);
      if (sort.column === "tempo") comparison = a.bpm - b.bpm;
      if (sort.column === "role") comparison = a.role.localeCompare(b.role);
      if (sort.column === "takes") comparison = takeCount(a) - takeCount(b);
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [query, roleFilter, sort, archived, duplicateExclusions]);

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

  const connections = useMemo<ScoredRelationship[]>(() => {
    const sourceRelationships = [...RELATIONSHIPS.filter((relationship) => relationship.source === selectedId || relationship.target === selectedId), ...fallbackRelationships(selectedId)];
    const seen = new Set<string>();
    return sourceRelationships
      .map((relationship) => ({ ...relationship, score:scoreRelationship(relationship, weights, context, rangeMode), otherId:otherIdFor(relationship, selectedId) }))
      .filter((relationship) => {
        const target = fragmentById(relationship.otherId);
        if (seen.has(relationship.otherId) || archived.has(relationship.otherId)) return false;
        if (selected.duplicateGroup && target.duplicateGroup === selected.duplicateGroup) return false;
        if (rangeMode === "reasonable" && (relationship.experimental || relationship.transformationCost > .12)) return false;
        seen.add(relationship.otherId); return true;
      })
      .sort((a,b) => b.score - a.score)
      .slice(0, 6);
  }, [selectedId, weights, context, rangeMode, archived, selected.duplicateGroup]);

  const selectedDuplicates = duplicateGroup ? FRAGMENTS.filter((fragment) => fragment.duplicateGroup === duplicateGroup && !duplicateExclusions.has(fragment.id)) : [];

  const previewSingle = (fragment:Fragment) => {
    if (previewingId === fragment.id && previewAudio.current) { previewAudio.current.pause(); previewAudio.current = null; setPreviewingId(null); return; }
    stopAllAudio();
    const audio = new Audio(fragment.audio); audio.loop = true; audio.volume = .72; previewAudio.current = audio; setPreviewingId(fragment.id);
    audio.play().catch(() => notify("Playback needs one more click in this browser."));
  };

  const auditionTarget = audition ? fragmentById(otherIdFor(audition, selectedId)) : null;
  const sourceAsset = selected.objects?.[context] ?? selected.audio;
  const candidateAsset = audition && auditionTarget ? (transformed && audition.source === selectedId ? audition.transform?.asset : auditionTarget.objects?.[context] ?? auditionTarget.audio) : "";

  const togglePairPlayback = () => {
    if (!audition || !auditionTarget) return;
    if (playing && pairAudio.current) { pairAudio.current.source.pause(); pairAudio.current.candidate.pause(); setPlaying(false); return; }
    if (!pairAudio.current) {
      const source = new Audio(sourceAsset); const candidate = new Audio(candidateAsset);
      source.loop = true; candidate.loop = true; pairAudio.current = { source, candidate };
    }
    const pair = pairAudio.current; pair.source.currentTime = 0; pair.candidate.currentTime = 0;
    pair.source.volume = muted.source ? 0 : sourceVolume / 100; pair.candidate.volume = muted.candidate ? 0 : candidateVolume / 100;
    Promise.all([pair.source.play(), pair.candidate.play()]).then(() => setPlaying(true)).catch(() => notify("Playback needs one more click in this browser."));
  };

  useEffect(() => {
    if (!pairAudio.current) return;
    pairAudio.current.source.volume = muted.source ? 0 : sourceVolume / 100;
    pairAudio.current.candidate.volume = muted.candidate ? 0 : candidateVolume / 100;
  }, [sourceVolume, candidateVolume, muted]);

  useEffect(() => { stopAllAudio(); }, [transformed, context, audition?.id]);

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
    stopAllAudio(); setView("library"); setSelectedId("f01"); setQuery(""); setRoleFilter("All"); setSort({ column:"date", direction:"desc" });
    setContext("whole"); setRangeMode("reasonable"); setWeights({ ...DEFAULT_WEIGHTS }); setArchived(new Set()); setDuplicateExclusions(new Set());
    setDuplicateGroup(null); setAudition(null); setConnectionsOpen(false); setAdvancedOpen(false); setConnectionsWidth(520); setSources(SOURCE_FILES.map((source) => ({ ...source }))); setSelectedSourceId("s1"); setSourceQuery(""); setSourceSort({ column:"date", direction:"desc" }); setSourceEditorOpen(false); notify("Demo restored to its opening state.");
  };
  const updateSource = (patch:Partial<SourceFile>) => setSources((current) => current.map((source) => source.id === selectedSourceId ? { ...source, ...patch } : source));
  const openFragment = (id:string) => { stopAllAudio(); setAudition(null); setSelectedId(id); setConnectionsOpen(true); setAdvancedOpen(false); setView("library"); };
  const closeConnections = () => { stopAllAudio(); setAudition(null); setConnectionsOpen(false); setAdvancedOpen(false); };

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
        <div className="index-status"><span /><small>2,418 ideas indexed</small></div>
        <button className="reset" onClick={resetDemo}>↺ Reset demo</button>
      </header>

      {view === "library" && <section className={`workspace ${connectionsOpen ? "connections-open" : ""} ${resizingConnections ? "resizing" : ""}`} style={{ "--connections-width":`${connectionsWidth}px` } as CSSProperties}>
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
              return <div key={fragment.id} className={`table-row fragment-row ${connectionsOpen && selectedId === fragment.id ? "selected" : ""}`} role="row" tabIndex={0} onClick={() => openFragment(fragment.id)} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openFragment(fragment.id); } }}>
                <span className="track-name"><b>{fragment.name}</b></span>
                <span className="source-cell" title={fragment.source}>{fragment.source}</span>
                <button className={`wave-play ${previewingId === fragment.id ? "playing" : ""}`} onClick={(event) => { event.stopPropagation(); previewSingle(fragment); }} aria-label={`${previewingId === fragment.id ? "Stop" : "Play"} ${fragment.name}`}><Waveform values={fragment.waveform} active={previewingId === fragment.id} /></button>
                <span className="date-cell">{fragment.dateLabel}</span>
                <span className="duration-cell">{fragment.duration}</span>
                <span className="key-cell" title={fragment.alternateKeys.length ? `Also: ${fragment.alternateKeys.join(", ")}` : fragment.key}>{fragment.key}{fragment.alternateKeys.length > 0 && <small>+{fragment.alternateKeys.length}</small>}</span>
                <span className="tempo-cell">{fragment.bpm}</span><span className="role-cell"><em>{fragment.role}</em></span>
                <span className="takes-cell">{relatedTakes > 0 ? <button className="take-link" onClick={(event) => { event.stopPropagation(); setDuplicateGroup(fragment.duplicateGroup!); }}>{relatedTakes + 1}</button> : "—"}</span>
              </div>;
            })}
            {visibleFragments.length === 0 && <div className="empty-inline">No fragments match that search.</div>}
          </div>
        </div>

        {connectionsOpen && <aside className="connections">
          <div className="panel-resizer" role="separator" aria-label="Resize connections panel" aria-orientation="vertical" aria-valuemin={420} aria-valuemax={760} aria-valuenow={connectionsWidth} tabIndex={0} onPointerDown={(event) => { event.preventDefault(); setResizingConnections(true); }} onDoubleClick={() => setConnectionsWidth(520)} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); setConnectionsWidth((width) => Math.min(760,width + 20)); } if (event.key === "ArrowRight") { event.preventDefault(); setConnectionsWidth((width) => Math.max(420,width - 20)); } }}><span /></div>
          <div className="connections-head"><h2>Connections</h2><div><button className={`advanced-toggle ${advancedOpen ? "active" : ""}`} onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>Advanced</button><button className="panel-close" onClick={closeConnections} aria-label="Close connections">×</button></div></div>
          <p className="selected-caption"><span>From</span><strong>{selected.name}</strong></p>
          <div className="connection-controls">
            <div className="context-switch" aria-label="Search musical object">{CONTEXTS.map((item) => <button key={item.id} className={context === item.id ? "active" : ""} onClick={() => setContext(item.id)}>{item.label}</button>)}</div>
            <div className="range-toggle"><button className={rangeMode === "reasonable" ? "active" : ""} onClick={() => setRangeMode("reasonable")}>Reasonable</button><button className={rangeMode === "experimental" ? "active experimental" : ""} onClick={() => setRangeMode("experimental")}>Experimental</button></div>
            {advancedOpen && <div className="advanced-popover">
              <div className="shape-title"><div><span>Weights</span></div><button onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>Balanced</button></div>
              <div className="weight-presets"><button onClick={() => setWeights({ rhythm:100,harmony:16,melody:12,timbre:42 })}>Rhythm</button><button onClick={() => setWeights({ rhythm:18,harmony:100,melody:74,timbre:22 })}>Harmony</button></div>
              {(Object.keys(weights) as (keyof SearchWeights)[]).map((key) => <label className="weight-row" key={key}><span>{key}</span><input type="range" min="0" max="100" value={weights[key]} onChange={(event) => setWeights((current) => ({ ...current, [key]:Number(event.target.value) }))} /><output>{weights[key]}</output></label>)}
            </div>}
          </div>
          {selected.objects && context !== "whole" && <div className="object-note"><span>Isolated {context}</span><small>Prepared musical-object view</small></div>}
          <div className="connection-table" role="table" aria-label={`Connections for ${selected.name}`}>
            <div className="connection-row connection-header" role="row"><span>Fit</span><span>Fragment</span><span>Key</span><span>BPM</span><span>Role</span><span>Change</span><span aria-label="Audition" /></div>
            {connections.map((relationship,index) => {
            const target = fragmentById(relationship.otherId);
            return <div className={`connection-row ${index === 0 ? "featured" : ""}`} role="row" key={relationship.id}>
              <span className="connection-fit"><strong>{relationship.score}</strong><small>%</small></span>
              <span className="connection-name">{target.id === "f02" && selectedId === "f01" && <i>Rediscovered · 2018</i>}<b>{target.name}</b><small title={relationship.reason}>{relationship.reason}</small></span>
              <span className="connection-key" title={target.alternateKeys.length ? `${target.key}; also ${target.alternateKeys.join(", ")}` : target.key}>{target.key}</span>
              <span className="connection-tempo">{target.bpm}</span>
              <span className="connection-role">{target.role}</span>
              <span className="connection-change"><TransformChips relationship={relationship} /></span>
              <button className="audition" onClick={() => { setAudition(relationship); setTransformed(true); }} aria-label={`Audition ${target.name} with ${selected.name}`}>▶</button>
            </div>;
          })}</div>
        </aside>}
      </section>}

      {view === "source" && <section className="page-view source-page">
        <div className={`source-workspace ${sourceEditorOpen ? "editor-open" : ""}`}>
          <div className="sources-panel">
            <div className="panel-titlebar"><h1>Sources</h1></div>
            <div className="sources-toolbar"><label className="search"><span aria-hidden="true">⌕</span><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} placeholder="Search" aria-label="Search sources" /></label></div>
            <div className="source-table" role="table" aria-label="Source files">
              <div className="source-table-row source-table-header" role="row">{SOURCE_COLUMNS.map((column) => <span role="columnheader" aria-sort={sourceSort.column === column.id ? (sourceSort.direction === "asc" ? "ascending" : "descending") : "none"} key={column.id}><button onClick={() => changeSourceSort(column.id)}>{column.label}<i aria-hidden="true">{sourceSort.column === column.id ? (sourceSort.direction === "asc" ? "↑" : "↓") : "↕"}</i></button></span>)}</div>
              {visibleSources.map((source) => { const auditionId = source.fragmentIds[0]; return <div className={`source-table-row ${sourceEditorOpen && selectedSourceId === source.id ? "selected" : ""}`} role="row" tabIndex={0} key={source.id} onClick={() => { stopAllAudio(); setSelectedSourceId(source.id); setSourceEditorOpen(true); }} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); stopAllAudio(); setSelectedSourceId(source.id); setSourceEditorOpen(true); } }}>
                <span className="source-name-cell" title={source.name}><b>{source.name}</b></span>
                <button className={`wave-play ${previewingId === auditionId ? "playing" : ""}`} onClick={(event) => { event.stopPropagation(); previewSingle(fragmentById(auditionId)); }} aria-label={`${previewingId === auditionId ? "Stop" : "Play"} ${source.name}`}><Waveform values={source.waveform.slice(0,36)} active={previewingId === auditionId} /></button>
                <span>{source.date}</span><span>{formatSeconds(source.duration)}</span><span title={source.format}>{source.format.split(" · ")[0]}</span><span title={source.device}>{source.device}</span><span>{source.fragmentIds.length}</span>
              </div>; })}
              {visibleSources.length === 0 && <div className="empty-inline">No sources match that search.</div>}
            </div>
          </div>
          {sourceEditorOpen && <aside className="source-editor">
            <div className="source-editor-title"><h2>Fragmentation</h2><button className="panel-close" onClick={() => { stopAllAudio(); setSourceEditorOpen(false); }} aria-label="Close fragmentation panel">×</button></div>
            <div className="source-editor-head"><div><h3>{selectedSource.name}</h3><p>{selectedSource.format} · {selectedSource.device}</p></div><button className="soft-button" onClick={() => previewSingle(fragmentById(selectedSource.fragmentIds[0]))}>{previewingId === selectedSource.fragmentIds[0] ? "Ⅱ Stop" : "▶ Play"}</button></div>
            <div className="timeline-card">
              <div className="timeline-labels"><span>0:00</span><span>{formatSeconds(selectedSource.duration / 2)}</span><span>{formatSeconds(selectedSource.duration)}</span></div>
              <div className="source-wave-wrap"><Waveform values={selectedSource.waveform} large /><div className="selection-region" style={{ left:`${selectedSource.start / selectedSource.duration * 100}%`, width:`${(selectedSource.end - selectedSource.start) / selectedSource.duration * 100}%` }}><i className="handle start"/><i className="handle end"/></div>{Array.from({ length:Math.max(1,Math.round(selectedSource.sensitivity / 18)) }).map((_,index) => <i className="boundary" key={index} style={{ left:`${(index + 1) * 100 / (Math.max(1,Math.round(selectedSource.sensitivity / 18)) + 1)}%` }} />)}</div>
              <div className="selection-copy"><span>Selected fragment</span><strong>{formatSeconds(selectedSource.start)} — {formatSeconds(selectedSource.end)}</strong><small>{Math.round(selectedSource.end - selectedSource.start)} seconds</small></div>
              <div className="boundary-controls">
                <label><span>Start point <output>{formatSeconds(selectedSource.start)}</output></span><input type="range" min="0" max={Math.max(1, selectedSource.end - 1)} value={selectedSource.start} onChange={(event) => updateSource({ start:Number(event.target.value) })} /></label>
                <label><span>End point <output>{formatSeconds(selectedSource.end)}</output></span><input type="range" min={Math.min(selectedSource.duration - 1, selectedSource.start + 1)} max={selectedSource.duration} value={selectedSource.end} onChange={(event) => updateSource({ end:Number(event.target.value) })} /></label>
              </div>
            </div>
            <div className="source-lower">
              <div className="sensitivity-card"><div><p className="eyebrow">Per-file control</p><h3>Fragmentation sensitivity</h3><p>Turn it up to notice smaller gestures. Turn it down to keep longer passages together.</p></div><div className="knob-control"><div className="knob" style={{ "--angle":`${-130 + selectedSource.sensitivity * 2.6}deg` } as CSSProperties}><i /></div><input aria-label="Fragmentation sensitivity" type="range" min="10" max="90" value={selectedSource.sensitivity} onChange={(event) => updateSource({ sensitivity:Number(event.target.value) })}/><strong>{selectedSource.sensitivity < 36 ? "Broad" : selectedSource.sensitivity > 66 ? "Sensitive" : "Balanced"}</strong><small>{Math.max(1,Math.round(selectedSource.sensitivity / 18))} fragments detected</small></div></div>
              <div className="detected-card"><div className="detected-head"><h3>Fragments in this file</h3><button onClick={() => notify("Boundary changes saved for this demo session.")}>Save boundaries</button></div>{selectedSource.fragmentIds.map((id) => { const fragment=fragmentById(id); return <div className="detected-row" key={id}><Waveform values={fragment.waveform.slice(0,18)} /><span><b>{fragment.name}</b><small>{fragment.duration} · {fragment.role}</small></span><button onClick={() => openFragment(id)}>Open →</button></div>; })}</div>
            </div>
          </aside>}
        </div>
      </section>}

      {view === "map" && <section className="page-view map-page">
        <div className="panel-titlebar map-heading"><h1>Map</h1><div className="map-legend"><span><i className="dot violet"/>Direct affinity</span><span><i className="line amber"/>Transformed bridge</span><span><i className="dot lime"/>Selected idea</span></div></div>
        <div className="graph-board">
          <div className="cluster-label cluster-one">VOICE & MELODY</div><div className="cluster-label cluster-two">POCKET & RHYTHM</div><div className="cluster-label cluster-three">HARMONIC WORLDS</div>
          {RELATIONSHIPS.slice(0,18).map((relationship) => {
            const aIndex=FRAGMENTS.slice(0,18).findIndex((fragment) => fragment.id === relationship.source); const bIndex=FRAGMENTS.slice(0,18).findIndex((fragment) => fragment.id === relationship.target);
            if (aIndex < 0 || bIndex < 0 || archived.has(relationship.source) || archived.has(relationship.target)) return null;
            const [ax,ay]=GRAPH_POSITIONS[aIndex], [bx,by]=GRAPH_POSITIONS[bIndex]; const dx=bx-ax, dy=by-ay; const width=Math.sqrt(dx*dx+dy*dy); const angle=Math.atan2(dy,dx)*180/Math.PI;
            return <i key={relationship.id} className={`graph-line ${relationship.transformationCost > .1 ? "bridge" : ""}`} style={{ left:`${ax}%`, top:`${ay}%`, width:`${width}%`, transform:`rotate(${angle}deg)` }} />;
          })}
          {FRAGMENTS.slice(0,18).map((fragment,index) => archived.has(fragment.id) ? null : <button key={fragment.id} className={`graph-node role-${fragment.role.toLowerCase()} ${selectedId === fragment.id ? "selected" : ""}`} style={{ left:`${GRAPH_POSITIONS[index][0]}%`, top:`${GRAPH_POSITIONS[index][1]}%` }} onClick={() => openFragment(fragment.id)} aria-label={`Open ${fragment.name}`}><i/><span>{fragment.name}</span><small>{fragment.date.slice(0,4)} · {fragment.role}</small></button>)}
        </div>
      </section>}

      {view === "archive" && <section className="page-view archive-page">
        <div className="panel-titlebar"><h1>Archive</h1></div>
        {archived.size === 0 ? <div className="empty-state"><span>◌</span><h2>Nothing archived yet</h2><p>When you tidy alternate takes, they remain safely recoverable here.</p><button onClick={() => navigate("library")}>Return to library</button></div> : <div className="archive-list">{FRAGMENTS.filter((fragment) => archived.has(fragment.id)).map((fragment) => <div className="archive-row" key={fragment.id}><Waveform values={fragment.waveform}/><span><b>{fragment.name}</b><small>{fragment.source} · {fragment.dateLabel}</small></span><em>{fragment.role}</em><button onClick={() => restoreFragment(fragment.id)}>↟ Restore to matching</button></div>)}</div>}
      </section>}

      {audition && auditionTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) { setAudition(null); stopAllAudio(); } }}><section className="audition-modal" role="dialog" aria-modal="true" aria-label="Audition connection">
        <header><h2>Audition</h2><button className="modal-close" onClick={() => { setAudition(null); stopAllAudio(); }} aria-label="Close audition">×</button></header>
        <div className="audition-story"><span>{selected.dateLabel}</span><i>+</i><span>{auditionTarget.dateLabel}</span><strong>{scoreRelationship(audition,weights,context,rangeMode)}% connection</strong></div>
        <div className="compare-toggle"><button className={!transformed ? "active" : ""} onClick={() => setTransformed(false)}>Original relationship</button><button className={transformed ? "active" : ""} onClick={() => setTransformed(true)}>Suggested transformation <TransformChips relationship={audition}/></button></div>
        <div className="track-stack">
          <div className="audition-track"><button className={`mute ${muted.source ? "off" : ""}`} onClick={() => setMuted((current) => ({ ...current, source:!current.source }))}>{muted.source ? "○" : "●"}<small>{muted.source ? "Muted" : "On"}</small></button><div className="track-body"><span className="track-label">ANCHOR · {context}</span><h3>{selected.name}</h3><Waveform values={selected.waveform} active={playing}/></div><label className="volume">Mix<input aria-label="Anchor volume" type="range" min="0" max="100" value={sourceVolume} onChange={(event) => setSourceVolume(Number(event.target.value))}/><output>{sourceVolume}</output></label></div>
          <div className="audition-track candidate"><button className={`mute ${muted.candidate ? "off" : ""}`} onClick={() => setMuted((current) => ({ ...current, candidate:!current.candidate }))}>{muted.candidate ? "○" : "●"}<small>{muted.candidate ? "Muted" : "On"}</small></button><div className="track-body"><span className="track-label">CONNECTION · {transformed ? "TRANSFORMED" : "ORIGINAL"}</span><h3>{auditionTarget.name}</h3><Waveform values={auditionTarget.waveform.slice().reverse()} active={playing}/></div><label className="volume">Mix<input aria-label="Connection volume" type="range" min="0" max="100" value={candidateVolume} onChange={(event) => setCandidateVolume(Number(event.target.value))}/><output>{candidateVolume}</output></label></div>
        </div>
        <div className={`transport ${playing ? "playing" : ""}`}><button onClick={togglePairPlayback}>{playing ? "Ⅱ" : "▶"}</button><div><span className="playhead"/><i/><i/><i/><i/></div><time>{playing ? "playing loop" : "0:00 / 0:06"}</time></div>
        <div className="audition-insight"><span>Why it connects</span><p>{audition.reason}</p>{transformed ? <TransformChips relationship={audition}/> : <small>Original recordings — no transformation applied</small>}</div>
      </section></div>}

      {duplicateGroup && <div className="modal-backdrop" role="presentation"><section className="duplicate-modal" role="dialog" aria-modal="true" aria-label="Manage related takes">
        <header><h2>Takes</h2><button className="modal-close" onClick={() => { setDuplicateGroup(null); stopAllAudio(); }} aria-label="Close takes">×</button></header>
        <div className="duplicate-list">{selectedDuplicates.map((fragment,index) => <div className={`duplicate-row ${fragment.id === selectedId ? "current" : ""}`} key={fragment.id}><button className="round-play" onClick={() => previewSingle(fragment)}>{previewingId === fragment.id ? "Ⅱ" : "▶"}</button><Waveform values={fragment.waveform} active={previewingId === fragment.id}/><span><b>{fragment.name}</b><small>{fragment.dateLabel} · {fragment.duration} {index === 0 && "· strongest recording"}</small></span><div className="duplicate-actions"><button onClick={() => { setDuplicateExclusions((current) => new Set([...current,fragment.id])); notify("Marked as a separate idea."); }}>Not a duplicate</button><button onClick={() => archiveFragment(fragment.id)}>Archive</button></div><button className="keep-button" onClick={() => keepTake(fragment.id)}>Keep this for matching</button></div>)}</div>
        <footer><span>No cleanup is required. Fragments will keep working either way.</span><button onClick={() => setDuplicateGroup(null)}>Done</button></footer>
      </section></div>}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
