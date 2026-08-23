"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter } from "lucide-react";
import { libraryFilterIsActive, LibraryFilters } from "../../library-filter-popover";
import { LIBRARY_COLUMNS, toggleLibrarySort } from "./library-columns";
import { LibraryFilterMenu, LibrarySort, LibrarySortColumn } from "./types";
import { cn } from "@/lib/utils";

type LibraryListControlsProps = {
  sort: LibrarySort;
  filters: LibraryFilters;
  filterMenu: LibraryFilterMenu | null;
  onSortChange: (sort: LibrarySort) => void;
  onOpenColumnFilter: (column: LibrarySortColumn, trigger: HTMLButtonElement) => void;
};

function SortIcon({ column, sort }: { column: LibrarySortColumn; sort: LibrarySort }) {
  if (sort.column !== column) return <ArrowUpDown className="size-3.5 opacity-40" aria-hidden="true" />;
  return sort.direction === "asc"
    ? <ArrowUp className="size-3.5" aria-hidden="true" />
    : <ArrowDown className="size-3.5" aria-hidden="true" />;
}

export function LibraryListControls({
  sort,
  filters,
  filterMenu,
  onSortChange,
  onOpenColumnFilter,
}: LibraryListControlsProps) {
  return (
    <div className="library-list-controls" role="toolbar" aria-label="Library sort and filters">
      {LIBRARY_COLUMNS.filter((column) => column.id !== "signal").map((column) => {
        const filtered = libraryFilterIsActive(filters, column.id);
        const expanded = filterMenu?.column === column.id;

        return (
          <div key={column.id} className="library-control-pill">
            <button
              type="button"
              className={cn(
                "library-control-sort",
                sort.column === column.id && "library-control-sort-active",
              )}
              onClick={() => onSortChange(toggleLibrarySort(column.id, sort))}
              aria-label={`Sort by ${column.label}${sort.column === column.id ? `, currently ${sort.direction === "asc" ? "ascending" : "descending"}` : ""}`}
            >
              <span>{column.label}</span>
              <SortIcon column={column.id} sort={sort} />
            </button>
            <button
              type="button"
              className={cn(
                "library-control-filter",
                filtered && "library-control-filter-active",
              )}
              data-column-filter={column.id}
              onClick={(event) => onOpenColumnFilter(column.id, event.currentTarget)}
              aria-label={`Filter by ${column.label}${filtered ? ", active" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={expanded}
              aria-controls={expanded ? `filter-${column.id}` : undefined}
            >
              <ListFilter className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
