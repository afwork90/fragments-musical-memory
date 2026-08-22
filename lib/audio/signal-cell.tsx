"use client";

import { useMemo } from "react";
import { Play, Square } from "lucide-react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
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
  waveClassName = "source-signal-wave h-11 min-w-[180px] flex-1",
}: SignalCellProps) {
  const cached = useCachedAudioBySourceId(cacheSourceAudio && sourceId ? sourceId : null);
  const peaks = useMemo(() => {
    const base = cached?.peaks ?? values;
    if (slice && cached?.peaks) {
      return slicePeaks(base, slice.start, slice.end, slice.duration);
    }
    return base;
  }, [cached?.peaks, values, slice]);

  return (
    <div className={cn("source-signal-cell flex items-center gap-2", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("source-play-button size-7 shrink-0", isPreviewing && "text-primary")}
        disabled={!canPlay}
        onClick={(event) => {
          event.stopPropagation();
          onPreview();
        }}
        aria-label={ariaLabel}
      >
        {isPreviewing ? <Square className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
      </Button>
      <ContinuousWaveform values={peaks} active={isPreviewing} className={waveClassName} />
    </div>
  );
}
