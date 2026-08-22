import { cn } from "@/lib/utils";
import { waveformPath } from "@/lib/audio/waveform-path";

type ContinuousWaveformProps = {
  values: number[];
  active?: boolean;
  className?: string;
};

export function ContinuousWaveform({ values, active = false, className }: ContinuousWaveformProps) {
  return (
    <svg
      className={cn("continuous-wave hero-wave", active && "active", className)}
      viewBox="0 0 1000 160"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={waveformPath(values)} />
    </svg>
  );
}
