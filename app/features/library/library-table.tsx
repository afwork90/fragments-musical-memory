"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";
import { KeyboardEvent } from "react";
import { SignalCell } from "@/lib/audio/signal-cell";
import { Button } from "@/lib/ui/button";
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
import { Fragment } from "../../prototype-data";
import { LIBRARY_COLUMNS, toggleLibrarySort } from "./library-columns";
import { LibraryLinkSummary } from "./library-list";
import { LibraryFilterMenu, LibrarySort, LibrarySortColumn } from "./types";

type LibraryTableProps = {
  fragments: Fragment[];
  selectedId: string;
  connectionsOpen: boolean;
  previewingId: string | null;
  sort: LibrarySort;
  filters: LibraryFilters;
  filterMenu: LibraryFilterMenu | null;
  sourceNameFor: (fragment: Fragment) => string;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  relatedTakeCountFor: (fragment: Fragment) => number;
  onSortChange: (sort: LibrarySort) => void;
  onOpenColumnFilter: (column: LibrarySortColumn, trigger: HTMLButtonElement) => void;
  onSelectFragment: (fragmentId: string) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onOpenTakes: (fragment: Fragment) => void;
};

function SortIcon({ column, sort }: { column: LibrarySortColumn; sort: LibrarySort }) {
  if (sort.column !== column) return <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />;
  return sort.direction === "asc"
    ? <ArrowUp className="size-3" aria-hidden="true" />
    : <ArrowDown className="size-3" aria-hidden="true" />;
}

export function LibraryTable({
  fragments,
  selectedId,
  connectionsOpen,
  previewingId,
  sort,
  filters,
  filterMenu,
  sourceNameFor,
  linkSummaryFor,
  relatedTakeCountFor,
  onSortChange,
  onOpenColumnFilter,
  onSelectFragment,
  onPreviewFragment,
  onOpenTakes,
}: LibraryTableProps) {
  const handleRowKeyDown = (fragmentId: string) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectFragment(fragmentId);
    }
  };

  return (
    <div className="library-table rounded-md border border-border bg-card/40">
      <Table className="min-w-[1560px]" aria-label="Fragment library">
        <TableHeader>
          <TableRow className="border-border/80 hover:bg-transparent">
            {LIBRARY_COLUMNS.map((column) => {
              const filtered = libraryFilterIsActive(filters, column.id);
              const expanded = filterMenu?.column === column.id;
              return (
                <TableHead
                  key={column.id}
                  className="h-8 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
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
          {fragments.map((fragment) => {
            const relatedTakes = relatedTakeCountFor(fragment);
            const links = linkSummaryFor(fragment.id);
            const isSelected = connectionsOpen && selectedId === fragment.id;
            const sourceName = sourceNameFor(fragment);

            return (
              <TableRow
                key={fragment.id}
                tabIndex={0}
                className={cn(
                  "cursor-pointer border-border/60 text-[11px] text-muted-foreground transition-colors",
                  "hover:bg-white/[0.04] hover:text-foreground/85",
                  isSelected && "library-row-selected border-l-2 border-l-[var(--violet)] text-foreground",
                )}
                onClick={() => onSelectFragment(fragment.id)}
                onKeyDown={handleRowKeyDown(fragment.id)}
              >
                <TableCell
                  className={cn(
                    "max-w-[180px] px-2 py-2 font-medium text-foreground",
                    links.total === 0 && "text-muted-foreground",
                  )}
                >
                  <span className="block truncate" title={fragment.name}>
                    {fragment.name}
                  </span>
                </TableCell>
                <TableCell className="max-w-[140px] truncate px-2 py-2" title={sourceName}>
                  {sourceName}
                </TableCell>
                <TableCell className="px-2 py-1.5">
                  <SignalCell
                    values={fragment.waveform}
                    sourceId={fragment.sourceId}
                    cacheSourceAudio
                    isPreviewing={previewingId === fragment.id}
                    onPreview={() => onPreviewFragment(fragment)}
                    ariaLabel={`${previewingId === fragment.id ? "Stop" : "Play"} ${fragment.name}`}
                    waveClassName="source-signal-wave h-11 min-w-[140px] flex-1"
                  />
                </TableCell>
                <TableCell className="px-2 py-2">{fragment.dateLabel}</TableCell>
                <TableCell className="px-2 py-2">{formatSeconds(fragment.start)}</TableCell>
                <TableCell className="px-2 py-2">{formatSeconds(fragment.end)}</TableCell>
                <TableCell className="px-2 py-2">{formatSeconds(fragment.end - fragment.start)}</TableCell>
                <TableCell className="px-2 py-2">{fragment.bars} / {fragment.beats}</TableCell>
                <TableCell
                  className="max-w-[100px] truncate px-2 py-2"
                  title={fragment.alternateKeys.length ? `Also: ${fragment.alternateKeys.join(", ")}` : fragment.key}
                >
                  {fragment.key}
                  {fragment.alternateKeys.length > 0 && (
                    <span className="ml-1 text-muted-foreground/70">+{fragment.alternateKeys.length}</span>
                  )}
                </TableCell>
                <TableCell className="px-2 py-2">{fragment.bpm}</TableCell>
                <TableCell className="px-2 py-2">{Math.round(fragment.confidence * 100)}%</TableCell>
                <TableCell className="max-w-[120px] truncate px-2 py-2" title={fragment.userTags.join(", ")}>
                  {fragment.userTags.join(" · ")}
                </TableCell>
                <TableCell className="px-2 py-2">{fragment.role}</TableCell>
                <TableCell className="px-2 py-2">
                  <span className="text-foreground">{links.total}</span>
                  {links.manual > 0 && (
                    <span className="ml-1 text-[var(--amber)]">manual {links.manual}</span>
                  )}
                </TableCell>
                <TableCell className="px-2 py-2">
                  {relatedTakes > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="border-[#ffbc6535] bg-[#ffbc6509] text-[var(--amber)] hover:bg-[#ffbc6520] hover:text-[var(--amber)]"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenTakes(fragment);
                      }}
                    >
                      {relatedTakes + 1}
                    </Button>
                  ) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {fragments.length === 0 && (
        <div className="empty-inline border-t border-border/60">No fragments match the current search and filters.</div>
      )}
    </div>
  );
}
