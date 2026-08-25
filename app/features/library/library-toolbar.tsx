"use client";

import { ArrowDownAZ, ArrowUpAZ, ListFilter, X } from "lucide-react";
import { RefObject } from "react";
import { activeLibraryFilterCount, LibraryFilters } from "../../library-filter-popover";
import { LIBRARY_COLUMNS, toggleLibrarySort } from "./library-columns";
import { LibrarySort, LibrarySortColumn } from "./types";
import { Button } from "@/lib/ui/button";
import { cn } from "@/lib/utils";

const SORT_COLUMNS = LIBRARY_COLUMNS.filter((column) =>
  ["name", "source", "date", "uploaded", "duration", "key", "tempo", "links"].includes(column.id),
);

type LibraryToolbarProps = {
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  sort: LibrarySort;
  filters: LibraryFilters;
  filterOpen: boolean;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onToggleFilter: () => void;
  onClearFilters: () => void;
};

export function LibraryToolbar({
  query,
  searchRef,
  sort,
  filters,
  filterOpen,
  onQueryChange,
  onSortChange,
  onToggleFilter,
  onClearFilters,
}: LibraryToolbarProps) {
  const activeCount = activeLibraryFilterCount(filters);
  const sortLabel = SORT_COLUMNS.find((column) => column.id === sort.column)?.label ?? "Sort";

  return (
    <div className="library-toolbar">
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search"
          aria-label="Search fragments"
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            onClick={() => {
              onQueryChange("");
              searchRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </label>

      <div className="library-toolbar-actions">
        <div className="library-toolbar-sort">
          <label className="library-sort-field">
            <span className="sr-only">Sort by</span>
            <select
              value={sort.column}
              aria-label="Sort by"
              onChange={(event) => {
                const column = event.target.value as LibrarySortColumn;
                if (column === sort.column) return;
                onSortChange(toggleLibrarySort(column, sort));
              }}
            >
              {SORT_COLUMNS.map((column) => (
                <option key={column.id} value={column.id}>{column.label}</option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="library-sort-direction"
            onClick={() => onSortChange({
              column: sort.column,
              direction: sort.direction === "asc" ? "desc" : "asc",
            })}
            aria-label={`Sort ${sort.direction === "asc" ? "ascending" : "descending"}. Click to reverse.`}
            title={`${sortLabel}: ${sort.direction === "asc" ? "Ascending" : "Descending"}`}
          >
            {sort.direction === "asc"
              ? <ArrowUpAZ className="size-3.5" aria-hidden="true" />
              : <ArrowDownAZ className="size-3.5" aria-hidden="true" />}
          </Button>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="library-clear-filters"
          disabled={activeCount === 0}
          onClick={onClearFilters}
        >
          Clear filters
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("library-filter-toggle", (filterOpen || activeCount > 0) && "library-filter-toggle-active")}
          onClick={onToggleFilter}
          aria-pressed={filterOpen}
          aria-expanded={filterOpen}
        >
          <ListFilter className="size-3.5" aria-hidden="true" />
          Filter
          {activeCount > 0 && <b aria-label={`${activeCount} active filters`}>{activeCount}</b>}
        </Button>
      </div>
    </div>
  );
}
