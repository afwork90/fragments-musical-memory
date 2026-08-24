"use client";

import { useMemo } from "react";
import { Play, Square } from "lucide-react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { useSourceWaveform } from "@/lib/audio/use-source-waveform";
import { startDesktopDrag } from "@/lib/audio/desktop-drag";
import { Button } from "@/lib/ui/button";
import { cn } from "@/lib/utils";

type WaveformSlice = {
  start: number;
  end: number;
  duration: number;
};

type SignalCellProps = {
  values: number[];
  sourceId?: string | null;
  cacheSourceAudio?: boolean;
  slice?: WaveformSlice;
  isPreviewing: boolean;
  canPlay?: boolean;
  onPreview: () => void;
  ariaLabel: string;
  className?: string;
  waveClassName?: string;
  desktopDrag?: { audioUrl?: string; fileName: string } | null;
};

export function SignalCell({
  values,
  sourceId,
  cacheSourceAudio = false,
  slice,
  isPreviewing,
  canPlay = true,
  onPreview,
  ariaLabel,
  className,
  waveClassName,
  desktopDrag,
}: SignalCellProps) {
  const cached = useCachedAudioBySourceId(cacheSourceAudio && sourceId ? sourceId : null);
  const sidecar = useSourceWaveform(sourceId ?? undefined);
  // `values` may already be a slice, so only the whole-source forms get sliced here.
  const wholeSource = cached?.peaks ?? sidecar;
  const peaks = useMemo(() => {
    if (slice && wholeSource) {
      return slicePeaks(wholeSource, slice.start, slice.end, slice.duration);
    }
    return wholeSource ?? values;
  }, [wholeSource, values, slice]);

  return (
    <div className={cn("source-signal-cell flex w-full min-w-0 items-stretch gap-2", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("source-play-button size-9 shrink-0 self-center", isPreviewing && "text-[var(--card-action)]")}
        disabled={!canPlay}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        aria-label={ariaLabel}
      >
        {isPreviewing ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
      </Button>
      <div
        className={cn(
          "waveform-frame waveform-frame-fill source-signal-wave-slot min-w-0 flex-1",
          sourceId && desktopDrag && "cursor-grab active:cursor-grabbing",
        )}
        draggable={Boolean(sourceId && desktopDrag)}
        onDragStart={(event) => {
          if (!sourceId || !desktopDrag) return;
          startDesktopDrag(event, { sourceId }, desktopDrag.audioUrl ? { audioUrl: desktopDrag.audioUrl, fileName: desktopDrag.fileName } : undefined);
        }}
        title={sourceId && desktopDrag ? "Drag onto your desktop or into a DAW" : undefined}
      >
        <ContinuousWaveform
          values={peaks}
          active={isPreviewing}
          className={cn("source-signal-wave h-full w-full", waveClassName)}
        />
      </div>
    </div>
  );
}
