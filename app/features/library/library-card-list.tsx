"use client";

import { KeyboardEvent } from "react";
import { Fragment, SourceFile } from "../../prototype-data";
import { LibraryCard } from "./library-card";
import { LibraryItem } from "./library-items";
import { LibraryLinkSummary } from "./library-list";

type LibraryCardListProps = {
  items: LibraryItem[];
  selectedId: string;
  previewingId: string | null;
  previewProgress: number | null;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  fragmentAudioFor: (fragmentId: string) => string | undefined;
  onHighlightFragment: (fragmentId: string) => void;
  onHighlightSource: (source: SourceFile) => void;
  onOpenMatchesFragment: (fragmentId: string) => void;
  onOpenMatchesSource: (source: SourceFile) => void;
  onOpenInfo: (target: { sourceId: string; fragmentId?: string }) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
  onSeekFragment: (fragment: Fragment, ratio: number) => void;
  onSeekSource: (source: SourceFile, ratio: number) => void;
  onRenameFragment: (fragment: Fragment, name: string) => void;
};

function previewKeyForItem(item: LibraryItem) {
  return item.kind === "source" ? `source:${item.source.id}` : item.fragment.id;
}

export function LibraryCardList({
  items,
  selectedId,
  previewingId,
  previewProgress,
  sourceNameFor,
  sourceForId,
  linkSummaryFor,
  fragmentAudioFor,
  onHighlightFragment,
  onHighlightSource,
  onOpenMatchesFragment,
  onOpenMatchesSource,
  onOpenInfo,
  onPreviewFragment,
  onPreviewSource,
  onSeekFragment,
  onSeekSource,
  onRenameFragment,
}: LibraryCardListProps) {
  const highlightItem = (item: LibraryItem) => {
    if (item.kind === "fragment") onHighlightFragment(item.fragment.id);
    else onHighlightSource(item.source);
  };

  const openMatches = (item: LibraryItem) => {
    if (item.kind === "fragment") onOpenMatchesFragment(item.fragment.id);
    else onOpenMatchesSource(item.source);
  };

  const openInfo = (item: LibraryItem) => {
    if (item.kind === "fragment") {
      onOpenInfo({ sourceId: item.fragment.sourceId, fragmentId: item.fragment.id });
      return;
    }
    onOpenInfo({ sourceId: item.source.id });
  };

  const handleCardKeyDown = (item: LibraryItem) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      highlightItem(item);
    }
  };

  return (
    <div className="library-card-list">
      <div className="library-card-stack" role="list" aria-label="Fragment library">
        {items.map((item) => {
          const previewKey = previewKeyForItem(item);
          const isSelected = item.kind === "fragment"
            ? selectedId === item.fragment.id
            : selectedId === item.id;
          const isPreviewing = previewingId === previewKey;

          return (
            <LibraryCard
              key={item.id}
              item={item}
              isSelected={isSelected}
              isPreviewing={isPreviewing}
              previewProgress={isPreviewing ? previewProgress : null}
              sourceNameFor={sourceNameFor}
              sourceForId={sourceForId}
              linkSummaryFor={linkSummaryFor}
              fragmentAudioFor={fragmentAudioFor}
              onSelect={() => highlightItem(item)}
              onPreview={() => {
                if (item.kind === "fragment") onPreviewFragment(item.fragment);
                else onPreviewSource(item.source);
              }}
              onSeek={(ratio) => {
                if (item.kind === "fragment") onSeekFragment(item.fragment, ratio);
                else onSeekSource(item.source, ratio);
              }}
              onOpenMatches={() => openMatches(item)}
              onOpenInfo={() => openInfo(item)}
              onKeyDown={handleCardKeyDown(item)}
              onRename={item.kind === "fragment" ? (name) => onRenameFragment(item.fragment, name) : undefined}
            />
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="library-card-empty">No fragments match the current search and filters.</div>
      )}
    </div>
  );
}
