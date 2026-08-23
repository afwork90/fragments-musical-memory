"use client";

import { PointerEvent, useRef, useState } from "react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { cn } from "@/lib/utils";

type ScrubbableWaveformProps = {
  values: number[];
  active?: boolean;
  progress?: number | null;
  className?: string;
  onSeek?: (ratio: number) => void;
};

function ratioFromEvent(element: HTMLElement, clientX: number) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

export function ScrubbableWaveform({
  values,
  active = false,
  progress = null,
  className,
  onSeek,
}: ScrubbableWaveformProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  const displayProgress = scrubbing && scrubRatio != null ? scrubRatio : progress;
  const interactive = Boolean(onSeek);

  const seekAt = (clientX: number) => {
    if (!trackRef.current || !onSeek) return;
    const ratio = ratioFromEvent(trackRef.current, clientX);
    setScrubRatio(ratio);
    onSeek(ratio);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    event.preventDefault();
    event.stopPropagation();
    setScrubbing(true);
    seekAt(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing || !onSeek) return;
    seekAt(event.clientX);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    setScrubbing(false);
    setScrubRatio(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      ref={trackRef}
      className={cn(
        "waveform-frame library-wave-track relative min-w-0 flex-1 overflow-hidden",
        interactive && "cursor-pointer touch-none",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDragStart={(event) => event.preventDefault()}
      role={interactive ? "slider" : undefined}
      aria-label={interactive ? "Seek waveform" : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 100 : undefined}
      aria-valuenow={interactive && displayProgress != null ? Math.round(displayProgress * 100) : undefined}
    >
      <ContinuousWaveform
        values={values}
        active={active || scrubbing}
        className="library-wave-svg"
      />
      {displayProgress != null && (
        <div
          className="library-wave-playhead pointer-events-none absolute inset-y-0 z-10 w-px bg-[var(--lime)] shadow-[0_0_10px_#c8fa78]"
          style={{ left: `${displayProgress * 100}%` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
