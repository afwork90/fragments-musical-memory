"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Play, Square } from "lucide-react";
import { KeyboardEvent } from "react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { Button } from "@/lib/ui/button";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import type { ProcessedAudio } from "@/lib/audio/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/lib/ui/table";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/format";
import { Fragment, SourceFile } from "../../prototype-data";
import { EditableRange } from "../../fragmentation-workbench";
import { SOURCE_COLUMNS, toggleSourceSort } from "./source-columns";
import { SourceSort, SourceSortColumn } from "./types";

type SourceTableProps = {
  sources: SourceFile[];
  sourceRanges: Record<string, EditableRange[]>;
  selectedSourceId: string;
  editorOpen: boolean;
  previewingId: string | null;
  sort: SourceSort;
  onSortChange: (sort: SourceSort) => void;
  onSelectSource: (sourceId: string) => void;
  onOpenFragmentation: (sourceId: string) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
  getFragmentById: (id: string) => Fragment;
};

function SortIcon({ column, sort }: { column: SourceSortColumn; sort: SourceSort }) {
  if (sort.column !== column) return <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />;
  return sort.direction === "asc"
    ? <ArrowUp className="size-3" aria-hidden="true" />
    : <ArrowDown className="size-3" aria-hidden="true" />;
}

function sourceAnalysis(source: SourceFile, cached?: ProcessedAudio) {
  return {
    bpm: cached?.analysis.bpm ?? source.bpm ?? null,
    key: cached?.analysis.key ?? source.key ?? null,
    scale: cached?.analysis.scale ?? source.scale ?? null,
    keyStrength: cached?.analysis.keyStrength ?? null,
  };
}

function formatTempoKey(source: SourceFile, cached?: ProcessedAudio) {
  const { bpm, key, scale } = sourceAnalysis(source, cached);
  const keyLabel = key && scale ? `${key} ${scale}` : null;
  if (!bpm && !keyLabel) return "—";
  if (bpm && keyLabel) return `${bpm} BPM · ${keyLabel}`;
  if (bpm) return `${bpm} BPM`;
  return keyLabel ?? "—";
}

function SourceSignalCell({
  source,
  isPreviewing,
  onPreview,
}: {
  source: SourceFile;
  isPreviewing: boolean;
  onPreview: () => void;
}) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const values = cached?.peaks ?? source.waveform;
  const canPlay = Boolean(source.audioUrl);

  return (
    <div className="source-signal-cell flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("source-play-button size-7 shrink-0", isPreviewing && "text-primary")}
        disabled={!canPlay}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        aria-label={`${isPreviewing ? "Stop" : "Play"} ${source.name}`}
      >
        {isPreviewing ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
      </Button>
      <ContinuousWaveform
        values={values}
        active={isPreviewing}
        className="source-signal-wave h-11 min-w-[180px] flex-1"
      />
    </div>
  );
}

function SourceTempoKeyCell({ source }: { source: SourceFile }) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const { keyStrength } = sourceAnalysis(source, cached);
  const label = formatTempoKey(source, cached);

  return (
    <span className="block truncate" title={label}>
      {label}
      {keyStrength != null && label !== "—" ? ` (${keyStrength}%)` : ""}
    </span>
  );
}

function columnHeadClass(columnId: SourceSortColumn) {
  return cn(
    columnId === "signal" && "min-w-[240px] w-[30%]",
    columnId === "tempoKey" && "min-w-[120px]",
  );
}

function SourceTableCell({
  columnId,
  source,
  fragmentCount,
  isPreviewing,
  onPreview,
  onOpenFragmentation,
}: {
  columnId: SourceSortColumn;
  source: SourceFile;
  fragmentCount: number;
  isPreviewing: boolean;
  onPreview: () => void;
  onOpenFragmentation: () => void;
}) {
  switch (columnId) {
    case "name":
      return (
        <TableCell className="max-w-[180px] px-2 py-2 font-medium text-foreground">
          <span className="block truncate" title={source.name}>
            {source.name}
          </span>
        </TableCell>
      );
    case "signal":
      return (
        <TableCell className="px-2 py-1.5">
          <SourceSignalCell source={source} isPreviewing={isPreviewing} onPreview={onPreview} />
        </TableCell>
      );
    case "date":
      return <TableCell className="px-2 py-2">{source.date}</TableCell>;
    case "duration":
      return <TableCell className="px-2 py-2">{formatSeconds(source.duration)}</TableCell>;
    case "type":
      return (
        <TableCell className="max-w-[120px] truncate px-2 py-2" title={source.sourceTypes.join(", ")}>
          {source.sourceTypes.join(" · ")}
        </TableCell>
      );
    case "profile":
      return (
        <TableCell
          className="max-w-[140px] truncate px-2 py-2"
          title={`${source.analysisProfile.detectors.join(", ")} · ${source.analysisProfile.tempoStrategy}`}
        >
          {source.analysisProfile.name}
        </TableCell>
      );
    case "format":
      return (
        <TableCell className="px-2 py-2" title={source.format}>
          {source.format.split(" · ")[0]}
        </TableCell>
      );
    case "tempoKey":
      return (
        <TableCell className="max-w-[160px] truncate px-2 py-2 text-foreground/90">
          <SourceTempoKeyCell source={source} />
        </TableCell>
      );
    case "fragments":
      return (
        <TableCell className="px-2 py-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-[11px] font-medium"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFragmentation();
            }}
          >
            Fragment ({fragmentCount})
          </Button>
        </TableCell>
      );
    default:
      return null;
  }
}

export function SourceTable({
  sources,
  sourceRanges,
  selectedSourceId,
  editorOpen,
  previewingId,
  sort,
  onSortChange,
  onSelectSource,
  onOpenFragmentation,
  onPreviewFragment,
  onPreviewSource,
  getFragmentById,
}: SourceTableProps) {
  const handleRowKeyDown = (sourceId: string) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectSource(sourceId);
    }
  };

  return (
    <div className="source-table rounded-md border border-border bg-card/40">
      <Table>
        <TableHeader>
          <TableRow className="border-border/80 hover:bg-transparent">
            {SOURCE_COLUMNS.map((column) => (
              <TableHead
                key={column.id}
                className={cn(
                  "h-8 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                  columnHeadClass(column.id),
                )}
                aria-sort={
                  sort.column === column.id
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  className="inline-flex w-full items-center justify-between gap-1 text-left hover:text-foreground"
                  onClick={() => onSortChange(toggleSourceSort(column.id, sort))}
                >
                  {column.label}
                  <SortIcon column={column.id} sort={sort} />
                </button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => {
            const auditionId = source.fragmentIds[0];
            const auditionFragment = auditionId ? getFragmentById(auditionId) : null;
            const previewKey = auditionFragment?.id ?? `source:${source.id}`;
            const isPreviewing = previewingId === previewKey;
            const isSelected = editorOpen && selectedSourceId === source.id;
            const fragmentCount = sourceRanges[source.id]?.length ?? 0;

            return (
              <TableRow
                key={source.id}
                tabIndex={0}
                className={cn(
                  "cursor-pointer border-border/60 text-[11px] text-muted-foreground transition-colors",
                  "hover:bg-white/[0.04] hover:text-foreground/85",
                  isSelected && "source-row-selected border-l-2 border-l-[var(--violet)] text-foreground",
                )}
                onClick={() => onSelectSource(source.id)}
                onKeyDown={handleRowKeyDown(source.id)}
              >
                {SOURCE_COLUMNS.map((column) => (
                  <SourceTableCell
                    key={column.id}
                    columnId={column.id}
                    source={source}
                    fragmentCount={fragmentCount}
                    isPreviewing={isPreviewing}
                    onPreview={() => {
                      if (auditionFragment) onPreviewFragment(auditionFragment);
                      else onPreviewSource(source);
                    }}
                    onOpenFragmentation={() => onOpenFragmentation(source.id)}
                  />
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {sources.length === 0 && (
        <div className="empty-inline border-t border-border/60">No sources match that search.</div>
      )}
    </div>
  );
}
