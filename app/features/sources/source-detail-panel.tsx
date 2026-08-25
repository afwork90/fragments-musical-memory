"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Square } from "lucide-react";
import { MIN_BPM_CONFIDENCE } from "@/lib/analysis/features";
import { ChromaSparkline } from "@/lib/audio/chroma-sparkline";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import {
  MEASURED_HINTS,
  brightnessLabel,
  dynamicsLabel,
  intensityLabel,
} from "@/lib/audio/measured-labels";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { formatMusicalKey, resolvedSourceAnalysis } from "@/lib/audio/source-metadata";
import { Button } from "@/lib/ui/button";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { useSourceWaveform } from "@/lib/audio/use-source-waveform";
import { startDesktopDrag } from "@/lib/audio/desktop-drag";
import { formatSeconds } from "@/lib/format";
import type { MeasuredSummary } from "@/lib/view/analysis";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";
import type { MusicalRole } from "@/lib/view/vocabulary";
import { LIBRARY_ROLES } from "../library/library-columns";
import { cn } from "@/lib/utils";

export type SourceAnalysisValues = {
  bpm: number | null;
  key: string | null;
  scale: string | null;
};

export type FragmentLibraryMeta = {
  role: MusicalRole;
  userTags: string[];
};

type SourceDetailPanelProps = {
  source: SourceFile;
  fragmentCount: number;
  isPreviewing: boolean;
  canPlay: boolean;
  editable?: boolean;
  fragment?: Fragment | null;
  onPreview: () => void;
  onClose: () => void;
  onSaveAnalysis?: (analysis: SourceAnalysisValues) => void | Promise<void>;
  onSaveFragmentMeta?: (fragmentId: string, meta: FragmentLibraryMeta) => void;
};

function MetadataRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
      <span
        className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
        title={hint}
      >
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
  fragment = null,
  onPreview,
  onClose,
  onSaveAnalysis,
  onSaveFragmentMeta,
}: SourceDetailPanelProps) {
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const sidecar = useSourceWaveform(source.id);
  const wholeSource = cached?.peaks ?? sidecar;
  // A fragment's panel must show the fragment. Showing the whole recording made
  // every fragment of one source look identical, which is exactly the information
  // the panel exists to give.
  const values = useMemo(() => {
    if (fragment) {
      return wholeSource
        ? slicePeaks(wholeSource, fragment.start, fragment.end, source.duration)
        : fragment.waveform;
    }
    return wholeSource ?? source.waveform;
  }, [fragment, wholeSource, source.waveform, source.duration]);
  const { bpm: resolvedBpm, key: resolvedKey, scale: resolvedScale, keyStrength } = resolvedSourceAnalysis(source, cached);
  const keyLabel = formatMusicalKey(resolvedKey, resolvedScale);
  const roleOptions = LIBRARY_ROLES.filter((role): role is MusicalRole => role !== "All");

  const [bpm, setBpm] = useState(resolvedBpm != null ? String(resolvedBpm) : "");
  const [key, setKey] = useState(resolvedKey ?? "");
  const [scale, setScale] = useState(resolvedScale ?? "major");
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<MusicalRole>(fragment?.role ?? "Texture");
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>(fragment?.userTags ?? []);

  useEffect(() => {
    setBpm(resolvedBpm != null ? String(resolvedBpm) : "");
    setKey(resolvedKey ?? "");
    setScale(resolvedScale ?? "major");
  }, [resolvedBpm, resolvedKey, resolvedScale, source.id]);

  useEffect(() => {
    setRole(fragment?.role ?? "Texture");
    setTags(fragment?.userTags ?? []);
    setTagDraft("");
  }, [fragment?.id, fragment?.role, fragment?.userTags]);

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

  const persistFragmentMeta = (next: FragmentLibraryMeta) => {
    if (!fragment || !onSaveFragmentMeta) return;
    onSaveFragmentMeta(fragment.id, next);
  };

  const addTag = () => {
    const next = tagDraft.trim().toLowerCase();
    if (!next || tags.includes(next)) {
      setTagDraft("");
      return;
    }
    const updated = [...tags, next];
    setTags(updated);
    setTagDraft("");
    persistFragmentMeta({ role, userTags: updated });
  };

  const removeTag = (tag: string) => {
    const updated = tags.filter((item) => item !== tag);
    setTags(updated);
    persistFragmentMeta({ role, userTags: updated });
  };

  const changeRole = (next: MusicalRole) => {
    setRole(next);
    persistFragmentMeta({ role: next, userTags: tags });
  };

  return (
    <aside className="source-editor source-detail-panel">
      <ModalTitlebar
        eyebrow="Info"
        title={fragment?.name ?? source.name}
        onClose={onClose}
        closeLabel="Close info panel"
      />

      <div className="space-y-5">
        <p className="text-[11px] text-muted-foreground">
          {fragment
            ? `${formatSeconds(fragment.end - fragment.start)} · from ${source.name}`
            : `${formatSeconds(source.duration)} · ${source.format}`}
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

        {fragment && editable && (
          <div className="space-y-3 rounded-lg border border-border bg-card/40 p-4">
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Role</span>
              <div className="library-filter-pills info-meta-pills" role="group" aria-label="Fragment role">
                {roleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={cn("library-filter-pill", role === option && "library-filter-pill-active")}
                    aria-pressed={role === option}
                    onClick={() => changeRole(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tags</span>
              <div className="library-filter-pills info-meta-pills" role="list" aria-label="Fragment tags">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="library-filter-pill library-filter-pill-active"
                    onClick={() => removeTag(tag)}
                    title={`Remove ${tag}`}
                  >
                    {tag} ×
                  </button>
                ))}
              </div>
              <div className="info-tag-add">
                <input
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Add tag"
                  aria-label="Add tag"
                />
                <Button type="button" variant="outline" size="sm" onClick={addTag}>Add</Button>
              </div>
            </div>
          </div>
        )}

        {editable && !fragment ? (
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
        ) : !fragment ? (
          <>
            {resolvedBpm != null && <MetadataRow label="BPM" value={String(resolvedBpm)} />}
            {keyLabel && <MetadataRow label="Key" value={keyLabel} />}
          </>
        ) : null}

        <div>
          {fragment ? (
            <>
              <MetadataRow label="Source" value={source.name} />
              <MetadataRow label="Position" value={`${formatSeconds(fragment.start)} – ${formatSeconds(fragment.end)}`} />
              <MetadataRow label="Duration" value={formatSeconds(fragment.end - fragment.start)} />
            </>
          ) : (
            <>
              <MetadataRow label="Duration" value={formatSeconds(source.duration)} />
              <MetadataRow label="Fragments" value={String(fragmentCount)} />
            </>
          )}
          <MetadataRow label="Format" value={source.format} />
          {/* `date` is derived from importedAt, so it is when this arrived in the
              library, not when it was recorded — which nothing on disk records. */}
          <MetadataRow label="Imported" value={source.date} />
        </div>

        <MeasuredBlock measured={fragment ? fragment.measured : source.measured} />
      </div>
    </aside>
  );
}

/**
 * The measurements, or an honest statement that there are none.
 *
 * Every value can be absent, and absent renders as "—". A tempo is shown with its
 * confidence because essentia returns a plausible BPM at confidence 0 for short or
 * unrhythmic audio, and a bare "139 BPM" would present that as settled.
 *
 * Each row is a number a musician can act on, which is why the raw MFCC means and
 * the feature sample rate are not here: one has no readable units and the other is
 * a property of the pipeline, not of the audio. Labels say what the number means
 * rather than which algorithm produced it — "Rhythmic", not "Onsets".
 */
function MeasuredBlock({ measured }: { measured?: MeasuredSummary }) {
  if (!measured) {
    return (
      <div className="space-y-1 rounded-lg border border-border bg-card/40 p-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Measured</span>
        {/* No command here: the panel is read by whoever is using the app, not by
            whoever is building it. Where analysis comes from is our problem. */}
        <p className="text-[11px] text-muted-foreground">
          Nothing measured yet, so any tempo or key shown above is the recording&apos;s own or
          a placeholder.
        </p>
      </div>
    );
  }

  const tempo = measured.bpm === null
    ? "—"
    : measured.bpmConfidence === null
      ? `${measured.bpm} BPM`
      : measured.bpmConfidence >= MIN_BPM_CONFIDENCE
        ? `${measured.bpm} BPM · confidence ${measured.bpmConfidence.toFixed(2)}`
        : `${measured.bpm} BPM · confidence ${measured.bpmConfidence.toFixed(2)}, too low to trust`;

  const key = measured.key
    ? `${formatMusicalKey(measured.key, measured.scale) ?? measured.key}${measured.keyStrength != null ? ` · ${measured.keyStrength}% strength` : ""}`
    : "—";

  const loudness = measured.lufs === null
    ? "—"
    : measured.loudnessRange === null
      ? `${measured.lufs.toFixed(1)} LUFS`
      : `${measured.lufs.toFixed(1)} LUFS · range ${measured.loudnessRange.toFixed(1)} LU`;

  // Head and tail only. An interior gap count is not shipped: essentia's
  // GapsDetector found none anywhere in the library, and a hand-rolled envelope
  // count swung from 0 to 17 gaps on one recording across a 10dB span of
  // threshold, which makes it a knob rather than a measurement.
  const silence = measured.leadingSilence === null && measured.trailingSilence === null
    ? "—"
    : measured.leadingSilence === 0 && measured.trailingSilence === 0
      ? "none"
      : `head ${(measured.leadingSilence ?? 0).toFixed(2)}s · tail ${(measured.trailingSilence ?? 0).toFixed(2)}s`;

  return (
    <div className="space-y-1 rounded-lg border border-border bg-card/40 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Measured</span>
      <div>
        <MetadataRow label="Tempo" value={tempo} />
        <MetadataRow label="Key" value={key} />
        <MetadataRow
          label="Rhythmic"
          hint="Detected note attacks per second. A pad is near zero; a drum take is several."
          value={measured.onsetsPerSecond === null ? "—" : `${measured.onsetsPerSecond.toFixed(1)} onsets/sec`}
        />
        <MetadataRow
          label="Brightness"
          hint={MEASURED_HINTS.brightness}
          value={brightnessLabel(measured.centroidHz)}
        />
        <MetadataRow
          label="Texture"
          hint="Spectral flatness: how tonal or how noise-like the sound is."
          value={measured.flatness === null ? "—" : `${measured.flatness.toFixed(2)} (0 tonal, 1 noise)`}
        />
        <MetadataRow label="Loudness" hint="Integrated loudness over the analysed audio." value={loudness} />
        <MetadataRow
          label="Dynamics"
          hint={MEASURED_HINTS.dynamics}
          value={dynamicsLabel(measured.dynamicComplexity)}
        />
        <MetadataRow
          label="Intensity"
          hint={MEASURED_HINTS.intensity}
          value={intensityLabel(measured.intensity)}
        />
        <MetadataRow label="Silence" hint="Silence at the head and tail, worth trimming." value={silence} />
        <div className="flex items-center justify-between gap-4 border-b border-border/50 py-2 last:border-b-0">
          <span
            className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
            title={MEASURED_HINTS.chroma}
          >
            Chroma
          </span>
          {measured.chroma
            ? <ChromaSparkline chroma={measured.chroma} />
            : <span className="text-[11px] text-foreground/90">—</span>}
        </div>
      </div>
    </div>
  );
}