"use client";

import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { formatMusicalKey } from "@/lib/audio/source-metadata";
import { Button } from "@/lib/ui/button";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { startDesktopDrag } from "@/lib/audio/desktop-drag";
import { formatSeconds } from "@/lib/format";
import { SourceFile } from "../../prototype-data";

export type SourceAnalysisValues = {
  bpm: number | null;
  key: string | null;
  scale: string | null;
};

type SourceDetailPanelProps = {
  source: SourceFile;
  fragmentCount: number;
  isPreviewing: boolean;
  canPlay: boolean;
  editable?: boolean;
  onPreview: () => void;
  onClose: () => void;
  onSaveAnalysis?: (analysis: SourceAnalysisValues) => void | Promise<void>;
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
  editable = false,
  onPreview,
  onClose,
  onSaveAnalysis,
}: SourceDetailPanelProps) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const values = cached?.peaks ?? source.waveform;
  const resolvedBpm = cached?.analysis.bpm ?? source.bpm ?? null;
  const resolvedKey = cached?.analysis.key ?? source.key ?? null;
  const resolvedScale = cached?.analysis.scale ?? source.scale ?? null;
  const keyStrength = cached?.analysis.keyStrength ?? null;
  const keyLabel = formatMusicalKey(resolvedKey, resolvedScale);

  const [bpm, setBpm] = useState(resolvedBpm != null ? String(resolvedBpm) : "");
  const [key, setKey] = useState(resolvedKey ?? "");
  const [scale, setScale] = useState(resolvedScale ?? "major");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setBpm(resolvedBpm != null ? String(resolvedBpm) : "");
    setKey(resolvedKey ?? "");
    setScale(resolvedScale ?? "major");
  }, [resolvedBpm, resolvedKey, resolvedScale, source.id]);

  const saveAnalysis = async () => {
    if (!onSaveAnalysis) return;
    setSaving(true);
    try {
      const parsedBpm = bpm.trim() === "" ? null : Number(bpm);
      await onSaveAnalysis({
        bpm: parsedBpm != null && Number.isFinite(parsedBpm) ? Math.round(parsedBpm) : null,
        key: key.trim() || null,
        scale: scale || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="source-editor source-detail-panel">
      <ModalTitlebar
        eyebrow="Info"
        title={source.name}
        onClose={onClose}
        closeLabel="Close info panel"
      />

      <div className="space-y-5">
        <p className="text-[11px] text-muted-foreground">
          {formatSeconds(source.duration)} · {source.format}
        </p>

        <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
          <div
            className="waveform-frame h-32 cursor-grab active:cursor-grabbing"
            draggable
            onDragStart={(event) => startDesktopDrag(event, { sourceId: source.id }, { audioUrl: source.audioUrl ?? "", fileName: `${source.name}.wav` })}
            title="Drag onto your desktop or into a DAW"
          >
            <ContinuousWaveform values={values} active={isPreviewing} className="h-full w-full" />
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
            {!editable && (resolvedBpm != null || keyLabel) && (
              <p className="text-[11px] text-muted-foreground">
                {resolvedBpm != null && (
                  <span>
                    <strong className="text-foreground">{resolvedBpm}</strong> BPM
                  </span>
                )}
                {resolvedBpm != null && keyLabel && <span> · </span>}
                {keyLabel && (
                  <span>
                    <strong className="text-foreground">{keyLabel}</strong>
                    {keyStrength != null ? ` (${keyStrength}%)` : ""}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {editable ? (
          <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
            <label className="block space-y-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">BPM</span>
              <input
                className="w-full rounded border border-border bg-[#0d0c10] px-2 py-1.5 text-[12px] text-foreground"
                inputMode="numeric"
                value={bpm}
                onChange={(event) => setBpm(event.target.value)}
                placeholder="—"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Key</span>
              <input
                className="w-full rounded border border-border bg-[#0d0c10] px-2 py-1.5 text-[12px] text-foreground"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="C"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Scale</span>
              <select
                className="w-full rounded border border-border bg-[#0d0c10] px-2 py-1.5 text-[12px] text-foreground"
                value={scale}
                onChange={(event) => setScale(event.target.value)}
              >
                <option value="major">Major</option>
                <option value="minor">Minor</option>
              </select>
            </label>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="library-card-action"
                disabled={saving || !onSaveAnalysis}
                onClick={() => void saveAnalysis()}
              >
                {saving ? "Saving…" : "Save metadata"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {resolvedBpm != null && <MetadataRow label="BPM" value={String(resolvedBpm)} />}
            {keyLabel && <MetadataRow label="Key" value={keyLabel} />}
          </>
        )}

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
