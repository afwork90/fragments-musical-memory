"use client";

import { CSSProperties, ReactNode, RefObject, useMemo } from "react";
import {
  ColumnFilterPopover,
  LibraryFilters,
} from "../../library-filter-popover";
import { Fragment, SourceFile } from "../../prototype-data";
import { LIBRARY_ROLES } from "./library-columns";
import { visibleLibraryItems } from "./library-items";
import { LibraryLinkSummary } from "./library-list";
import { LibraryTable } from "./library-table";
import { LibraryToolbar } from "./library-toolbar";
import { LibraryFilterMenu, LibrarySort, LibrarySortColumn } from "./types";

type LibraryViewProps = {
  sources: SourceFile[];
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
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onFiltersChange: (filters: LibraryFilters) => void;
  onOpenColumnFilter: (column: LibrarySortColumn, trigger: HTMLButtonElement) => void;
  onCloseFilterMenu: () => void;
  onSelectFragment: (fragmentId: string) => void;
  onSelectSource: (source: SourceFile) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
  connectionsPanel: ReactNode;
};

export function LibraryView({
  sources,
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
  sourceForId,
  linkSummaryFor,
  onQueryChange,
  onSortChange,
  onFiltersChange,
  onOpenColumnFilter,
  onCloseFilterMenu,
  onSelectFragment,
  onSelectSource,
  onPreviewFragment,
  onPreviewSource,
  connectionsPanel,
}: LibraryViewProps) {
  const listContext = useMemo(
    () => ({ sourceNameFor, linkSummaryFor, relatedTakeCountFor: () => 0 }),
    [sourceNameFor, linkSummaryFor],
  );
  const visibleItems = useMemo(
    () => visibleLibraryItems(sources, fragments, query, filters, sort, listContext),
    [sources, fragments, query, filters, sort, listContext],
  );
  const totalItemCount = sources.length + fragments.length;
  const keyFilterOptions = useMemo(
    () => Array.from(new Set(fragments.flatMap((fragment) => [fragment.key, ...fragment.alternateKeys]))).sort((a, b) => a.localeCompare(b)),
    [fragments],
  );
  const tagFilterOptions = useMemo(
    () => Array.from(new Set(fragments.flatMap((fragment) => fragment.userTags))).sort((a, b) => a.localeCompare(b)),
    [fragments],
  );
  const roleOptions = LIBRARY_ROLES.filter((role) => role !== "All");

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
        <div className="library-scroll">
          <LibraryTable
          items={visibleItems}
          selectedId={selectedId}
          connectionsOpen={connectionsOpen}
          previewingId={previewingId}
          sort={sort}
          filters={filters}
          filterMenu={filterMenu}
          sourceNameFor={sourceNameFor}
          sourceForId={sourceForId}
          linkSummaryFor={linkSummaryFor}
          onSortChange={onSortChange}
          onOpenColumnFilter={onOpenColumnFilter}
          onSelectFragment={onSelectFragment}
          onSelectSource={onSelectSource}
          onPreviewFragment={onPreviewFragment}
          onPreviewSource={onPreviewSource}
        />
        </div>
        {filterMenu && (
          <ColumnFilterPopover
            column={filterMenu.column}
            filters={filters}
            position={{ left: filterMenu.left, top: filterMenu.top }}
            triggerElement={filterMenu.trigger}
            keyOptions={keyFilterOptions}
            tagOptions={tagFilterOptions}
            roleOptions={roleOptions}
            resultCount={visibleItems.length}
            totalCount={totalItemCount}
            onChange={onFiltersChange}
            onClose={onCloseFilterMenu}
          />
        )}
      </div>
      {connectionsOpen && connectionsPanel}
    </section>
  );
}
