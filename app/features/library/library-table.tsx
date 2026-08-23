"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";
import { KeyboardEvent } from "react";
import { SignalCell } from "@/lib/audio/signal-cell";
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
import { libraryFilterIsActive, LibraryFilters } from "../../library-filter-popover";
import { Fragment, SourceFile } from "../../prototype-data";
import { LIBRARY_COLUMNS, toggleLibrarySort } from "./library-columns";
import { LibraryItem } from "./library-items";
import { LibraryLinkSummary } from "./library-list";
import { LibraryFilterMenu, LibrarySort, LibrarySortColumn } from "./types";

type LibraryTableProps = {
  items: LibraryItem[];
  selectedId: string;
  connectionsOpen: boolean;
  previewingId: string | null;
  sort: LibrarySort;
  filters: LibraryFilters;
  filterMenu: LibraryFilterMenu | null;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  onSortChange: (sort: LibrarySort) => void;
  onOpenColumnFilter: (column: LibrarySortColumn, trigger: HTMLButtonElement) => void;
  onSelectFragment: (fragmentId: string) => void;
  onSelectSource: (source: SourceFile) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
};

function SortIcon({ column, sort }: { column: LibrarySortColumn; sort: LibrarySort }) {
  if (sort.column !== column) return <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />;
  return sort.direction === "asc"
    ? <ArrowUp className="size-3" aria-hidden="true" />
    : <ArrowDown className="size-3" aria-hidden="true" />;
}

function LibraryTableCell({
  columnId,
  item,
  sourceNameFor,
  sourceForId,
  linkSummaryFor,
  previewingId,
  onPreviewFragment,
  onPreviewSource,
}: {
  columnId: LibrarySortColumn;
  item: LibraryItem;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  previewingId: string | null;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
}) {
  if (item.kind === "source") {
    const source = item.source;
    const previewKey = `source:${source.id}`;
    const isPreviewing = previewingId === previewKey;
    const linkCount = source.fragmentIds.reduce((sum, id) => sum + linkSummaryFor(id).total, 0);
    const hasConnections = linkCount > 0;

    switch (columnId) {
      case "name":
        return (
          <TableCell
            className={cn(
              "max-w-[180px] px-2 py-2 font-medium text-foreground",
              !hasConnections && "text-muted-foreground",
            )}
          >
            <span className="block truncate" title={source.name}>{source.name}</span>
          </TableCell>
        );
      case "source":
        return <TableCell className="px-2 py-2 text-muted-foreground">—</TableCell>;
      case "signal":
        return (
          <TableCell className="px-2 py-1.5">
            <SignalCell
              values={source.waveform}
              sourceId={source.id}
              cacheSourceAudio={Boolean(source.audioCacheKey)}
              isPreviewing={isPreviewing}
              canPlay={Boolean(source.audioUrl)}
              onPreview={() => onPreviewSource(source)}
              ariaLabel={`${isPreviewing ? "Stop" : "Play"} ${source.name}`}
              waveClassName="source-signal-wave h-11 min-w-[140px] flex-1"
            />
          </TableCell>
        );
      case "date":
        return <TableCell className="px-2 py-2">{source.date}</TableCell>;
      case "start":
      case "end":
        return <TableCell className="px-2 py-2 text-muted-foreground">—</TableCell>;
      case "duration":
        return <TableCell className="px-2 py-2">{formatSeconds(source.duration)}</TableCell>;
      case "key": {
        const key = source.key;
        const scale = source.scale;
        const keyLabel = key && scale ? `${key} ${scale}` : key;
        return <TableCell className="max-w-[120px] truncate px-2 py-2">{keyLabel ?? "—"}</TableCell>;
      }
      case "tempo":
        return <TableCell className="px-2 py-2">{source.bpm ?? "—"}</TableCell>;
      case "links":
        return (
          <TableCell className="px-2 py-2">
            <span className={hasConnections ? "text-foreground" : "text-muted-foreground"}>{linkCount}</span>
          </TableCell>
        );
      default:
        return null;
    }
  }

  const fragment = item.fragment;
  const source = sourceForId(fragment.sourceId);
  const sourceName = sourceNameFor(fragment);
  const links = linkSummaryFor(fragment.id);
  const hasConnections = links.total > 0;
  const slice = source
    ? { start: fragment.start, end: fragment.end, duration: source.duration }
    : undefined;

  switch (columnId) {
    case "name":
      return (
        <TableCell
          className={cn(
            "max-w-[180px] px-2 py-2 font-medium text-foreground",
            links.total === 0 && "text-muted-foreground",
          )}
        >
          <span className="block truncate" title={fragment.name}>{fragment.name}</span>
        </TableCell>
      );
    case "source":
      return (
        <TableCell className="max-w-[140px] truncate px-2 py-2" title={sourceName}>
          {sourceName}
        </TableCell>
      );
    case "signal":
      return (
        <TableCell className="px-2 py-1.5">
          <SignalCell
            values={fragment.waveform}
            sourceId={fragment.sourceId}
            cacheSourceAudio
            slice={slice}
            isPreviewing={previewingId === fragment.id}
            onPreview={() => onPreviewFragment(fragment)}
            ariaLabel={`${previewingId === fragment.id ? "Stop" : "Play"} ${fragment.name}`}
            waveClassName="source-signal-wave h-11 min-w-[140px] flex-1"
          />
        </TableCell>
      );
    case "date":
      return <TableCell className="px-2 py-2">{fragment.dateLabel}</TableCell>;
    case "start":
      return <TableCell className="px-2 py-2">{formatSeconds(fragment.start)}</TableCell>;
    case "end":
      return <TableCell className="px-2 py-2">{formatSeconds(fragment.end)}</TableCell>;
    case "duration":
      return <TableCell className="px-2 py-2">{formatSeconds(fragment.end - fragment.start)}</TableCell>;
    case "key":
      return (
        <TableCell
          className="max-w-[100px] truncate px-2 py-2"
          title={fragment.alternateKeys.length ? `Also: ${fragment.alternateKeys.join(", ")}` : fragment.key}
        >
          {fragment.key}
          {fragment.alternateKeys.length > 0 && (
            <span className="ml-1 text-muted-foreground/70">+{fragment.alternateKeys.length}</span>
          )}
        </TableCell>
      );
    case "tempo":
      return <TableCell className="px-2 py-2">{fragment.bpm}</TableCell>;
    case "links":
      return (
        <TableCell className="px-2 py-2">
          <span className="text-foreground">{links.total}</span>
          {links.manual > 0 && (
            <span className="ml-1 text-[var(--amber)]">manual matches {links.manual}</span>
          )}
        </TableCell>
      );
    default:
      return null;
  }
}

export function LibraryTable({
  items,
  selectedId,
  connectionsOpen,
  previewingId,
  sort,
  filters,
  filterMenu,
  sourceNameFor,
  sourceForId,
  linkSummaryFor,
  onSortChange,
  onOpenColumnFilter,
  onSelectFragment,
  onSelectSource,
  onPreviewFragment,
  onPreviewSource,
}: LibraryTableProps) {
  const selectItem = (item: LibraryItem) => {
    if (item.kind === "fragment") {
      onSelectFragment(item.fragment.id);
      return;
    }
    onSelectSource(item.source);
  };

  const handleRowKeyDown = (item: LibraryItem) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectItem(item);
    }
  };

  return (
    <div className="library-table rounded-md border border-border bg-card/40">
      <Table className="min-w-[1100px]" aria-label="Fragment library">
        <TableHeader>
          <TableRow className="border-border/80 hover:bg-transparent">
            {LIBRARY_COLUMNS.map((column) => {
              const filtered = libraryFilterIsActive(filters, column.id);
              const expanded = filterMenu?.column === column.id;
              return (
                <TableHead
                  key={column.id}
                  className={cn(
                    "h-8 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
                    column.id === "signal" && "min-w-[240px]",
                  )}
                  aria-sort={
                    sort.column === column.id
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-between gap-1 text-left hover:text-foreground"
                      onClick={() => onSortChange(toggleLibrarySort(column.id, sort))}
                      aria-label={`Sort by ${column.label}${sort.column === column.id ? `, currently ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`}
                    >
                      {column.label}
                      <SortIcon column={column.id} sort={sort} />
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "shrink-0 rounded-sm p-0.5 opacity-50 hover:bg-white/[0.06] hover:text-foreground hover:opacity-100",
                        filtered && "text-[var(--lime)] opacity-100",
                      )}
                      data-column-filter={column.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenColumnFilter(column.id, event.currentTarget);
                      }}
                      aria-label={`Filter by ${column.label}${filtered ? ", active" : ""}`}
                      aria-haspopup="dialog"
                      aria-expanded={expanded}
                      aria-controls={expanded ? `filter-${column.id}` : undefined}
                    >
                      <ListFilter className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isSelected = item.kind === "fragment"
              ? selectedId === item.fragment.id
              : selectedId === item.id;

            return (
              <TableRow
                key={item.id}
                tabIndex={0}
                className={cn(
                  "cursor-pointer border-border/60 text-[11px] text-muted-foreground transition-colors",
                  "hover:bg-white/[0.04] hover:text-foreground/85",
                  isSelected && "library-row-selected border-l-2 border-l-[var(--violet)] text-foreground",
                )}
                onClick={() => selectItem(item)}
                onKeyDown={handleRowKeyDown(item)}
              >
                {LIBRARY_COLUMNS.map((column) => (
                  <LibraryTableCell
                    key={column.id}
                    columnId={column.id}
                    item={item}
                    sourceNameFor={sourceNameFor}
                    sourceForId={sourceForId}
                    linkSummaryFor={linkSummaryFor}
                    previewingId={previewingId}
                    onPreviewFragment={onPreviewFragment}
                    onPreviewSource={onPreviewSource}
                  />
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {items.length === 0 && (
        <div className="empty-inline border-t border-border/60">No fragments match the current search and filters.</div>
      )}
    </div>
  );
}
