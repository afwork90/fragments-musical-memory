import { useId } from "react";

export type WaveformSvgIds = {
  fillGradientId: string;
  glowFilterId: string;
  activeGlowFilterId: string;
};

export function useWaveformSvgIds(): WaveformSvgIds {
  const uid = useId().replace(/:/g, "");
  return {
    fillGradientId: `wf-fill-${uid}`,
    glowFilterId: `wf-glow-${uid}`,
    activeGlowFilterId: `wf-glow-active-${uid}`,
  };
}

export function WaveformSvgDefs({ ids }: { ids: WaveformSvgIds }) {
  return (
    <defs>
      <linearGradient id={ids.fillGradientId} gradientUnits="objectBoundingBox" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--waveform-fill-edge)" />
        <stop offset="38%" stopColor="var(--waveform-fill)" />
        <stop offset="50%" stopColor="var(--waveform-fill-center)" />
        <stop offset="62%" stopColor="var(--waveform-fill)" />
        <stop offset="100%" stopColor="var(--waveform-fill-edge)" />
      </linearGradient>
      <filter
        id={ids.glowFilterId}
        x="-8%"
        y="-35%"
        width="116%"
        height="170%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter
        id={ids.activeGlowFilterId}
        x="-10%"
        y="-40%"
        width="120%"
        height="180%"
        colorInterpolationFilters="sRGB"
      >
        <feGaussianBlur in="SourceGraphic" stdDeviation="2.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

type WaveformShapeProps = {
  d: string;
  active?: boolean;
  ids: WaveformSvgIds;
};

export function WaveformShape({ d, active = false, ids }: WaveformShapeProps) {
  return (
    <path
      d={d}
      fill={`url(#${ids.fillGradientId})`}
      stroke="var(--waveform-stroke)"
      strokeWidth={1.2}
      vectorEffect="non-scaling-stroke"
      strokeOpacity={active ? 0.95 : 0.72}
      filter={`url(#${active ? ids.activeGlowFilterId : ids.glowFilterId})`}
      opacity={active ? 1 : 0.94}
    />
  );
}
