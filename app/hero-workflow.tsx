"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/lib/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/lib/ui/dialog";
import {
  Fragment,
  Relationship,
  RelationshipStatus,
} from "./prototype-data";

export type CombineCandidate = Relationship & { score:number; otherId:string };
type TransformDraft = { semitones:number; bpm:number; timing:"normal" | "half-time" | "double-time"; beatOffset:number; repeat:number; transformed:boolean };

function wavePath(values:number[],width=1000,height=160) {
  const middle=height / 2;
  const upper=values.map((value,index) => `${index ? "L" : "M"}${index / Math.max(1,values.length - 1) * width},${middle - value / 100 * middle * .88}`).join(" ");
  const lower=[...values].reverse().map((value,reverseIndex) => { const index=values.length - 1 - reverseIndex; return `L${index / Math.max(1,values.length - 1) * width},${middle + value / 100 * middle * .88}`; }).join(" ");
  return `${upper} ${lower} Z`;
}

function RealWave({ values,active=false }: { values:number[]; active?:boolean }) {
  return <svg className={`hero-wave ${active ? "active" : ""}`} viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true"><path d={wavePath(values)} /></svg>;
}

export function ExportSheet({ anchor,candidate,relationship,onClose,onSaved }: { anchor:Fragment;candidate:Fragment;relationship:CombineCandidate;onClose:()=>void;onSaved:()=>void }) {
  const manifest=encodeURIComponent(JSON.stringify({ anchor:{ id:anchor.id,sourceId:anchor.sourceId,start:anchor.start,end:anchor.end },candidate:{ id:candidate.id,sourceId:candidate.sourceId,start:candidate.start,end:candidate.end },transform:relationship.transform?.labels ?? ["As recorded"],fit:relationship.score },null,2));
  const outputs=[{ name:"Combined preview.wav",asset:relationship.transform?.asset ?? candidate.audio,meta:"A + transformed B"},{ name:`${anchor.name}.wav`,asset:anchor.audio,meta:"Anchor · original"},{ name:`${candidate.name} — transformed.wav`,asset:relationship.transform?.asset ?? candidate.audio,meta:relationship.transform?.labels.join(" · ") ?? "As recorded" }];
  const drag=(event:React.DragEvent,asset:string,name:string) => { const url=new URL(asset,window.location.href).href;event.dataTransfer.setData("text/uri-list",url);event.dataTransfer.setData("DownloadURL",`audio/wav:${name}:${url}`);event.dataTransfer.effectAllowed="copy"; };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Combination package</DialogTitle>
          <DialogDescription>
            Prepared files preserve the scripted transformation and source references. Drag into a DAW when supported, or export each file directly.
          </DialogDescription>
        </DialogHeader>
        <div className="export-files space-y-3">
          {outputs.map((output,index) => (
            <div className="export-tile grid gap-3 rounded-md border border-border/70 p-3" draggable onDragStart={(event) => drag(event,output.asset,output.name)} key={output.name}>
              <span className="file-icon text-xs font-semibold text-muted-foreground">WAV</span>
              <div>
                <b className="block text-sm">{output.name}</b>
                <small className="text-xs text-muted-foreground">{output.meta}</small>
                <em className="block text-xs text-muted-foreground not-italic">Drag into DAW</em>
              </div>
              <a className="text-sm text-primary underline" href={output.asset} download={output.name}>Export</a>
              {index === 0 && <audio controls src={output.asset}><track kind="captions" src="/audio/instrumental.vtt" srcLang="en" label="Instrumental audio"/></audio>}
            </div>
          ))}
          <div className="export-tile manifest grid gap-3 rounded-md border border-border/70 p-3">
            <span className="file-icon text-xs font-semibold text-muted-foreground">JSON</span>
            <div>
              <b className="block text-sm">transformation-recipe.json</b>
              <small className="text-xs text-muted-foreground">Source ranges, fit, and transformation manifest</small>
            </div>
            <a className="text-sm text-primary underline" href={`data:application/json;charset=utf-8,${manifest}`} download="transformation-recipe.json">Export</a>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="button" variant="lime" onClick={onSaved}>Save combination & finish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function recommendationFor(relationship:CombineCandidate,fragment:Fragment):TransformDraft {
  return { semitones:relationship.transform?.pitch ?? 0,bpm:fragment.bpm + (relationship.transform?.bpm ?? 0),timing:relationship.transform?.timing ?? "normal",beatOffset:relationship.transform?.beatOffset ?? 0,repeat:relationship.transform?.repeat ?? 1,transformed:true };
}

export function CombineWorkspace({ anchor,candidates,fragments,statuses,onClose,onEdit,onExport,onSave,onReject,onAuditioned }: {
  anchor:Fragment;candidates:CombineCandidate[];fragments:Fragment[];statuses:Record<string,RelationshipStatus | undefined>;
  onClose:()=>void;onEdit:(relationship:CombineCandidate)=>void;onExport:(relationship:CombineCandidate)=>void;onSave:(relationship:CombineCandidate)=>void;onReject:(relationship:CombineCandidate)=>void;onAuditioned:(relationship:CombineCandidate)=>void;
}) {
  const [activeId,setActiveId]=useState(candidates[0]?.id ?? "");
  const relationship=candidates.find((item) => item.id === activeId) ?? candidates[0];
  const candidate=fragments.find((item) => item.id === relationship?.otherId);
  const recommendation=useMemo<TransformDraft>(() => relationship && candidate ? recommendationFor(relationship,candidate) : { semitones:0,bpm:90,timing:"normal",beatOffset:0,repeat:1,transformed:true },[relationship,candidate]);
  const [transform,setTransform]=useState<TransformDraft>(recommendation);
  const [playing,setPlaying]=useState("");
  const [playPhase,setPlayPhase]=useState<"" | "a" | "b" | "both">("");
  const [loop,setLoop]=useState({ a:false,b:false });
  const [mute,setMute]=useState({ a:false,b:false });
  const [volume,setVolume]=useState({ a:74,b:78 });
  const audios=useRef<HTMLAudioElement[]>([]);
  const timers=useRef<number[]>([]);
  const stop=() => { audios.current.forEach((audio) => { audio.pause();audio.currentTime=0; });audios.current=[];timers.current.forEach(window.clearTimeout);timers.current=[];setPlaying("");setPlayPhase(""); };
  useEffect(() => () => stop(),[]);
  const makeAudio=(asset:string,track:"a" | "b") => { const audio=new Audio(asset);audio.volume=mute[track] ? 0 : volume[track] / 100;audio.loop=loop[track];audios.current.push(audio);return audio; };
  const candidateAsset=transform.transformed ? relationship?.transform?.asset ?? candidate?.audio ?? "" : candidate?.audio ?? "";
  const play=(mode:"A" | "B" | "A→B" | "B→A" | "Together") => {
    if (!relationship || !candidate) return;
    stop();setPlaying(mode);onAuditioned(relationship);
    const a=makeAudio(anchor.audio,"a"),b=makeAudio(candidateAsset,"b");
    const safe=(audio:HTMLAudioElement) => audio.play().catch(() => { setPlaying("");setPlayPhase(""); });
    if (mode === "A") { setPlayPhase("a");safe(a); }
    if (mode === "B") { setPlayPhase("b");safe(b); }
    if (mode === "Together") { setPlayPhase("both");safe(a);safe(b); }
    if (mode === "A→B") { setPlayPhase("a");safe(a);timers.current.push(window.setTimeout(() => { a.pause();setPlayPhase("b");safe(b); },2600)); }
    if (mode === "B→A") { setPlayPhase("b");safe(b);timers.current.push(window.setTimeout(() => { b.pause();setPlayPhase("a");safe(a); },2600)); }
  };
  if (!relationship || !candidate) return null;
  const status=statuses[relationship.id];
  const chooseCandidate=(id:string) => { stop();const next=candidates.find((item) => item.id === id);const nextFragment=fragments.find((item) => item.id === next?.otherId);if (next && nextFragment) setTransform(recommendationFor(next,nextFragment));setActiveId(id); };
  const cycleCandidate=(direction:-1 | 1) => { const currentIndex=Math.max(0,candidates.findIndex((item) => item.id === relationship.id));const nextIndex=(currentIndex + direction + candidates.length) % candidates.length;chooseCandidate(candidates[nextIndex].id); };
  return <section className="combine-workspace" aria-label="Combine workspace">
    <div className="combine-titlebar"><div><span className="eyebrow">Combine</span><h1>{anchor.name} <i>+</i> {candidate.name}</h1></div><button className="panel-close" onClick={onClose} aria-label="Close Combine and return to library">×</button></div>
    <div className="combine-grid">
      <div className="combine-stage">
        <div className="combine-track"><div className="track-index">A</div><div><span className="eyebrow">Anchor</span><h2>{anchor.name}</h2><div className="combine-wave-wrap"><RealWave values={anchor.waveform} active={playPhase === "a" || playPhase === "both"}/>{(playPhase === "a" || playPhase === "both") && <i className="scan-playhead" />}</div></div><div className="track-mix"><button className={loop.a ? "active" : ""} onClick={() => setLoop((current) => ({ ...current,a:!current.a }))}>Loop</button><button className={mute.a ? "active" : ""} onClick={() => setMute((current) => ({ ...current,a:!current.a }))}>{mute.a ? "Muted" : "Mute"}</button><input aria-label="Anchor volume" type="range" min="0" max="100" value={volume.a} onChange={(event) => setVolume((current) => ({ ...current,a:Number(event.target.value) }))}/></div></div>
        <div className="combine-track candidate"><div className="track-index">B</div><div className="candidate-wave-box"><div className="candidate-wave-head"><div><span className="eyebrow">Candidate · {transform.transformed ? "Transformed" : "Original"}</span><h2>{candidate.name}</h2></div><div className="candidate-arrows"><button onClick={() => cycleCandidate(-1)} aria-label="Previous candidate">←</button><small>{candidates.findIndex((item) => item.id === relationship.id) + 1}/{candidates.length}</small><button onClick={() => cycleCandidate(1)} aria-label="Next candidate">→</button></div></div><div className="combine-wave-wrap"><RealWave values={[...candidate.waveform].reverse()} active={playPhase === "b" || playPhase === "both"}/>{(playPhase === "b" || playPhase === "both") && <i className="scan-playhead" />}</div></div><div className="candidate-controls"><div className="track-mix"><button className={loop.b ? "active" : ""} onClick={() => setLoop((current) => ({ ...current,b:!current.b }))}>Loop</button><button className={mute.b ? "active" : ""} onClick={() => setMute((current) => ({ ...current,b:!current.b }))}>{mute.b ? "Muted" : "Mute"}</button><input aria-label="Candidate volume" type="range" min="0" max="100" value={volume.b} onChange={(event) => setVolume((current) => ({ ...current,b:Number(event.target.value) }))}/></div><div className="candidate-stats"><b>{relationship.score}% fit</b>{relationship.transform?.labels.map((label) => <i key={label}>{label}</i>)}{status && <em className={`relationship-badge ${status}`}>{status}</em>}</div><button className="candidate-edit-source" onClick={() => onEdit(relationship)}>Edit source</button></div></div>
        <div className="playback-modes">{(["A","B","A→B","B→A","Together"] as const).map((mode) => <button className={playing === mode ? "active" : ""} onClick={() => playing === mode ? stop() : play(mode)} key={mode}>{playing === mode ? "Ⅱ " : "▶ "}{mode}</button>)}</div>
      </div>
      <aside className="transform-console"><div className="console-head"><div><span className="eyebrow">Transformation</span><h2>Candidate settings</h2></div><button onClick={() => setTransform(recommendation)}>Reset to recommendation</button></div>
        <div className="ab-toggle"><button className={!transform.transformed ? "active" : ""} onClick={() => setTransform((current) => ({ ...current,transformed:false }))}>Original</button><button className={transform.transformed ? "active" : ""} onClick={() => setTransform((current) => ({ ...current,transformed:true }))}>Transformed</button></div>
        <label><span>Pitch <small>semitones</small></span><input type="number" min="-12" max="12" value={transform.semitones} onChange={(event) => setTransform((current) => ({ ...current,semitones:Number(event.target.value) }))}/></label>
        <label><span>Target BPM <small>time-stretch</small></span><input type="number" min="40" max="220" value={transform.bpm} onChange={(event) => setTransform((current) => ({ ...current,bpm:Number(event.target.value) }))}/></label>
        <label><span>Time interpretation</span><select value={transform.timing} onChange={(event) => setTransform((current) => ({ ...current,timing:event.target.value as TransformDraft["timing"] }))}><option value="normal">Normal</option><option value="half-time">Half-time</option><option value="double-time">Double-time</option></select></label>
        <label><span>Beat offset</span><input type="number" min="-8" max="8" value={transform.beatOffset} onChange={(event) => setTransform((current) => ({ ...current,beatOffset:Number(event.target.value) }))}/></label>
        <label><span>Repeat</span><input type="number" min="1" max="4" value={transform.repeat} onChange={(event) => setTransform((current) => ({ ...current,repeat:Number(event.target.value) }))}/></label>
        <div className="console-recommendation"><span>Recommended</span><b>{recommendation.semitones} st · {recommendation.bpm} BPM · {recommendation.beatOffset} beat · {recommendation.repeat}×</b></div>
      </aside>
    </div>
    <footer className="combine-actions"><Button type="button" variant="outline" onClick={() => { const next=candidates.find((item) => item.id !== relationship.id);if (next) chooseCandidate(next.id);onReject(relationship); }}>Reject</Button><Button type="button" variant="outline" onClick={() => onExport(relationship)}>Export</Button><Button type="button" variant="lime" onClick={() => onSave(relationship)}>Save combination</Button></footer>
  </section>;
}
