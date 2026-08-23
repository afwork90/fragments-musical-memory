"use client";

import { KeyboardEvent, ReactNode, useMemo } from "react";
import { Play, Square } from "lucide-react";
import { ScrubbableWaveform } from "@/lib/audio/scrubbable-waveform";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { startDesktopDrag } from "@/lib/audio/desktop-drag";
import { formatMusicalKey } from "@/lib/audio/source-metadata";
import { resolveSourceAudioUrl } from "@/lib/audio/source-playback";
import { Button } from "@/lib/ui/button";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/format";
import { Fragment, SourceFile } from "../../prototype-data";
import { LibraryLinkSummary } from "./library-list";
import { LibraryItem } from "./library-items";

type LibraryCardProps = {
  item: LibraryItem;
  isSelected: boolean;
  isPreviewing: boolean;
  previewProgress: number | null;
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  fragmentAudioFor: (fragmentId: string) => string | undefined;
  onSelect: () => void;
  onPreview: () => void;
  onSeek: (ratio: number) => void;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  showActions?: boolean;
  embedded?: boolean;
  waveformValues?: number[];
  waveActions?: ReactNode;
};

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="library-card-meta-item">
      <span className="library-card-meta-label">{label}</span>
      <span className="library-card-meta-value">{value}</span>
    </span>
  );
}

function CardActions({
  matchCount,
  onOpenMatches,
  onOpenInfo,
}: {
  matchCount: number;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
}) {
  return (
    <div className="library-card-actions">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="library-card-action"
        disabled={matchCount === 0}
        onClick={(event) => {
          event.stopPropagation();
          onOpenMatches();
        }}
      >
        Affinities ({matchCount})
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="library-card-action"
        onClick={(event) => {
          event.stopPropagation();
          onOpenInfo();
        }}
      >
        Info
      </Button>
    </div>
  );
}

function CardHeading({
  title,
  muted,
  meta,
  matchCount,
  onOpenMatches,
  onOpenInfo,
  showActions = true,
}: {
  title: string;
  muted?: boolean;
  meta: ReactNode;
  matchCount: number;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  showActions?: boolean;
}) {
  return (
    <div className="library-card-heading">
      <h3 className={cn("library-card-title", muted && "library-card-title-muted")} title={title}>
        {title}
      </h3>
      <div className="library-card-heading-right">
        <div className="library-card-meta">{meta}</div>
        {showActions && (
          <CardActions matchCount={matchCount} onOpenMatches={onOpenMatches} onOpenInfo={onOpenInfo} />
        )}
      </div>
    </div>
  );
}

export function LibraryCard({
  item,
  isSelected,
  isPreviewing,
  previewProgress,
  sourceNameFor,
  sourceForId,
  linkSummaryFor,
  fragmentAudioFor,
  onSelect,
  onPreview,
  onSeek,
  onOpenMatches,
  onOpenInfo,
  onKeyDown,
  showActions = true,
  embedded = false,
  waveformValues,
  waveActions,
}: LibraryCardProps) {
  if (item.kind === "source") {
    return (
      <SourceLibraryCard
        source={item.source}
        isSelected={isSelected}
        isPreviewing={isPreviewing}
        previewProgress={previewProgress}
        linkSummaryFor={linkSummaryFor}
        fragmentAudioFor={fragmentAudioFor}
        onSelect={onSelect}
        onPreview={onPreview}
        onSeek={onSeek}
        onOpenMatches={onOpenMatches}
        onOpenInfo={onOpenInfo}
        onKeyDown={onKeyDown}
        waveActions={waveActions}
      />
    );
  }

  return (
    <FragmentLibraryCard
      fragment={item.fragment}
      isSelected={isSelected}
      isPreviewing={isPreviewing}
      previewProgress={previewProgress}
      sourceForId={sourceForId}
      linkSummaryFor={linkSummaryFor}
      fragmentAudioFor={fragmentAudioFor}
      onSelect={onSelect}
      onPreview={onPreview}
      onSeek={onSeek}
      onOpenMatches={onOpenMatches}
      onOpenInfo={onOpenInfo}
      onKeyDown={onKeyDown}
      showActions={showActions}
      embedded={embedded}
      waveformValues={waveformValues}
      waveActions={waveActions}
    />
  );
}

function SourceLibraryCard({
  source,
  isSelected,
  isPreviewing,
  previewProgress,
  linkSummaryFor,
  fragmentAudioFor,
  onSelect,
  onPreview,
  onSeek,
  onOpenMatches,
  onOpenInfo,
  onKeyDown,
  waveActions,
}: {
  source: SourceFile;
  isSelected: boolean;
  isPreviewing: boolean;
  previewProgress: number | null;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  fragmentAudioFor: (fragmentId: string) => string | undefined;
  onSelect: () => void;
  onPreview: () => void;
  onSeek: (ratio: number) => void;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  waveActions?: ReactNode;
}) {
  const cached = useCachedAudioBySourceId(source.id);
  const peaks = cached?.peaks ?? source.waveform;
  const matchCount = source.fragmentIds.reduce((sum, id) => sum + linkSummaryFor(id).total, 0);
  const bpm = cached?.analysis.bpm ?? source.bpm;
  const keyLabel = formatMusicalKey(cached?.analysis.key ?? source.key, cached?.analysis.scale ?? source.scale);
  const canPlay = Boolean(resolveSourceAudioUrl(source, fragmentAudioFor));

  return (
    <article
      className={cn("library-card", isSelected && "library-card-selected")}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <CardHeading
        title={source.name}
        muted={matchCount === 0}
        matchCount={matchCount}
        onOpenMatches={onOpenMatches}
        onOpenInfo={onOpenInfo}
        meta={(
          <>
            <MetaItem label="Recorded" value={source.date} />
            <MetaItem label="Length" value={formatSeconds(source.duration)} />
            <MetaItem label="Key" value={keyLabel ?? "—"} />
            <MetaItem label="BPM" value={bpm != null ? String(bpm) : "—"} />
          </>
        )}
      />

      <div className="library-card-wave-row" onClick={(event) => event.stopPropagation()}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("library-card-play size-9 shrink-0", isPreviewing && "text-[var(--card-action)]")}
          disabled={!canPlay}
          onClick={onPreview}
          aria-label={`${isPreviewing ? "Stop" : "Play"} ${source.name}`}
        >
          {isPreviewing ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </Button>
        {waveActions}
        <div
          className={cn("library-card-wave-slot", canPlay && "cursor-grab active:cursor-grabbing")}
          draggable={canPlay}
          onDragStart={(event) => {
            if (!canPlay) return;
            startDesktopDrag(event, { sourceId: source.id }, { audioUrl: resolveSourceAudioUrl(source, fragmentAudioFor) ?? "", fileName: `${source.name}.wav` });
          }}
          title={canPlay ? "Drag onto your desktop or into a DAW" : undefined}
        >
          <ScrubbableWaveform
            values={peaks}
            active={isPreviewing}
            progress={isPreviewing ? previewProgress : null}
            onSeek={canPlay ? onSeek : undefined}
          />
        </div>
      </div>
    </article>
  );
}

function FragmentLibraryCard({
  fragment,
  isSelected,
  isPreviewing,
  previewProgress,
  sourceForId,
  linkSummaryFor,
  fragmentAudioFor,
  onSelect,
  onPreview,
  onSeek,
  onOpenMatches,
  onOpenInfo,
  onKeyDown,
  showActions = true,
  embedded = false,
  waveformValues,
  waveActions,
}: {
  fragment: Fragment;
  isSelected: boolean;
  isPreviewing: boolean;
  previewProgress: number | null;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  fragmentAudioFor: (fragmentId: string) => string | undefined;
  onSelect: () => void;
  onPreview: () => void;
  onSeek: (ratio: number) => void;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  showActions?: boolean;
  embedded?: boolean;
  waveformValues?: number[];
  waveActions?: ReactNode;
}) {
  const source = sourceForId(fragment.sourceId);
  const links = linkSummaryFor(fragment.id);
  const slice = source
    ? { start: fragment.start, end: fragment.end, duration: source.duration }
    : undefined;
  const cached = useCachedAudioBySourceId(fragment.sourceId);
  const peaks = useMemo(() => {
    if (waveformValues) return waveformValues;
    const base = cached?.peaks ?? fragment.waveform;
    if (slice && cached?.peaks) {
      return slicePeaks(base, slice.start, slice.end, slice.duration);
    }
    return base;
  }, [cached?.peaks, fragment.waveform, slice, waveformValues]);

  return (
    <article
      className={cn(
        "library-card",
        isSelected && "library-card-selected",
        embedded && "library-card-embedded",
      )}
      tabIndex={embedded ? undefined : 0}
      onClick={embedded ? undefined : onSelect}
      onKeyDown={embedded ? undefined : onKeyDown}
    >
      <CardHeading
        title={fragment.name}
        muted={links.total === 0}
        matchCount={links.total}
        onOpenMatches={onOpenMatches}
        onOpenInfo={onOpenInfo}
        showActions={showActions}
        meta={(
          <>
            <MetaItem label="Recorded" value={fragment.dateLabel} />
            <MetaItem label="Length" value={formatSeconds(fragment.end - fragment.start)} />
            <MetaItem label="Key" value={fragment.key} />
            <MetaItem label="BPM" value={String(fragment.bpm)} />
          </>
        )}
      />

      <div className="library-card-wave-row" onClick={(event) => event.stopPropagation()}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("library-card-play size-9 shrink-0", isPreviewing && "text-[var(--card-action)]")}
          onClick={onPreview}
          aria-label={`${isPreviewing ? "Stop" : "Play"} ${fragment.name}`}
        >
          {isPreviewing ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </Button>
        {waveActions}
        <div
          className="library-card-wave-slot cursor-grab active:cursor-grabbing"
          draggable
          onDragStart={(event) => startDesktopDrag(event, { sourceId: fragment.sourceId }, { audioUrl: fragment.audio, fileName: `${fragment.name}.wav` })}
          title="Drag onto your desktop or into a DAW"
        >
          <ScrubbableWaveform
            values={peaks}
            active={isPreviewing}
            progress={isPreviewing ? previewProgress : null}
            onSeek={onSeek}
          />
        </div>
      </div>
    </article>
  );
}
