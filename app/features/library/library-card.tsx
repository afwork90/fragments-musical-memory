"use client";

import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, Pencil, Play, Square } from "lucide-react";
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
  onRename?: (name: string) => void;
  onSave?: () => void;
  isSaved?: boolean;
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
  onSave,
  isSaved,
  showMatchActions = true,
}: {
  matchCount: number;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  onSave?: () => void;
  isSaved?: boolean;
  showMatchActions?: boolean;
}) {
  return (
    <div className="library-card-actions">
      {onSave && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("library-card-action", isSaved && "library-card-action-saved")}
          onClick={(event) => {
            event.stopPropagation();
            onSave();
          }}
        >
          {isSaved ? (<><Check className="size-3" />Saved</>) : "Save"}
        </Button>
      )}
      {showMatchActions && (
        <>
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
        </>
      )}
    </div>
  );
}

function EditableTitle({
  title,
  muted,
  onRename,
}: {
  title: string;
  muted?: boolean;
  onRename?: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLHeadingElement | null>(null);
  const titleRef = useRef(title);
  titleRef.current = title;

  useEffect(() => {
    if (!editing) return;
    const node = ref.current;
    if (!node) return;
    node.textContent = titleRef.current;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }, [editing]);

  if (!onRename) {
    return (
      <h3 className={cn("library-card-title", muted && "library-card-title-muted")} title={title}>
        {title}
      </h3>
    );
  }

  const commit = () => {
    const next = ref.current?.textContent?.trim() ?? "";
    setEditing(false);
    if (next && next !== titleRef.current) onRename(next);
  };

  return (
    <div className="library-card-title-row">
      <h3
        ref={ref}
        className={cn("library-card-title", muted && "library-card-title-muted")}
        title={editing ? undefined : title}
        contentEditable={editing}
        suppressContentEditableWarning
        onClick={(event) => {
          event.stopPropagation();
          if (!editing) setEditing(true);
        }}
        onBlur={() => { if (editing) commit(); }}
        onKeyDown={(event) => {
          if (!editing) return;
          if (event.key === "Enter") { event.preventDefault(); ref.current?.blur(); }
          else if (event.key === "Escape") { event.preventDefault(); setEditing(false); }
        }}
      >
        {editing ? null : title}
      </h3>
      <button
        type="button"
        className="library-card-title-pencil"
        onClick={(event) => { event.stopPropagation(); setEditing(true); }}
        aria-label={`Rename ${title}`}
      >
        <Pencil className="size-3" />
      </button>
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
  onRename,
  onSave,
  isSaved,
}: {
  title: string;
  muted?: boolean;
  meta: ReactNode;
  matchCount: number;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  showActions?: boolean;
  onRename?: (name: string) => void;
  onSave?: () => void;
  isSaved?: boolean;
}) {
  return (
    <div className="library-card-heading">
      <EditableTitle title={title} muted={muted} onRename={onRename} />
      <div className="library-card-heading-right">
        <div className="library-card-meta">{meta}</div>
        {(showActions || onSave) && (
          <CardActions matchCount={matchCount} onOpenMatches={onOpenMatches} onOpenInfo={onOpenInfo} onSave={onSave} isSaved={isSaved} showMatchActions={showActions} />
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
  onRename,
  onSave,
  isSaved,
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
      onRename={onRename}
      onSave={onSave}
      isSaved={isSaved}
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
  onRename,
  onSave,
  isSaved,
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
  onRename?: (name: string) => void;
  onSave?: () => void;
  isSaved?: boolean;
}) {
  const source = sourceForId(fragment.sourceId);
  const links = linkSummaryFor(fragment.id);
  const keyLabel =
    formatMusicalKey(source?.key, source?.scale) ??
    (fragment.key && fragment.key !== "—" ? fragment.key : null);
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
        onRename={onRename}
        onSave={onSave}
        isSaved={isSaved}
        meta={(
          <>
            <MetaItem label="Recorded" value={fragment.dateLabel} />
            <MetaItem label="Length" value={formatSeconds(fragment.end - fragment.start)} />
            <MetaItem label="Key" value={keyLabel ?? "—"} />
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
