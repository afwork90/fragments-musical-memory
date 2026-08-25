"use client";

import { DragEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Check, Hand, Pencil, Play, Square, Trash2 } from "lucide-react";
import { ScrubbableWaveform } from "@/lib/audio/scrubbable-waveform";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { useSourceWaveform } from "@/lib/audio/use-source-waveform";
import { startDesktopDrag } from "@/lib/audio/desktop-drag";
import { MIN_BPM_CONFIDENCE } from "@/lib/analysis/features";
import { formatMusicalKey, fragmentKeyLabels, resolvedSourceAnalysis } from "@/lib/audio/source-metadata";
import { resolveSourceAudioUrl, buildFragmentPreviewScope } from "@/lib/audio/source-playback";
import { Button } from "@/lib/ui/button";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/format";
import type { DragTarget } from "@/lib/ipc/contract";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";
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
  onDelete?: () => void;
  isSaved?: boolean;
  dragPayload?: DragPayload;
};

/**
 * What a drag out of this card hands over, when it is not simply the managed source
 * file.
 *
 * The affinities workspace supplies the rendered match here, so what a DAW receives
 * is what was being auditioned — the slice, at the matched tempo, in the matched
 * key.
 */
export type DragPayload = {
  target: DragTarget;
  /** For the browser, which cannot hand over a path. A blob URL is fine. */
  audioUrl?: string;
  fileName?: string;
};

/**
 * Dragging a card out to the desktop or a DAW.
 *
 * Deliberately its own target rather than the waveform. The waveform's click places
 * the playhead, so making the whole strip draggable put two gestures on one control
 * and advertised only the one you could not perform by clicking — the tooltip said
 * "drag me" while a click did something else entirely.
 */
function DragHandle({
  disabled,
  label,
  onDragStart,
}: {
  disabled: boolean;
  label: string;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <button
      type="button"
      className="library-card-drag-handle"
      draggable={!disabled}
      disabled={disabled}
      onDragStart={onDragStart}
      // The card below would otherwise take a click that was only ever a missed grab.
      onClick={(event) => event.stopPropagation()}
      title={disabled ? undefined : "Drag onto your desktop or into a DAW"}
      aria-label={label}
    >
      <Hand className="size-4" aria-hidden />
    </button>
  );
}

function MetaItem({
  label,
  value,
  unsure,
  hint,
}: {
  label: string;
  value: string;
  /** Measured, but not firmly enough for anything to act on. */
  unsure?: boolean;
  hint?: string;
}) {
  return (
    <span className="library-card-meta-item">
      <span className="library-card-meta-label">{label}</span>
      <span
        className={cn("library-card-meta-value", unsure && "library-card-meta-unsure")}
        title={hint}
      >
        {value}
      </span>
    </span>
  );
}

function CardActions({
  matchCount,
  onOpenMatches,
  onOpenInfo,
  onSave,
  onDelete,
  isSaved,
  showMatchActions = true,
}: {
  matchCount: number;
  onOpenMatches: () => void;
  onOpenInfo: () => void;
  onSave?: () => void;
  onDelete?: () => void;
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
      {onDelete && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="library-card-action library-card-action-delete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          aria-label="Delete fragment"
        >
          <Trash2 className="size-3" />
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
  onDelete,
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
  onDelete?: () => void;
  isSaved?: boolean;
}) {
  return (
    <div className="library-card-heading">
      <EditableTitle title={title} muted={muted} onRename={onRename} />
      <div className="library-card-heading-right">
        <div className="library-card-meta">{meta}</div>
        {(showActions || onSave || onDelete) && (
          <CardActions matchCount={matchCount} onOpenMatches={onOpenMatches} onOpenInfo={onOpenInfo} onSave={onSave} onDelete={onDelete} isSaved={isSaved} showMatchActions={showActions} />
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
  onDelete,
  isSaved,
  dragPayload,
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
      onDelete={onDelete}
      isSaved={isSaved}
      dragPayload={dragPayload}
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
  const sidecar = useSourceWaveform(source.id);
  const peaks = cached?.peaks ?? sidecar ?? source.waveform;
  const matchCount = source.fragmentIds.reduce((sum, id) => sum + linkSummaryFor(id).total, 0);
  const analysis = resolvedSourceAnalysis(source, cached);
  const bpm = analysis.bpm;
  const keyLabel = formatMusicalKey(analysis.key, analysis.scale);
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
            <MetaItem label="Imported" value={source.date} />
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
        <div className="library-card-wave-slot">
          <ScrubbableWaveform
            values={peaks}
            active={isPreviewing}
            progress={isPreviewing ? previewProgress : null}
            onSeek={canPlay ? onSeek : undefined}
          />
        </div>
        <DragHandle
          disabled={!canPlay}
          label={`Drag ${source.name} out`}
          onDragStart={(event) => {
            startDesktopDrag(event, { sourceId: source.id, label: source.name }, { audioUrl: resolveSourceAudioUrl(source, fragmentAudioFor) ?? "", fileName: `${source.name}.wav` });
          }}
        />
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
  onDelete,
  isSaved,
  dragPayload,
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
  onDelete?: () => void;
  isSaved?: boolean;
  dragPayload?: DragPayload;
}) {
  const source = sourceForId(fragment.sourceId);
  const links = linkSummaryFor(fragment.id);
  // The fragment's own measurement first. `fragment.key` already falls back to the
  // source when the fragment was never measured, so reading the source here only
  // hid what analysis found: an F# minor fragment of a D major take.
  const [keyLabel] = fragmentKeyLabels(fragment, source);
  // Essentia answers with a plausible tempo at zero confidence for unrhythmic audio,
  // and 12 of 26 fragments come back that way. Printing that number bare is what made
  // the transform console look arbitrary when it declined to match to it.
  const tempoUnsure = fragment.bpm > 0
    && fragment.measured !== undefined
    && (fragment.measured.bpmConfidence ?? 0) < MIN_BPM_CONFIDENCE;
  const slice = source
    ? { start: fragment.start, end: fragment.end, duration: source.duration }
    : undefined;
  const cached = useCachedAudioBySourceId(fragment.sourceId);
  const sidecar = useSourceWaveform(fragment.sourceId);
  // Whole-source peaks, which still need slicing to this fragment. `fragment.waveform`
  // is already a slice of the thumbnail, so it must not be sliced again.
  const wholeSource = cached?.peaks ?? sidecar;
  const peaks = useMemo(() => {
    if (waveformValues) return waveformValues;
    if (slice && wholeSource) {
      return slicePeaks(wholeSource, slice.start, slice.end, slice.duration);
    }
    return wholeSource ?? fragment.waveform;
  }, [wholeSource, fragment.waveform, slice, waveformValues]);
  const canPlay = Boolean(source && buildFragmentPreviewScope(fragment, source, fragmentAudioFor));
  // Without an override the drag hands over the whole managed recording, which is
  // all the main process can resolve from a source id alone. `label` is what keeps
  // the dropped file from being named after a uuid.
  const dragTarget = dragPayload?.target ?? { sourceId: fragment.sourceId, label: fragment.name };
  const dragAudioUrl =
    dragPayload?.audioUrl
    ?? (source ? resolveSourceAudioUrl(source, fragmentAudioFor) ?? "" : "");
  const dragFileName = dragPayload?.fileName ?? `${fragment.name}.wav`;

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
        onDelete={onDelete}
        isSaved={isSaved}
        meta={(
          <>
            <MetaItem label="Imported" value={fragment.dateLabel} />
            <MetaItem label="Length" value={formatSeconds(fragment.end - fragment.start)} />
            <MetaItem label="Key" value={keyLabel ?? "—"} />
            <MetaItem
              label="BPM"
              value={fragment.bpm > 0 ? String(fragment.bpm) : "—"}
              unsure={tempoUnsure}
              hint={tempoUnsure
                ? "Measured at low confidence, which is how essentia answers unrhythmic audio. Nothing matches tempo to it."
                : undefined}
            />
            {/* Falls back to the denormalized name so a fragment whose source has
                been archived still says where it came from. */}
            <MetaItem label="Source" value={source?.name || fragment.source || "—"} />
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
          aria-label={`${isPreviewing ? "Stop" : "Play"} ${fragment.name}`}
        >
          {isPreviewing ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </Button>
        {waveActions}
        <div className="library-card-wave-slot">
          <ScrubbableWaveform
            values={peaks}
            active={isPreviewing}
            progress={isPreviewing ? previewProgress : null}
            onSeek={canPlay ? onSeek : undefined}
          />
        </div>
        <DragHandle
          disabled={!canPlay || !dragAudioUrl}
          label={`Drag ${fragment.name} out`}
          onDragStart={(event) => {
            if (!dragAudioUrl) return;
            startDesktopDrag(event, dragTarget, { audioUrl: dragAudioUrl, fileName: dragFileName });
          }}
        />
      </div>
    </article>
  );
}
