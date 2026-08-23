"use client";

import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Play, Square } from "lucide-react";
import { LibraryCard } from "@/app/features/library/library-card";
import { LibraryLinkSummary } from "@/app/features/library/library-list";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { playMediaElement } from "@/lib/audio/browser-audio";
import { resolveAudioUrl } from "@/lib/audio/resolve-audio-url";
import {
  PreviewScope,
  buildFragmentPreviewScope,
  progressForAudio,
  resolveSourceAudioUrl,
  timeForProgress,
} from "@/lib/audio/source-playback";
import { Button } from "@/lib/ui/button";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/format";
import { Fragment, MusicalRole, SourceFile } from "./prototype-data";

export type EditableRange = { id: string; fragmentId?: string; start: number; end: number; color: string };
type Edge = "start" | "end";

const noopLinkSummary = (): LibraryLinkSummary => ({ total: 0, manual: 0 });

function waveformSlice(values: number[], time: number, duration: number) {
  const center = Math.round((time / duration) * (values.length - 1));
  const start = Math.max(0, center - 5);
  const slice = values.slice(start, Math.min(values.length, center + 6));
  return slice.length > 2 ? slice : values;
}

function SensitivityKnob({
  sensitivity,
  onSensitivityChange,
}: {
  sensitivity: number;
  onSensitivityChange: (value: number) => void;
}) {
  const sensitivityDrag = useRef<{ y: number; value: number } | null>(null);
  const percent = Math.round(((sensitivity - 10) / 80) * 100);

  const beginSensitivityDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    sensitivityDrag.current = { y: event.clientY, value: sensitivity };
  };
  const moveSensitivityDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!sensitivityDrag.current) return;
    onSensitivityChange(
      Math.max(10, Math.min(90, Math.round(sensitivityDrag.current.value + (sensitivityDrag.current.y - event.clientY) * 0.75))),
    );
  };
  const finishSensitivityDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    sensitivityDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="sensitivity-control" title="Fragment sensitivity">
      <span className="sensitivity-label">Sensitivity</span>
      <button
        type="button"
        className="sensitivity-dial"
        role="slider"
        aria-label="Fragment sensitivity"
        aria-valuemin={10}
        aria-valuemax={90}
        aria-valuenow={sensitivity}
        onPointerDown={beginSensitivityDrag}
        onPointerMove={moveSensitivityDrag}
        onPointerUp={finishSensitivityDrag}
        onPointerCancel={finishSensitivityDrag}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowRight") {
            event.preventDefault();
            onSensitivityChange(Math.min(90, sensitivity + 4));
          }
          if (event.key === "ArrowDown" || event.key === "ArrowLeft") {
            event.preventDefault();
            onSensitivityChange(Math.max(10, sensitivity - 4));
          }
        }}
      >
        <span className="sensitivity-fill" style={{ height: `${percent}%` } as CSSProperties} />
      </button>
    </div>
  );
}

/** Strips a file extension (e.g. "Balcony idea.wav" -> "Balcony idea") for use in a fragment's default name. */
function stripExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function defaultFragmentName(source: SourceFile, index: number) {
  return `${stripExtension(source.name)} fragment ${index + 1}`;
}

export function draftFragmentForRange(
  range: EditableRange,
  index: number,
  source: SourceFile,
  peaks: number[],
  bpm: number | null | undefined,
): Fragment {
  return {
    id: range.id,
    name: defaultFragmentName(source, index),
    sourceId: source.id,
    source: source.name,
    start: range.start,
    end: range.end,
    date: source.date,
    dateLabel: source.date,
    duration: formatSeconds(range.end - range.start),
    key: "—",
    alternateKeys: [],
    bpm: bpm ?? 0,
    role: "Texture" as MusicalRole,
    roles: ["Texture"],
    brightness: 0,
    waveform: slicePeaks(peaks, range.start, range.end, source.duration),
    beats: 0,
    bars: 0,
    confidence: 0,
    userTags: [],
    analysisRevision: 0,
    audio: "",
    sourceTypes: source.sourceTypes,
  };
}

export function FragmentationWorkbench({
  source,
  ranges,
  fragments,
  sensitivity,
  focusedFragmentId,
  onRangesChange,
  onSensitivityChange,
  onAddRange,
  onSave,
  onClose,
  onOpenFragment,
  onRenameFragment,
  onSaveFragment,
  savedFragmentIds,
  saveLabel = "Save boundaries",
  footerContent,
}: {
  source: SourceFile;
  ranges: EditableRange[];
  fragments: Fragment[];
  sensitivity: number;
  focusedFragmentId?: string;
  onRangesChange: (ranges: EditableRange[]) => void;
  onSensitivityChange: (value: number) => void;
  onAddRange: () => void;
  onSave: () => void;
  onClose: () => void;
  onOpenFragment?: (id: string) => void;
  onRenameFragment?: (id: string, name: string) => void;
  onSaveFragment?: (id: string) => void;
  savedFragmentIds?: Set<string>;
  saveLabel?: string;
  footerContent?: ReactNode;
}) {
  const [dragged, setDragged] = useState<{ rangeId: string; edge: Edge } | null>(null);
  const [magnifier, setMagnifier] = useState<{ x: number; time: number; edge: Edge } | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const waveform = cached?.peaks ?? source.waveform;
  const analysisMeta = cached?.analysis;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewScopeRef = useRef<PreviewScope | null>(null);
  const progressRaf = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rangesRef = useRef(ranges);
  const onRangesChangeRef = useRef(onRangesChange);
  const canPlaySource = Boolean(resolveSourceAudioUrl(source));

  useEffect(() => { rangesRef.current = ranges; }, [ranges]);
  useEffect(() => { onRangesChangeRef.current = onRangesChange; }, [onRangesChange]);

  const stopPreview = useCallback(() => {
    cancelAnimationFrame(progressRaf.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    previewScopeRef.current = null;
    setPreviewingId(null);
    setPreviewProgress(null);
  }, []);

  const preview = useCallback((fragment: Fragment, startRatio = 0) => {
    const scope = buildFragmentPreviewScope(fragment, source);
    if (!scope) return;
    if (previewingId === fragment.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = new Audio(resolveAudioUrl(scope.url));
    audio.loop = !scope.clip;
    audio.volume = 0.72;
    audioRef.current = audio;
    previewScopeRef.current = scope;
    setPreviewingId(fragment.id);

    const syncPosition = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        setPreviewProgress(startRatio);
      } else {
        audio.currentTime = timeForProgress(scope, startRatio, audio.duration);
        setPreviewProgress(startRatio);
      }
    };

    if (audio.readyState >= 1) syncPosition();
    else audio.addEventListener("loadedmetadata", syncPosition, { once: true });

    playMediaElement(audio, () => stopPreview());
  }, [previewingId, source, stopPreview]);

  const seekPreview = useCallback((fragment: Fragment, ratio: number) => {
    const audio = audioRef.current;
    const scope = previewScopeRef.current;
    if (!audio || !scope || previewingId !== fragment.id || !Number.isFinite(audio.duration)) return;
    const clamped = Math.min(1, Math.max(0, ratio));
    audio.currentTime = timeForProgress(scope, clamped, audio.duration);
    setPreviewProgress(clamped);
  }, [previewingId]);

  useEffect(() => {
    if (!previewingId) return undefined;

    const tick = () => {
      const audio = audioRef.current;
      const scope = previewScopeRef.current;
      if (audio && scope && !audio.paused && Number.isFinite(audio.duration) && audio.duration > 0) {
        if (scope.clip && audio.currentTime >= scope.clip.end) {
          audio.currentTime = scope.clip.start;
        }
        setPreviewProgress(progressForAudio(scope, audio.currentTime, audio.duration));
      }
      progressRaf.current = requestAnimationFrame(tick);
    };

    progressRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(progressRaf.current);
  }, [previewingId]);

  useEffect(() => () => {
    cancelAnimationFrame(progressRaf.current);
    if (audioRef.current) audioRef.current.pause();
  }, []);

  const changeEdge = (range: EditableRange, edge: Edge, value: number) => {
    const next = rangesRef.current.map((item) => {
      if (item.id !== range.id) return item;
      if (edge === "start") {
        return { ...item, start: Math.max(0, Math.min(value, item.end - 0.5)) };
      }
      return { ...item, end: Math.min(source.duration, Math.max(value, item.start + 0.5)) };
    });
    rangesRef.current = next;
    onRangesChangeRef.current(next);
  };

  useEffect(() => {
    if (!dragged) return;
    const move = (event: PointerEvent) => {
      const rulerRect = rulerRef.current?.getBoundingClientRect();
      const timelineRect = timelineRef.current?.getBoundingClientRect();
      const active = rangesRef.current.find((range) => range.id === dragged.rangeId);
      if (!rulerRect || !timelineRect || !active) return;
      const rulerX = Math.max(0, Math.min(rulerRect.width, event.clientX - rulerRect.left));
      const time = (rulerX / rulerRect.width) * source.duration;
      const next = rangesRef.current.map((item) => {
        if (item.id !== active.id) return item;
        if (dragged.edge === "start") {
          return { ...item, start: Math.max(0, Math.min(time, item.end - 0.5)) };
        }
        return { ...item, end: Math.min(source.duration, Math.max(time, item.start + 0.5)) };
      });
      rangesRef.current = next;
      onRangesChangeRef.current(next);
      setMagnifier({
        x: Math.max(90, Math.min(timelineRect.width - 90, event.clientX - timelineRect.left)),
        time,
        edge: dragged.edge,
      });
    };
    const finish = () => {
      setDragged(null);
      setMagnifier(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
  }, [dragged, source.duration]);

  const beginRangeDrag = (event: ReactPointerEvent<HTMLButtonElement>, range: EditableRange, edge: Edge) => {
    event.preventDefault();
    event.stopPropagation();
    const timelineRect = timelineRef.current?.getBoundingClientRect();
    const rulerRect = rulerRef.current?.getBoundingClientRect();
    const time = edge === "start" ? range.start : range.end;
    const clientX = (rulerRect?.left ?? 0) + (time / source.duration) * (rulerRect?.width ?? 0);
    setMagnifier({
      x: timelineRect ? Math.max(90, Math.min(timelineRect.width - 90, clientX - timelineRect.left)) : 90,
      time,
      edge,
    });
    setDragged({ rangeId: range.id, edge });
  };

  const fragmentFor = (range: EditableRange) => (
    range.fragmentId ? fragments.find((fragment) => fragment.id === range.fragmentId) ?? null : null
  );

  const displayFragments = useMemo(
    () => ranges.map((range, index) => fragmentFor(range) ?? draftFragmentForRange(range, index, source, waveform, analysisMeta?.bpm)),
    [ranges, fragments, source, waveform, analysisMeta?.bpm],
  );

  const headerFragment = displayFragments[0];
  const previewingRange = ranges.find((range) => range.fragmentId === previewingId);
  const timelinePlayheadLeft = previewingRange && previewProgress != null
    ? ((previewingRange.start + previewProgress * (previewingRange.end - previewingRange.start)) / source.duration) * 100
    : null;

  const close = () => {
    stopPreview();
    onClose();
  };

  return (
    <aside className="source-editor fragmentation-workbench">
      <ModalTitlebar
        eyebrow="Fragment"
        title={source.name}
        onClose={close}
        closeLabel="Close fragment panel"
      />

      <div className="source-editor-head">
        <div>
          <p>
            {source.format} · {source.device}
            {analysisMeta?.bpm ? ` · ${analysisMeta.bpm} BPM` : ""}
            {analysisMeta?.key && analysisMeta.scale ? ` · ${analysisMeta.key} ${analysisMeta.scale}` : ""}
          </p>
        </div>
        <div className="source-editor-head-controls">
          <SensitivityKnob sensitivity={sensitivity} onSensitivityChange={onSensitivityChange} />
          {headerFragment && (
            <Button
              type="button"
              variant="lime"
              size="sm"
              className="fragment-workbench-play"
              disabled={!canPlaySource}
              onClick={() => preview(headerFragment)}
            >
              {previewingId === headerFragment.id ? (
                <><Square className="size-3.5 fill-current" /> Stop</>
              ) : (
                <><Play className="size-3.5 fill-current" /> Play</>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="timeline-card" ref={timelineRef}>
        <div className="fragment-lanes-scroll">
          <div className="fragment-lanes" ref={rulerRef} style={{ height: `${ranges.length * 23 + 4}px` }}>
            {ranges.map((range, index) => (
              <div
                className={cn("fragment-lane", range.fragmentId === focusedFragmentId && "focused")}
                key={range.id}
                style={{ top: `${index * 23}px`, "--fragment-color": range.color } as CSSProperties}
              >
                <div
                  className="fragment-bar"
                  style={{
                    left: `${(range.start / source.duration) * 100}%`,
                    width: `${((range.end - range.start) / source.duration) * 100}%`,
                  }}
                >
                  <button
                    type="button"
                    className="range-handle start"
                    onPointerDown={(event) => beginRangeDrag(event, range, "start")}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 1 : 0.25;
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        changeEdge(range, "start", range.start + (event.key === "ArrowLeft" ? -step : step));
                      }
                    }}
                    aria-label={`Adjust start of fragment ${index + 1}`}
                  />
                  <span>
                    F{String(index + 1).padStart(2, "0")} · {formatSeconds(range.start)}–{formatSeconds(range.end)}
                  </span>
                  <button
                    type="button"
                    className="range-handle end"
                    onPointerDown={(event) => beginRangeDrag(event, range, "end")}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 1 : 0.25;
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        changeEdge(range, "end", range.end + (event.key === "ArrowLeft" ? -step : step));
                      }
                    }}
                    aria-label={`Adjust end of fragment ${index + 1}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        {magnifier && dragged && (
          <div className="ruler-edge-magnifier" style={{ left: `${magnifier.x}px` }}>
            <strong>{magnifier.edge} · {formatSeconds(magnifier.time)}</strong>
            <ContinuousWaveform values={waveformSlice(waveform, magnifier.time, source.duration)} />
          </div>
        )}
        <div className="timeline-labels">
          <span>0:00</span>
          <span>{formatSeconds(source.duration / 2)}</span>
          <span>{formatSeconds(source.duration)}</span>
        </div>
        <div className="continuous-wave-wrap">
          <ContinuousWaveform values={waveform} active={Boolean(previewingId)} />
          {ranges.map((range, index) => (
            <div
              className={cn("wave-range", range.fragmentId === previewingId && "auditioning")}
              key={range.id}
              style={{
                left: `${(range.start / source.duration) * 100}%`,
                width: `${((range.end - range.start) / source.duration) * 100}%`,
                "--fragment-color": range.color,
              } as CSSProperties}
            >
              <span>F{index + 1}</span>
            </div>
          ))}
          {timelinePlayheadLeft != null && (
            <div
              className="fragment-timeline-playhead library-wave-playhead"
              style={{ left: `${timelinePlayheadLeft}%` }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="fragment-summary">
          <strong>{ranges.length} fragments</strong>
          <span>Drag a ruler edge to trim · Shift + arrow for 1 second</span>
        </div>
      </div>

      <div className="source-lower fragment-workbench-lower">
        <div className="fragment-workbench-cards">
          <div className="fragment-workbench-cards-head">
            <h3>Fragments</h3>
            <div className="detected-actions">
              <Button type="button" variant="outline" size="sm" className="library-card-action" onClick={onAddRange}>
                ＋ Add fragment
              </Button>
              <Button type="button" variant="outline" size="sm" className="library-card-action" onClick={onSave}>
                {saveLabel}
              </Button>
            </div>
          </div>
          <div className="fragment-workbench-card-list library-card-stack">
            {ranges.map((range, index) => {
              const fragment = displayFragments[index];
              const saved = Boolean(fragmentFor(range));
              const isPreviewing = previewingId === fragment.id;
              return (
                <div
                  key={range.id}
                  className="fragment-workbench-card"
                  style={{ "--fragment-color": range.color } as CSSProperties}
                >
                  <LibraryCard
                    item={{ kind: "fragment", id: fragment.id, fragment }}
                    isSelected={range.fragmentId === focusedFragmentId}
                    isPreviewing={isPreviewing}
                    previewProgress={isPreviewing ? previewProgress : null}
                    showActions={false}
                    embedded
                    sourceNameFor={() => source.name}
                    sourceForId={() => source}
                    linkSummaryFor={noopLinkSummary}
                    fragmentAudioFor={() => source.audioUrl}
                    onSelect={() => {
                      if (saved && onOpenFragment) onOpenFragment(fragment.id);
                    }}
                    onPreview={() => preview(fragment)}
                    onSeek={(ratio) => seekPreview(fragment, ratio)}
                    onOpenMatches={() => {}}
                    onOpenInfo={() => {}}
                    onRename={onRenameFragment ? (name) => onRenameFragment(fragment.id, name) : undefined}
                    onSave={onSaveFragment ? () => onSaveFragment(fragment.id) : undefined}
                    isSaved={saved && savedFragmentIds ? savedFragmentIds.has(fragment.id) : false}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {footerContent}
    </aside>
  );
}
