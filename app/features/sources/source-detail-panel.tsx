"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Square } from "lucide-react";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
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

/**
 * Mirrors `MIN_BPM_CONFIDENCE` in `lib/analysis/features.ts`. Not imported from
 * there: this component would then pull the essentia-facing module into the
 * renderer bundle for one number.
 */
const TRUSTED_BPM_CONFIDENCE = 1;

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
          <MetadataRow label="Type" value={source.sourceTypes.join(" · ") || "—"} />
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
 */
function MeasuredBlock({ measured }: { measured?: MeasuredSummary }) {
  if (!measured) {
    return (
      <div className="space-y-1 rounded-lg border border-border bg-card/40 p-4">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Measured</span>
        <p className="text-[11px] text-muted-foreground">
          Not analysed yet. Run <code>npm run analyze -- --write</code>.
        </p>
      </div>
    );
  }

  const tempo = measured.bpm === null
    ? "—"
    : measured.bpmConfidence === null
      ? `${measured.bpm} BPM`
      : measured.bpmConfidence >= TRUSTED_BPM_CONFIDENCE
        ? `${measured.bpm} BPM · confidence ${measured.bpmConfidence.toFixed(2)}`
        : `${measured.bpm} BPM · confidence ${measured.bpmConfidence.toFixed(2)}, too low to trust`;

  const key = measured.key
    ? `${formatMusicalKey(measured.key, measured.scale) ?? measured.key}${measured.keyStrength != null ? ` · ${measured.keyStrength}% strength` : ""}`
    : "—";

  return (
    <div className="space-y-1 rounded-lg border border-border bg-card/40 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Measured</span>
      <div>
        <MetadataRow label="Tempo" value={tempo} />
        <MetadataRow label="Key" value={key} />
        <MetadataRow
          label="Brightness"
          value={measured.centroidHz === null ? "—" : `${Math.round(measured.centroidHz)} Hz centroid`}
        />
        <MetadataRow label="Onsets" value={measured.onsetCount === null ? "—" : String(measured.onsetCount)} />
        <MetadataRow
          label="Timbre"
          value={measured.hasTimbre ? "MFCC measured" : "—"}
        />
        <MetadataRow
          label="Chroma"
          value={measured.hasChroma ? "12 bins measured" : "—"}
        />
        {measured.featureSampleRate != null && (
          <MetadataRow label="Feature rate" value={`${measured.featureSampleRate} Hz`} />
        )}
      </div>
    </div>
  );
}
