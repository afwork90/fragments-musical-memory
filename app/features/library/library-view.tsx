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
import { LibraryCardList } from "./library-card-list";
import { LibraryListControls } from "./library-list-controls";
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
  previewProgress: number | null;
  query: string;
  sort: LibrarySort;
  filters: LibraryFilters;
  filterMenu: LibraryFilterMenu | null;
  searchRef: RefObject<HTMLInputElement | null>;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  fragmentAudioFor: (fragmentId: string) => string | undefined;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onFiltersChange: (filters: LibraryFilters) => void;
  onOpenColumnFilter: (column: LibrarySortColumn, trigger: HTMLButtonElement) => void;
  onCloseFilterMenu: () => void;
  onHighlightFragment: (fragmentId: string) => void;
  onHighlightSource: (source: SourceFile) => void;
  onOpenMatchesFragment: (fragmentId: string) => void;
  onOpenMatchesSource: (source: SourceFile) => void;
  onOpenInfo: (sourceId: string) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
  onSeekFragment: (fragment: Fragment, ratio: number) => void;
  onSeekSource: (source: SourceFile, ratio: number) => void;
  connectionsPanel: ReactNode;
  infoPanelOpen: boolean;
  infoPanel: ReactNode;
};

export function LibraryView({
  sources,
  fragments,
  selectedId,
  connectionsOpen,
  resizingConnections,
  connectionsWidth,
  previewingId,
  previewProgress,
  query,
  sort,
  filters,
  filterMenu,
  searchRef,
  sourceNameFor,
  sourceForId,
  linkSummaryFor,
  fragmentAudioFor,
  onQueryChange,
  onSortChange,
  onFiltersChange,
  onOpenColumnFilter,
  onCloseFilterMenu,
  onHighlightFragment,
  onHighlightSource,
  onOpenMatchesFragment,
  onOpenMatchesSource,
  onOpenInfo,
  onPreviewFragment,
  onPreviewSource,
  onSeekFragment,
  onSeekSource,
  connectionsPanel,
  infoPanelOpen,
  infoPanel,
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
      className={`workspace ${infoPanelOpen ? "info-open" : connectionsOpen ? "connections-open" : ""} ${resizingConnections && !infoPanelOpen ? "resizing" : ""}`}
      style={!infoPanelOpen && connectionsOpen ? { "--connections-width": `${connectionsWidth}px` } as CSSProperties : undefined}
    >
      <div className="library">
        <div className="library-header">
          <LibraryToolbar
            query={query}
            searchRef={searchRef}
            onQueryChange={onQueryChange}
          />
          <LibraryListControls
            sort={sort}
            filters={filters}
            filterMenu={filterMenu}
            onSortChange={onSortChange}
            onOpenColumnFilter={onOpenColumnFilter}
          />
        </div>
        <div className="library-scroll">
          <LibraryCardList
            items={visibleItems}
            selectedId={selectedId}
            previewingId={previewingId}
            previewProgress={previewProgress}
            sourceNameFor={sourceNameFor}
            sourceForId={sourceForId}
            linkSummaryFor={linkSummaryFor}
            fragmentAudioFor={fragmentAudioFor}
            onHighlightFragment={onHighlightFragment}
            onHighlightSource={onHighlightSource}
            onOpenMatchesFragment={onOpenMatchesFragment}
            onOpenMatchesSource={onOpenMatchesSource}
            onOpenInfo={onOpenInfo}
            onPreviewFragment={onPreviewFragment}
            onPreviewSource={onPreviewSource}
            onSeekFragment={onSeekFragment}
            onSeekSource={onSeekSource}
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
      {infoPanelOpen ? infoPanel : connectionsOpen ? connectionsPanel : null}
    </section>
  );
}
