"use client";

import { CSSProperties, ReactNode, RefObject, useMemo } from "react";
import { sourceKeyLabels, uniqueKeyLabels } from "@/lib/audio/source-metadata";
import { Fragment, MusicalRole, SourceFile } from "../../prototype-data";
import { LIBRARY_ROLES } from "./library-columns";
import { visibleLibraryItems } from "./library-items";
import { LibraryLinkSummary } from "./library-list";
import { LibraryCardList } from "./library-card-list";
import { LibraryFilterPanel } from "./library-filter-panel";
import { LibraryToolbar } from "./library-toolbar";
import { LibrarySort } from "./types";
import { LibraryFilters, createLibraryFilters } from "../../library-filter-popover";

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
  filterOpen: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  fragmentAudioFor: (fragmentId: string) => string | undefined;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: LibrarySort) => void;
  onFiltersChange: (filters: LibraryFilters) => void;
  onToggleFilter: () => void;
  onCloseFilter: () => void;
  onHighlightFragment: (fragmentId: string) => void;
  onHighlightSource: (source: SourceFile) => void;
  onOpenMatchesFragment: (fragmentId: string) => void;
  onOpenMatchesSource: (source: SourceFile) => void;
  onOpenInfo: (target: { sourceId: string; fragmentId?: string }) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
  onSeekFragment: (fragment: Fragment, ratio: number) => void;
  onSeekSource: (source: SourceFile, ratio: number) => void;
  connectionsPanel: ReactNode;
  infoPanelOpen: boolean;
  infoPanel: ReactNode;
  savedFragmentIds?: Set<string>;
  onRenameFragment?: (fragment: Fragment, name: string) => void;
  onSaveFragment?: (fragment: Fragment) => void;
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
  filterOpen,
  searchRef,
  sourceNameFor,
  sourceForId,
  linkSummaryFor,
  fragmentAudioFor,
  onQueryChange,
  onSortChange,
  onFiltersChange,
  onToggleFilter,
  onCloseFilter,
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
  savedFragmentIds,
  onRenameFragment,
  onSaveFragment,
}: LibraryViewProps) {
  const listContext = useMemo(
    () => ({ sourceNameFor, sourceForId, linkSummaryFor, relatedTakeCountFor: () => 0 }),
    [sourceNameFor, sourceForId, linkSummaryFor],
  );
  const visibleItems = useMemo(
    () => visibleLibraryItems(sources, fragments, query, filters, sort, listContext),
    [sources, fragments, query, filters, sort, listContext],
  );
  const totalItemCount = sources.length + fragments.length;
  const keyFilterOptions = useMemo(
    () =>
      uniqueKeyLabels([
        ...sources.flatMap((source) => sourceKeyLabels(source)),
        ...fragments.flatMap((fragment) => {
          const fromSource = sourceKeyLabels(sourceForId(fragment.sourceId));
          if (fromSource.length) return fromSource;
          return fragment.key && fragment.key !== "—" ? [fragment.key] : [];
        }),
      ]),
    [sources, fragments, sourceForId],
  );
  const tagFilterOptions = useMemo(
    () => Array.from(new Set(fragments.flatMap((fragment) => fragment.userTags))).sort((a, b) => a.localeCompare(b)),
    [fragments],
  );
  const roleOptions = LIBRARY_ROLES.filter((role): role is MusicalRole => role !== "All");

  return (
    <section
      className={`workspace ${filterOpen || infoPanelOpen ? "info-open" : connectionsOpen ? "connections-open" : ""} ${resizingConnections && !filterOpen && !infoPanelOpen ? "resizing" : ""}`}
      style={!filterOpen && !infoPanelOpen && connectionsOpen ? { "--connections-width": `${connectionsWidth}px` } as CSSProperties : undefined}
    >
      <div className="library">
        <div className="library-header">
          <LibraryToolbar
            query={query}
            searchRef={searchRef}
            sort={sort}
            filters={filters}
            filterOpen={filterOpen}
            onQueryChange={onQueryChange}
            onSortChange={onSortChange}
            onToggleFilter={onToggleFilter}
            onClearFilters={() => onFiltersChange(createLibraryFilters())}
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
            savedFragmentIds={savedFragmentIds ?? new Set()}
            onRenameFragment={onRenameFragment ?? (() => {})}
            onSaveFragment={onSaveFragment ?? (() => {})}
          />
        </div>
      </div>
      {filterOpen ? (
        <LibraryFilterPanel
          filters={filters}
          keyOptions={keyFilterOptions}
          tagOptions={tagFilterOptions}
          roleOptions={roleOptions}
          resultCount={visibleItems.length}
          totalCount={totalItemCount}
          onChange={onFiltersChange}
          onClose={onCloseFilter}
        />
      ) : infoPanelOpen ? infoPanel : connectionsOpen ? connectionsPanel : null}
    </section>
  );
}
