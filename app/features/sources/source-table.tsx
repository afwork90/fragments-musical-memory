"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { KeyboardEvent } from "react";
import { SignalCell } from "@/lib/audio/signal-cell";
import { resolveSourceAudioUrl } from "@/lib/audio/source-playback";
import { resolvedSourceAnalysis } from "@/lib/audio/source-metadata";
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
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";
import { EditableRange } from "../../fragmentation-workbench";
import { SOURCE_COLUMNS, toggleSourceSort } from "./source-columns";
import { SourceRowActions } from "./source-row-actions";
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
  onRemoveSource: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
  canDeleteFiles: boolean;
  getFragmentById: (id: string) => Fragment;
};

function SortIcon({ column, sort }: { column: SourceSortColumn; sort: SourceSort }) {
  if (sort.column !== column) return <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />;
  return sort.direction === "asc"
    ? <ArrowUp className="size-3" aria-hidden="true" />
    : <ArrowDown className="size-3" aria-hidden="true" />;
}

function sourceAnalysis(source: SourceFile, cached?: ProcessedAudio) {
  return resolvedSourceAnalysis(source, cached);
}

function formatTempo(source: SourceFile, cached?: ProcessedAudio) {
  const { bpm } = sourceAnalysis(source, cached);
  return bpm ? `${bpm} BPM` : "—";
}

function formatKey(source: SourceFile, cached?: ProcessedAudio) {
  const { key, scale } = sourceAnalysis(source, cached);
  return key && scale ? `${key} ${scale}` : "—";
}

function SourceSignalCell({
  source,
  isPreviewing,
  canPlay,
  onPreview,
}: {
  source: SourceFile;
  isPreviewing: boolean;
  canPlay: boolean;
  onPreview: () => void;
}) {
  return (
    <SignalCell
      values={source.waveform}
      sourceId={source.id}
      cacheSourceAudio={Boolean(source.audioCacheKey)}
      isPreviewing={isPreviewing}
      canPlay={canPlay}
      onPreview={onPreview}
      ariaLabel={`${isPreviewing ? "Stop" : "Play"} ${source.name}`}
      desktopDrag={{ audioUrl: source.audioUrl, fileName: `${source.name}.wav` }}
    />
  );
}

function SourceTempoCell({ source }: { source: SourceFile }) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const label = formatTempo(source, cached);

  return <span className="block truncate" title={label}>{label}</span>;
}

function SourceKeyCell({ source }: { source: SourceFile }) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const { keyStrength } = sourceAnalysis(source, cached);
  const label = formatKey(source, cached);

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
    columnId === "tempo" && "min-w-[80px]",
    columnId === "key" && "min-w-[90px]",
  );
}

function sourceTableCellClass(extra?: string) {
  return cn("source-table-cell", extra);
}

function SourceTableCell({
  columnId,
  source,
  fragmentCount,
  isPreviewing,
  canPlay,
  onPreview,
  onOpenFragmentation,
  onRemoveSource,
  onDeleteSource,
  canDeleteFiles,
}: {
  columnId: SourceSortColumn;
  source: SourceFile;
  fragmentCount: number;
  isPreviewing: boolean;
  canPlay: boolean;
  onPreview: () => void;
  onOpenFragmentation: () => void;
  onRemoveSource: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
  canDeleteFiles: boolean;
}) {
  switch (columnId) {
    case "name":
      return (
        <TableCell className={sourceTableCellClass("max-w-[180px]")}>
          <span className="source-table-name block truncate" title={source.id}>
            {source.name}
          </span>
        </TableCell>
      );
    case "signal":
      return (
        <TableCell className={sourceTableCellClass()}>
          <SourceSignalCell source={source} isPreviewing={isPreviewing} canPlay={canPlay} onPreview={onPreview} />
        </TableCell>
      );
    case "date":
      return <TableCell className={sourceTableCellClass()}>{source.date}</TableCell>;
    case "duration":
      return <TableCell className={sourceTableCellClass()}>{formatSeconds(source.duration)}</TableCell>;
    case "type":
      return (
        <TableCell className={sourceTableCellClass("max-w-[120px] truncate")} title={source.sourceTypes.join(", ")}>
          {source.sourceTypes.join(" · ")}
        </TableCell>
      );
    case "format":
      return (
        <TableCell className={sourceTableCellClass()} title={source.format}>
          {source.format.split(" · ")[0]}
        </TableCell>
      );
    case "tempo":
      return (
        <TableCell className={sourceTableCellClass("max-w-[100px] truncate text-foreground/90")}>
          <SourceTempoCell source={source} />
        </TableCell>
      );
    case "key":
      return (
        <TableCell className={sourceTableCellClass("max-w-[120px] truncate text-foreground/90")}>
          <SourceKeyCell source={source} />
        </TableCell>
      );
    case "fragments":
      return (
        <TableCell className={sourceTableCellClass()}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="library-card-action h-8 px-3 text-[12px] font-medium"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFragmentation();
            }}
          >
            Fragment ({fragmentCount})
          </Button>
        </TableCell>
      );
    case "actions":
      return (
        <TableCell className={sourceTableCellClass("w-10")}>
          <SourceRowActions
            source={source}
            onRemove={onRemoveSource}
            onDelete={onDeleteSource}
            canDeleteFiles={canDeleteFiles}
          />
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
  onRemoveSource,
  onDeleteSource,
  canDeleteFiles,
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
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="border-border/80 hover:bg-transparent">
            {SOURCE_COLUMNS.map((column) => (
              <TableHead
                key={column.id}
                className={cn(
                  "h-9 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                  columnHeadClass(column.id),
                  column.id === "actions" && "w-10",
                )}
                aria-sort={
                  column.id === "actions"
                    ? undefined
                    : sort.column === column.id
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                }
              >
                {column.id === "actions" ? (
                  <span className="sr-only">Actions</span>
                ) : (
                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-between gap-1 text-left hover:text-foreground"
                    onClick={() => onSortChange(toggleSourceSort(column.id, sort))}
                  >
                    {column.label}
                    <SortIcon column={column.id} sort={sort} />
                  </button>
                )}
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
                  "source-table-data-row cursor-pointer border-border/60 transition-colors",
                  "hover:bg-white/[0.04] hover:text-foreground/85",
                  isSelected && "source-row-selected border-l-2 border-l-[var(--violet)] text-foreground",
                )}
                onClick={(event) => {
                  // Playback and row actions never open the detail panel.
                  if ((event.target as HTMLElement).closest(".source-signal-cell, .source-row-actions")) return;
                  onSelectSource(source.id);
                }}
                onKeyDown={handleRowKeyDown(source.id)}
              >
                {SOURCE_COLUMNS.map((column) => (
                  <SourceTableCell
                    key={column.id}
                    columnId={column.id}
                    source={source}
                    fragmentCount={fragmentCount}
                    isPreviewing={isPreviewing}
                    canPlay={Boolean(resolveSourceAudioUrl(source, (id) => getFragmentById(id).audio))}
                    onPreview={() => {
                      if (auditionFragment) onPreviewFragment(auditionFragment);
                      else onPreviewSource(source);
                    }}
                    onOpenFragmentation={() => onOpenFragmentation(source.id)}
                    onRemoveSource={onRemoveSource}
                    onDeleteSource={onDeleteSource}
                    canDeleteFiles={canDeleteFiles}
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
