"use client";

import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MusicalRole } from "./prototype-data";

export type LibraryColumnId = "name" | "source" | "signal" | "date" | "start" | "end" | "duration" | "bars" | "key" | "tempo" | "confidence" | "tags" | "role" | "links" | "takes";
export type NumericFilter = { comparison:"gt" | "lt";value:string };
export type DateFilter = { comparison:"after" | "before";value:string };
export type BarsFilter = NumericFilter & { metric:"bars" | "beats" };

export interface LibraryFilters {
  name:string;
  source:string;
  signal:NumericFilter;
  date:DateFilter;
  start:NumericFilter;
  end:NumericFilter;
  duration:NumericFilter;
  bars:BarsFilter;
  key:string[];
  tempo:NumericFilter;
  confidence:NumericFilter;
  tags:string[];
  role:MusicalRole[];
  links:NumericFilter;
  takes:NumericFilter;
}

export const createLibraryFilters = ():LibraryFilters => ({
  name:"",source:"",signal:{ comparison:"gt",value:"" },date:{ comparison:"after",value:"" },start:{ comparison:"gt",value:"" },end:{ comparison:"gt",value:"" },duration:{ comparison:"gt",value:"" },bars:{ comparison:"gt",value:"",metric:"bars" },key:[],tempo:{ comparison:"gt",value:"" },confidence:{ comparison:"gt",value:"" },tags:[],role:[],links:{ comparison:"gt",value:"" },takes:{ comparison:"gt",value:"" },
});

export const libraryFilterIsActive = (filters:LibraryFilters,column:LibraryColumnId) => {
  const filter=filters[column];
  if (typeof filter === "string") return filter.trim().length > 0;
  if (Array.isArray(filter)) return filter.length > 0;
  if (column === "date") return filter.value.trim().length > 0 && Number.isFinite(Date.parse(filter.value));
  return filter.value.trim().length > 0 && Number.isFinite(Number(filter.value));
};

export const activeLibraryFilterCount = (filters:LibraryFilters) => (Object.keys(filters) as LibraryColumnId[]).filter((column) => libraryFilterIsActive(filters,column)).length;

const LABELS:Record<LibraryColumnId,string> = {
  name:"Fragment",source:"Source",signal:"Signal brightness",date:"Recorded",start:"Start",end:"End",duration:"Length",bars:"Bars / beats",key:"Key",tempo:"BPM",confidence:"Confidence",tags:"Tags",role:"Role",links:"Matches",takes:"Takes",
};

const NUMBER_META:Partial<Record<LibraryColumnId,{ min:number;max?:number;step:number;unit:string }>> = {
  signal:{ min:0,max:100,step:1,unit:"brightness" },start:{ min:0,step:1,unit:"seconds" },end:{ min:0,step:1,unit:"seconds" },duration:{ min:0,step:1,unit:"seconds" },bars:{ min:0,step:1,unit:"" },tempo:{ min:1,max:300,step:1,unit:"BPM" },confidence:{ min:0,max:100,step:1,unit:"%" },links:{ min:0,step:1,unit:"matches" },takes:{ min:0,step:1,unit:"takes" },
};

interface ColumnFilterPopoverProps {
  column:LibraryColumnId;
  filters:LibraryFilters;
  position:{ left:number;top:number };
  triggerElement:HTMLButtonElement | null;
  keyOptions:string[];
  tagOptions:string[];
  roleOptions:MusicalRole[];
  resultCount:number;
  totalCount:number;
  onChange:(filters:LibraryFilters) => void;
  onClose:() => void;
}

export function ColumnFilterPopover({ column,filters,position,triggerElement,keyOptions,tagOptions,roleOptions,resultCount,totalCount,onChange,onClose }:ColumnFilterPopoverProps) {
  const popoverRef=useRef<HTMLElement>(null);
  const [resolvedPosition,setResolvedPosition]=useState(position);
  const label=LABELS[column];

  useLayoutEffect(() => {
    const place=() => {
      const popover=popoverRef.current;
      if (!popover) return;
      const trigger=triggerElement?.getBoundingClientRect();
      if (trigger && (trigger.bottom <= 0 || trigger.top >= window.innerHeight || trigger.right <= 0 || trigger.left >= window.innerWidth)) { onClose();return; }
      const width=popover.offsetWidth || 286;
      const height=popover.offsetHeight || 120;
      const left=Math.max(8,Math.min(trigger?.left ?? position.left,window.innerWidth - width - 8));
      const below=(trigger?.bottom ?? position.top) + 5;
      const candidateTop=below + height > window.innerHeight ? (trigger?.top ?? position.top) - height - 5 : below;
      const top=Math.max(8,Math.min(candidateTop,window.innerHeight - height - 8));
      setResolvedPosition({ left,top });
    };
    place();window.addEventListener("resize",place);document.addEventListener("scroll",place,true);
    return () => { window.removeEventListener("resize",place);document.removeEventListener("scroll",place,true); };
  },[column,onClose,position.left,position.top,triggerElement]);

  useEffect(() => {
    const frame=window.requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>("input, select")?.focus());
    const outside=(event:PointerEvent) => {
      const target=event.target as Node;
      if (popoverRef.current?.contains(target) || triggerElement?.contains(target)) return;
      onClose();
    };
    const keyboard=(event:KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();onClose();window.setTimeout(() => triggerElement?.focus(),0);
    };
    document.addEventListener("pointerdown",outside);
    document.addEventListener("keydown",keyboard);
    return () => { window.cancelAnimationFrame(frame);document.removeEventListener("pointerdown",outside);document.removeEventListener("keydown",keyboard); };
  },[onClose,triggerElement]);

  const replace = <K extends keyof LibraryFilters>(key:K,value:LibraryFilters[K]) => onChange({ ...filters,[key]:value });
  const clear = () => { const defaults=createLibraryFilters();replace(column,defaults[column]); };
  const closeAndReturn = () => { onClose();window.setTimeout(() => triggerElement?.focus(),0); };
  const toggleMulti = (key:"key" | "tags" | "role",value:string) => {
    const current=filters[key] as string[];
    replace(key,(current.includes(value) ? current.filter((item) => item !== value) : [...current,value]) as LibraryFilters[typeof key]);
  };
  const renderMulti = (key:"key" | "tags" | "role",options:string[]) => <div className="column-filter-options" role="group" aria-label={`${label} choices`}>{options.map((option) => { const checked=(filters[key] as string[]).includes(option);return <label className={checked ? "selected" : ""} key={option}><input type="checkbox" checked={checked} onChange={() => toggleMulti(key,option)}/><span>{option}</span></label>; })}</div>;
  const renderNumeric = () => {
    const filter=filters[column] as NumericFilter;
    const meta=NUMBER_META[column]!;
    return <div className={`column-filter-compare ${column === "bars" ? "bars-filter" : ""}`}>
      {column === "bars" && <select aria-label="Bars or beats" value={(filters.bars).metric} onChange={(event) => replace("bars",{ ...filters.bars,metric:event.target.value as BarsFilter["metric"] })}><option value="bars">Bars</option><option value="beats">Beats</option></select>}
      <select aria-label={`${label} comparison`} value={filter.comparison} onChange={(event) => replace(column,{ ...filter,comparison:event.target.value as NumericFilter["comparison"] } as LibraryFilters[typeof column])}><option value="gt">Greater than</option><option value="lt">Less than</option></select>
      <label><span className="sr-only">{label} number</span><input type="number" inputMode="decimal" min={meta.min} max={meta.max} step={meta.step} value={filter.value} onChange={(event) => replace(column,{ ...filter,value:event.target.value } as LibraryFilters[typeof column])} placeholder="Number"/></label>
      {meta.unit && <small>{meta.unit}</small>}
    </div>;
  };

  return <section ref={popoverRef} id={`filter-${column}`} className="column-filter-popover" role="dialog" aria-label={`Filter ${label}`} style={{ left:resolvedPosition.left,top:resolvedPosition.top } as CSSProperties}>
    <header><b>{label}</b><span aria-live="polite">{resultCount} / {totalCount}</span></header>
    {(column === "name" || column === "source") && <label className="column-filter-text"><span>Contains</span><input value={filters[column]} onChange={(event) => replace(column,event.target.value)} placeholder={`Filter ${label.toLowerCase()}`}/></label>}
    {column === "date" && <div className="column-filter-compare date-filter"><select aria-label="Recorded comparison" value={filters.date.comparison} onChange={(event) => replace("date",{ ...filters.date,comparison:event.target.value as DateFilter["comparison"] })}><option value="after">After</option><option value="before">Before</option></select><label><span className="sr-only">Recorded date</span><input type="date" value={filters.date.value} onChange={(event) => replace("date",{ ...filters.date,value:event.target.value })}/></label></div>}
    {(["signal","start","end","duration","bars","tempo","confidence","links","takes"] as LibraryColumnId[]).includes(column) && renderNumeric()}
    {column === "key" && renderMulti("key",keyOptions)}
    {column === "tags" && renderMulti("tags",tagOptions)}
    {column === "role" && renderMulti("role",roleOptions)}
    <footer><button onClick={clear} disabled={!libraryFilterIsActive(filters,column)}>Clear</button><button className="filter-done" onClick={closeAndReturn}>Done</button></footer>
  </section>;
}
