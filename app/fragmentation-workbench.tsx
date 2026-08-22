"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { Fragment, SourceFile } from "./prototype-data";

export type EditableRange = { id:string; fragmentId?:string; start:number; end:number; color:string };
type Edge = "start" | "end";

const formatSeconds = (seconds:number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2,"0")}`;

function waveformPath(values:number[],width=1000,height=160) {
  const middle=height / 2;
  const upper=values.map((value,index) => `${index ? "L" : "M"}${index / Math.max(1,values.length - 1) * width},${middle - value / 100 * middle * .88}`).join(" ");
  const lower=[...values].reverse().map((value,reverseIndex) => { const index=values.length - 1 - reverseIndex;return `L${index / Math.max(1,values.length - 1) * width},${middle + value / 100 * middle * .88}`; }).join(" ");
  return `${upper} ${lower} Z`;
}

function waveformSlice(values:number[],time:number,duration:number) {
  const center=Math.round(time / duration * (values.length - 1));
  const start=Math.max(0,center - 5);
  const slice=values.slice(start,Math.min(values.length,center + 6));
  return slice.length > 2 ? slice : values;
}

function ContinuousWaveform({ values }: { values:number[] }) {
  return <svg className="continuous-wave" viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true"><path d={waveformPath(values)} /></svg>;
}

export function FragmentationWorkbench({ source,ranges,fragments,sensitivity,focusedFragmentId,onRangesChange,onSensitivityChange,onAddRange,onSave,onClose,onOpenFragment,saveLabel="Save boundaries",footerContent }: {
  source:SourceFile;
  ranges:EditableRange[];
  fragments:Fragment[];
  sensitivity:number;
  focusedFragmentId?:string;
  onRangesChange:(ranges:EditableRange[])=>void;
  onSensitivityChange:(value:number)=>void;
  onAddRange:()=>void;
  onSave:()=>void;
  onClose:()=>void;
  onOpenFragment?:(id:string)=>void;
  saveLabel?:string;
  footerContent?:ReactNode;
}) {
  const [dragged,setDragged]=useState<{ rangeId:string;edge:Edge } | null>(null);
  const [magnifier,setMagnifier]=useState<{ x:number;time:number;edge:Edge } | null>(null);
  const [previewingId,setPreviewingId]=useState<string | null>(null);
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const waveform = cached?.peaks ?? source.waveform;
  const analysisMeta = cached?.analysis;
  const audioRef=useRef<HTMLAudioElement | null>(null);
  const timelineRef=useRef<HTMLDivElement>(null);
  const rulerRef=useRef<HTMLDivElement>(null);
  const rangesRef=useRef(ranges);
  const onRangesChangeRef=useRef(onRangesChange);
  const sensitivityDrag=useRef<{ y:number;value:number } | null>(null);
  useEffect(() => { rangesRef.current=ranges; },[ranges]);
  useEffect(() => { onRangesChangeRef.current=onRangesChange; },[onRangesChange]);

  const stopPreview=() => { if (audioRef.current) { audioRef.current.pause();audioRef.current.currentTime=0;audioRef.current=null; }setPreviewingId(null); };
  const preview=(fragment:Fragment) => { if (previewingId === fragment.id) { stopPreview();return; }stopPreview();const audio=new Audio(fragment.audio);audio.loop=true;audio.volume=.72;audioRef.current=audio;setPreviewingId(fragment.id);audio.play().catch(() => setPreviewingId(null)); };
  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); },[]);

  const changeEdge=(range:EditableRange,edge:Edge,value:number) => {
    const next=rangesRef.current.map((item) => item.id !== range.id ? item : edge === "start" ? { ...item,start:Math.max(0,Math.min(value,item.end - .5)) } : { ...item,end:Math.min(source.duration,Math.max(value,item.start + .5)) });
    rangesRef.current=next;onRangesChangeRef.current(next);
  };

  useEffect(() => {
    if (!dragged) return;
    const move=(event:PointerEvent) => {
      const rulerRect=rulerRef.current?.getBoundingClientRect();
      const timelineRect=timelineRef.current?.getBoundingClientRect();
      const active=rangesRef.current.find((range) => range.id === dragged.rangeId);
      if (!rulerRect || !timelineRect || !active) return;
      const rulerX=Math.max(0,Math.min(rulerRect.width,event.clientX - rulerRect.left));
      const time=rulerX / rulerRect.width * source.duration;
      const next=rangesRef.current.map((item) => item.id !== active.id ? item : dragged.edge === "start" ? { ...item,start:Math.max(0,Math.min(time,item.end - .5)) } : { ...item,end:Math.min(source.duration,Math.max(time,item.start + .5)) });
      rangesRef.current=next;onRangesChangeRef.current(next);
      setMagnifier({ x:Math.max(90,Math.min(timelineRect.width - 90,event.clientX - timelineRect.left)),time,edge:dragged.edge });
    };
    const finish=() => { setDragged(null);setMagnifier(null); };
    window.addEventListener("pointermove",move);
    window.addEventListener("pointerup",finish,{ once:true });
    return () => { window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",finish); };
  },[dragged,source.duration]);

  const beginRangeDrag=(event:ReactPointerEvent<HTMLButtonElement>,range:EditableRange,edge:Edge) => {
    event.preventDefault();event.stopPropagation();
    const timelineRect=timelineRef.current?.getBoundingClientRect();
    const rulerRect=rulerRef.current?.getBoundingClientRect();
    const time=edge === "start" ? range.start : range.end;
    const clientX=(rulerRect?.left ?? 0) + time / source.duration * (rulerRect?.width ?? 0);
    setMagnifier({ x:timelineRect ? Math.max(90,Math.min(timelineRect.width - 90,clientX - timelineRect.left)) : 90,time,edge });
    setDragged({ rangeId:range.id,edge });
  };

  const beginSensitivityDrag=(event:ReactPointerEvent<HTMLButtonElement>) => { event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);sensitivityDrag.current={ y:event.clientY,value:sensitivity }; };
  const moveSensitivityDrag=(event:ReactPointerEvent<HTMLButtonElement>) => { if (!sensitivityDrag.current) return;onSensitivityChange(Math.max(10,Math.min(90,Math.round(sensitivityDrag.current.value + (sensitivityDrag.current.y - event.clientY) * .75)))); };
  const finishSensitivityDrag=(event:ReactPointerEvent<HTMLButtonElement>) => { sensitivityDrag.current=null;if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const fragmentFor=(range:EditableRange) => range.fragmentId ? fragments.find((fragment) => fragment.id === range.fragmentId) ?? null : null;
  const close=() => { stopPreview();onClose(); };

  return <aside className="source-editor fragmentation-workbench">
    <div className="source-editor-title"><h2>Fragmentation</h2><button className="panel-close" onClick={close} aria-label="Close fragmentation panel">×</button></div>
    <div className="source-editor-head"><div><h3>{source.name}</h3><p>{source.format} · {source.device}{analysisMeta?.bpm ? ` · ${analysisMeta.bpm} BPM` : ""}{analysisMeta?.key && analysisMeta.scale ? ` · ${analysisMeta.key} ${analysisMeta.scale}` : ""}</p></div>{source.fragmentIds[0] && fragments.find((fragment) => fragment.id === source.fragmentIds[0]) && <button className="soft-button" onClick={() => preview(fragments.find((fragment) => fragment.id === source.fragmentIds[0])!)}>{previewingId === source.fragmentIds[0] ? "Ⅱ Stop" : "▶ Play"}</button>}</div>
    <div className="timeline-card" ref={timelineRef}>
      <div className="fragment-lanes-scroll"><div className="fragment-lanes" ref={rulerRef} style={{ height:`${ranges.length * 23 + 4}px` }}>{ranges.map((range,index) => <div className={`fragment-lane ${range.fragmentId === focusedFragmentId ? "focused" : ""}`} key={range.id} style={{ top:`${index * 23}px`,"--fragment-color":range.color } as CSSProperties}>
        <div className="fragment-bar" style={{ left:`${range.start / source.duration * 100}%`,width:`${(range.end - range.start) / source.duration * 100}%` }}>
          <button className="range-handle start" onPointerDown={(event) => beginRangeDrag(event,range,"start")} onKeyDown={(event) => { const step=event.shiftKey ? 1 : .25;if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault();changeEdge(range,"start",range.start + (event.key === "ArrowLeft" ? -step : step)); } }} aria-label={`Adjust start of fragment ${index + 1}`} />
          <span>F{String(index + 1).padStart(2,"0")} · {formatSeconds(range.start)}–{formatSeconds(range.end)}</span>
          <button className="range-handle end" onPointerDown={(event) => beginRangeDrag(event,range,"end")} onKeyDown={(event) => { const step=event.shiftKey ? 1 : .25;if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault();changeEdge(range,"end",range.end + (event.key === "ArrowLeft" ? -step : step)); } }} aria-label={`Adjust end of fragment ${index + 1}`} />
        </div>
      </div>)}</div></div>
      {magnifier && dragged && <div className="ruler-edge-magnifier" style={{ left:`${magnifier.x}px` }}><strong>{magnifier.edge} · {formatSeconds(magnifier.time)}</strong><ContinuousWaveform values={waveformSlice(waveform,magnifier.time,source.duration)} /></div>}
      <div className="timeline-labels"><span>0:00</span><span>{formatSeconds(source.duration / 2)}</span><span>{formatSeconds(source.duration)}</span></div>
      <div className="continuous-wave-wrap"><ContinuousWaveform values={waveform}/>{ranges.map((range,index) => { const fragment=fragmentFor(range);return <div className={`wave-range ${fragment && previewingId === fragment.id ? "auditioning" : ""}`} key={range.id} style={{ left:`${range.start / source.duration * 100}%`,width:`${(range.end - range.start) / source.duration * 100}%`,"--fragment-color":range.color } as CSSProperties}><span>F{index + 1}</span>{fragment && previewingId === fragment.id && <i className="fragment-scan-playhead" />}</div>; })}</div>
      <div className="fragment-summary"><strong>{ranges.length} fragments</strong><span>Drag a ruler edge to trim · Shift + arrow for 1 second</span></div>
    </div>
    <div className="source-lower">
      <div className="sensitivity-card"><div><h3>Sensitivity</h3><p>Higher sensitivity surfaces shorter gestures and adds fragment ranges.</p></div><div className="knob-control"><button className="knob" role="slider" aria-label="Fragmentation sensitivity" aria-valuemin={10} aria-valuemax={90} aria-valuenow={sensitivity} style={{ "--angle":`${-130 + (sensitivity - 10) / 80 * 260}deg`,"--sweep":`${(sensitivity - 10) / 80 * 260}deg` } as CSSProperties} onPointerDown={beginSensitivityDrag} onPointerMove={moveSensitivityDrag} onPointerUp={finishSensitivityDrag} onPointerCancel={finishSensitivityDrag} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault();onSensitivityChange(Math.min(90,sensitivity + 4)); }if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault();onSensitivityChange(Math.max(10,sensitivity - 4)); } }}><i /></button><strong>{sensitivity < 36 ? "Broad" : sensitivity > 66 ? "Sensitive" : "Balanced"}</strong></div></div>
      <div className="detected-card"><div className="detected-head"><h3>Fragments</h3><div className="detected-actions"><button onClick={onAddRange}>＋ Add fragment</button><button onClick={onSave}>{saveLabel}</button></div></div>{ranges.map((range,index) => { const fragment=fragmentFor(range);return <div className={`detected-row ${range.fragmentId === focusedFragmentId ? "focused" : ""}`} key={range.id}><i className="range-swatch" style={{ background:range.color }} />{fragment ? <button className={`fragment-audition ${previewingId === fragment.id ? "playing" : ""}`} onClick={() => preview(fragment)} aria-label={`${previewingId === fragment.id ? "Stop" : "Play"} fragment ${fragment.name}`}>{previewingId === fragment.id ? "Ⅱ" : "▶"}</button> : <button className="fragment-audition" disabled aria-label="Save this fragment before auditioning">▶</button>}<span><b>{fragment?.name ?? `Untitled fragment ${index + 1}`}</b><small>{formatSeconds(range.start)}–{formatSeconds(range.end)} · {Math.round(range.end - range.start)} sec</small></span>{fragment && onOpenFragment ? <button onClick={() => onOpenFragment(fragment.id)}>Open →</button> : <em>{fragment ? (fragment.id === focusedFragmentId ? "Editing" : "Saved") : "New"}</em>}</div>; })}</div>
    </div>
    {footerContent}
  </aside>;
}
