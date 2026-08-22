"use client";

import { CSSProperties, ReactNode, RefObject, useMemo } from "react";
import {
  ColumnFilterPopover,
  LibraryFilters,
} from "../../library-filter-popover";
import { Fragment, MusicalRole } from "../../prototype-data";
import { LIBRARY_ROLES } from "./library-columns";
import { LibraryLinkSummary, visibleLibraryFragments } from "./library-list";
import { LibraryTable } from "./library-table";
import { LibraryToolbar } from "./library-toolbar";
import { LibraryFilterMenu, LibrarySort, LibrarySortColumn } from "./types";

type LibraryViewProps = {
  fragments: Fragment[];
  selectedId: string;
  connectionsOpen: boolean;
  resizingConnections: boolean;
  connectionsWidth: number;
  previewingId: string | null;
  query: string;
  sort: LibrarySort;
  filters: LibraryFilters;
  filterMenu: LibraryFilterMenu | null;
  searchRef: RefObject<HTMLInputElement | null>;
  sourceNameFor: (fragment: Fragment) => string;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  relatedTakeCountFor: (fragment: Fragment) => number;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onFiltersChange: (filters: LibraryFilters) => void;
  onOpenColumnFilter: (column: LibrarySortColumn, trigger: HTMLButtonElement) => void;
  onCloseFilterMenu: () => void;
  onSelectFragment: (fragmentId: string) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onOpenTakes: (fragment: Fragment) => void;
  connectionsPanel: ReactNode;
};

export function LibraryView({
  fragments,
  selectedId,
  connectionsOpen,
  resizingConnections,
  connectionsWidth,
  previewingId,
  query,
  sort,
  filters,
  filterMenu,
  searchRef,
  sourceNameFor,
  linkSummaryFor,
  relatedTakeCountFor,
  onQueryChange,
  onSortChange,
  onFiltersChange,
  onOpenColumnFilter,
  onCloseFilterMenu,
  onSelectFragment,
  onPreviewFragment,
  onOpenTakes,
  connectionsPanel,
}: LibraryViewProps) {
  const listContext = useMemo(
    () => ({ sourceNameFor, linkSummaryFor, relatedTakeCountFor }),
    [sourceNameFor, linkSummaryFor, relatedTakeCountFor],
  );
  const visibleFragments = useMemo(
    () => visibleLibraryFragments(fragments, query, filters, sort, listContext),
    [fragments, query, filters, sort, listContext],
  );
  const keyFilterOptions = useMemo(
    () => Array.from(new Set(fragments.flatMap((fragment) => [fragment.key, ...fragment.alternateKeys]))).sort((a, b) => a.localeCompare(b)),
    [fragments],
  );
  const tagFilterOptions = useMemo(
    () => Array.from(new Set(fragments.flatMap((fragment) => fragment.userTags))).sort((a, b) => a.localeCompare(b)),
    [fragments],
  );
  const roleOptions = LIBRARY_ROLES.filter((role): role is MusicalRole => role !== "All");

  return (
    <section
      className={`workspace ${connectionsOpen ? "connections-open" : ""} ${resizingConnections ? "resizing" : ""}`}
      style={{ "--connections-width": `${connectionsWidth}px` } as CSSProperties}
    >
      <div className="library">
        <div className="panel-titlebar">
          <h1>Fragments</h1>
        </div>
        <LibraryToolbar
          query={query}
          searchRef={searchRef}
          onQueryChange={onQueryChange}
        />
        <LibraryTable
          fragments={visibleFragments}
          selectedId={selectedId}
          connectionsOpen={connectionsOpen}
          previewingId={previewingId}
          sort={sort}
          filters={filters}
          filterMenu={filterMenu}
          sourceNameFor={sourceNameFor}
          linkSummaryFor={linkSummaryFor}
          relatedTakeCountFor={relatedTakeCountFor}
          onSortChange={onSortChange}
          onOpenColumnFilter={onOpenColumnFilter}
          onSelectFragment={onSelectFragment}
          onPreviewFragment={onPreviewFragment}
          onOpenTakes={onOpenTakes}
        />
        {filterMenu && (
          <ColumnFilterPopover
            column={filterMenu.column}
            filters={filters}
            position={{ left: filterMenu.left, top: filterMenu.top }}
            triggerElement={filterMenu.trigger}
            keyOptions={keyFilterOptions}
            tagOptions={tagFilterOptions}
            roleOptions={roleOptions}
            resultCount={visibleFragments.length}
            totalCount={fragments.length}
            onChange={onFiltersChange}
            onClose={onCloseFilterMenu}
          />
        )}
      </div>
      {connectionsOpen && connectionsPanel}
    </section>
  );
}
