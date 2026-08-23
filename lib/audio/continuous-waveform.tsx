import { cn } from "@/lib/utils";
import { waveformPath } from "@/lib/audio/waveform-path";
import { useWaveformSvgIds, WaveformShape, WaveformSvgDefs } from "@/lib/audio/waveform-svg";

type ContinuousWaveformProps = {
  values: number[];
  active?: boolean;
  className?: string;
};

export function ContinuousWaveform({ values, active = false, className }: ContinuousWaveformProps) {
  const ids = useWaveformSvgIds();

  return (
    <svg
      className={cn("continuous-wave hero-wave block h-full w-full min-h-0", active && "active", className)}
      viewBox="0 0 1000 160"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <WaveformSvgDefs ids={ids} />
      <WaveformShape d={waveformPath(values)} active={active} ids={ids} />
    </svg>
  );
}
