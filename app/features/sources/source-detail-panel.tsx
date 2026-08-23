"use client";

import { Play, Square } from "lucide-react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { Button } from "@/lib/ui/button";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { startDesktopDrag } from "@/lib/audio/desktop-drag";
import { formatSeconds } from "@/lib/format";
import { SourceFile } from "../../prototype-data";

type SourceDetailPanelProps = {
  source: SourceFile;
  fragmentCount: number;
  isPreviewing: boolean;
  canPlay: boolean;
  onPreview: () => void;
  onClose: () => void;
};

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-[11px] text-foreground/90" title={value}>
        {value}
      </span>
    </div>
  );
}

export function SourceDetailPanel({
  source,
  fragmentCount,
  isPreviewing,
  canPlay,
  onPreview,
  onClose,
}: SourceDetailPanelProps) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const values = cached?.peaks ?? source.waveform;
  const bpm = cached?.analysis.bpm ?? source.bpm ?? null;
  const key = cached?.analysis.key ?? source.key ?? null;
  const scale = cached?.analysis.scale ?? source.scale ?? null;
  const keyStrength = cached?.analysis.keyStrength ?? null;
  const keyLabel = key && scale ? `${key} ${scale}` : key;

  return (
    <aside className="source-editor source-detail-panel">
      <div className="source-editor-title">
        <h2>Source</h2>
        <button className="panel-close" onClick={onClose} aria-label="Close source panel">
          ×
        </button>
      </div>

      <div className="space-y-5">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground" title={source.name}>
            {source.name}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {formatSeconds(source.duration)} · {source.format}
          </p>
        </div>

        <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
          <div
            className="h-32 cursor-grab overflow-hidden rounded border border-border/60 bg-[#09080b] active:cursor-grabbing"
            draggable
            onDragStart={(event) => startDesktopDrag(event, { sourceId: source.id }, { audioUrl: source.audioUrl ?? "", fileName: `${source.name}.wav` })}
            title="Drag onto your desktop or into a DAW"
          >
            <ContinuousWaveform values={values} active={isPreviewing} />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canPlay}
              onClick={onPreview}
              title={canPlay ? undefined : "No audio available for this source."}
              aria-label={`${isPreviewing ? "Stop" : "Play"} ${source.name}`}
            >
              {isPreviewing ? (
                <Square className="size-3.5 fill-current" />
              ) : (
                <Play className="size-3.5 fill-current" />
              )}
              {isPreviewing ? "Stop" : "Play"}
            </Button>
            {bpm != null || keyLabel ? (
              <p className="text-[11px] text-muted-foreground">
                {bpm != null && (
                  <span>
                    <strong className="text-foreground">{bpm}</strong> BPM
                  </span>
                )}
                {bpm != null && keyLabel && <span> · </span>}
                {keyLabel && (
                  <span>
                    <strong className="text-foreground">{keyLabel}</strong>
                    {keyStrength != null ? ` (${keyStrength}%)` : ""}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">No tempo or key detected.</p>
            )}
          </div>
        </div>

        <div>
          <MetadataRow label="Recorded" value={source.date} />
          <MetadataRow label="Duration" value={formatSeconds(source.duration)} />
          <MetadataRow label="Format" value={source.format} />
          <MetadataRow label="Device" value={source.device} />
          <MetadataRow label="Type" value={source.sourceTypes.join(" · ") || "—"} />
          <MetadataRow label="Profile" value={source.analysisProfile.name} />
          <MetadataRow label="Fragments" value={String(fragmentCount)} />
        </div>
      </div>
    </aside>
  );
}
