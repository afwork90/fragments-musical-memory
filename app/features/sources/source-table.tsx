"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { KeyboardEvent } from "react";
import { SignalCell } from "@/lib/audio/signal-cell";
import { resolveSourceAudioUrl } from "@/lib/audio/source-playback";
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
}: {
  columnId: SourceSortColumn;
  source: SourceFile;
  fragmentCount: number;
  isPreviewing: boolean;
  canPlay: boolean;
  onPreview: () => void;
  onOpenFragmentation: () => void;
  onRemoveSource: (sourceId: string) => void;
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
    case "profile":
      return (
        <TableCell
          className={sourceTableCellClass("max-w-[140px] truncate")}
          title={`${source.analysisProfile.detectors.join(", ")} · ${source.analysisProfile.tempoStrategy}`}
        >
          {source.analysisProfile.name}
        </TableCell>
      );
    case "format":
      return (
        <TableCell className={sourceTableCellClass()} title={source.format}>
          {source.format.split(" · ")[0]}
        </TableCell>
      );
    case "tempoKey":
      return (
        <TableCell className={sourceTableCellClass("max-w-[160px] truncate text-foreground/90")}>
          <SourceTempoKeyCell source={source} />
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
          <SourceRowActions source={source} onRemove={onRemoveSource} />
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
