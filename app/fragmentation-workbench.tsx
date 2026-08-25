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
import { Check, Play, Square } from "lucide-react";
import { LibraryCard } from "@/app/features/library/library-card";
import { LibraryLinkSummary } from "@/app/features/library/library-list";
import { useCachedAudioBySourceId } from "@/lib/audio/use-audio-cache";
import { useSourceWaveform } from "@/lib/audio/use-source-waveform";
import { ContinuousWaveform } from "@/lib/audio/continuous-waveform";
import { slicePeaks } from "@/lib/audio/slice-peaks";
import { resolvedSourceAnalysis } from "@/lib/audio/source-metadata";
import { playMediaElement } from "@/lib/audio/browser-audio";
import { resolveAudioUrl } from "@/lib/audio/resolve-audio-url";
import {
  PreviewScope,
  applyPreviewTime,
  buildFragmentPreviewScope,
  progressForAudio,
  resolveSourceAudioUrl,
} from "@/lib/audio/source-playback";
import { Button } from "@/lib/ui/button";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { cn } from "@/lib/utils";
import { formatSeconds } from "@/lib/format";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";
import type { MusicalRole } from "@/lib/view/vocabulary";

export type EditableRange = { id: string; fragmentId?: string; start: number; end: number; color: string };
type Edge = "start" | "end";

const noopLinkSummary = (): LibraryLinkSummary => ({ total: 0, manual: 0 });

/** Keep in sync with `.boundary-handle` in globals.css — the placement math is in pixels. */
const HANDLE_WIDTH = 16;
/**
 * How near a boundary counts as reaching for it. Generous on purpose: this band, not the chip,
 * is what the hand has to hit. Measured against the library, it gives every boundary of a
 * six-slice source the full 24px and all but the four thinnest slices of a 17-slice source at
 * least 9px.
 */
const GRAB_REACH = 24;

type BoundaryHandle = {
  range: EditableRange;
  index: number;
  edge: Edge;
  time: number;
  /** Position along the rail, 0..1. */
  ratio: number;
  /** Pixels the chip is nudged off its boundary, which only the rail's own ends cause. */
  shift: number;
};

/** Which boundary the pointer is reaching for, and the slice it belongs to. */
type ActiveHandle = { rangeId: string; edge: Edge | null };

const ratioOf = (time: number, duration: number) => (duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0);

/**
 * A chip is **centred on its boundary**, always, so the line it moves runs through it and it
 * is the same target from either side. The only thing that moves it is the end of the rail,
 * so a boundary at 0:00 is not half off screen.
 */
function handleShift(at: number, width: number): number {
  if (width <= 0) return 0;
  const half = HANDLE_WIDTH / 2;
  return Math.max(half, Math.min(width - half, at)) - at;
}

/** One range's two handles, ready to render. */
function boundaryHandlesFor(range: EditableRange, index: number, duration: number, width: number): BoundaryHandle[] {
  return ([["start", range.start], ["end", range.end]] as [Edge, number][]).map(([edge, time]) => {
    const ratio = ratioOf(time, duration);
    return { range, index, edge, time, ratio, shift: handleShift(ratio * width, width) };
  });
}

/**
 * Which boundary the pointer is reaching for, `x` being rail pixels. Pressing down anywhere
 * within `GRAB_REACH` of a boundary takes hold of it, so a handle is never something to be
 * hit — the chip only shows which boundary you already have.
 *
 * Every handle is grabbed **from inside its own slice**. That settles the two coincident
 * handles at a shared cut: the one you get is the one whose slice you are standing in. It is
 * also what keeps a slice too thin to hold a chip editable — its left half trims its start,
 * its right half trims its end — which no amount of chip placement can do, because two 16px
 * chips do not fit in the 7px a 1.5-second slice gets on a six-minute source.
 *
 * Nearest boundary wins, ties going to the narrower slice, which is the one with nowhere
 * else to be reached from. With no boundary in reach the answer is the slice itself, so
 * pointing into the middle of a long fragment still says which fragment that is.
 */
function activeHandleAt(ranges: EditableRange[], x: number, width: number, duration: number): ActiveHandle | null {
  if (width <= 0 || duration <= 0) return null;
  let boundary: { rangeId: string; edge: Edge; distance: number; span: number } | null = null;
  let inside: { rangeId: string; span: number } | null = null;
  for (const range of ranges) {
    const left = ratioOf(range.start, duration) * width;
    const right = ratioOf(range.end, duration) * width;
    const span = right - left;
    if (x >= left && x <= right && (!inside || span < inside.span)) inside = { rangeId: range.id, span };
    const edges: [Edge, number][] = [];
    if (x >= left) edges.push(["start", left]);
    if (x <= right) edges.push(["end", right]);
    for (const [edge, at] of edges) {
      const distance = Math.abs(x - at);
      if (distance > GRAB_REACH) continue;
      if (!boundary || distance < boundary.distance || (distance === boundary.distance && span < boundary.span)) {
        boundary = { rangeId: range.id, edge, distance, span };
      }
    }
  }
  if (boundary) return { rangeId: boundary.rangeId, edge: boundary.edge };
  return inside ? { rangeId: inside.rangeId, edge: null } : null;
}

function waveformSlice(values: number[], time: number, duration: number) {
  const center = Math.round((time / duration) * (values.length - 1));
  const start = Math.max(0, center - 5);
  const slice = values.slice(start, Math.min(values.length, center + 6));
  return slice.length > 2 ? slice : values;
}

/**
 * The dial only feeds `fragmentCountForSensitivity`, which maps it to a fragment
 * count between 1 and 6 — it does not influence any real onset detection. Hidden
 * rather than deleted: it earns its place back once slicing runs off measured
 * onsets, and the plumbing behind it is still wired.
 */
const SHOW_SENSITIVITY: boolean = false;

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

/**
 * Whether the editor's slices differ from the fragments the library holds. Comparing
 * rather than tracking edits means dragging a boundary and dragging it back reports
 * nothing to save, and a freshly imported source — whose ranges point at no fragment
 * yet — reports every slice as unsaved without anyone having to remember to flag it.
 *
 * It cannot see an edit the ranges do not carry, which today is a rename; the app
 * tracks that separately and ors it in.
 */
export function hasUnsavedRanges(ranges: EditableRange[], fragments: Fragment[]) {
  return ranges.some((range) => {
    if (!range.fragmentId) return true;
    const fragment = fragments.find((item) => item.id === range.fragmentId);
    if (!fragment) return true;
    return Math.abs(fragment.start - range.start) > 0.001 || Math.abs(fragment.end - range.end) > 0.001;
  });
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
  onDeleteFragment,
  unsavedChanges,
  saveLabel = "Save all fragments",
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
  onDeleteFragment?: (id: string) => void;
  /**
   * Whether anything here differs from the library on disk. Leave it undefined to get a
   * plain save button, which is what the combine flow wants — it saves one correction and
   * recomputes, so "all fragments saved" would be a claim about something else.
   */
  unsavedChanges?: boolean;
  saveLabel?: string;
  footerContent?: ReactNode;
}) {
  const [dragged, setDragged] = useState<{ rangeId: string; edge: Edge } | null>(null);
  const [magnifier, setMagnifier] = useState<{ x: number; time: number; edge: Edge } | null>(null);
  const [railWidth, setRailWidth] = useState(0);
  const [hovered, setHovered] = useState<ActiveHandle | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const cached = useCachedAudioBySourceId(source.audioCacheKey ? source.id : null);
  const sidecar = useSourceWaveform(source.id);
  const waveform = cached?.peaks ?? sidecar ?? source.waveform;
  const analysisMeta = resolvedSourceAnalysis(source, cached);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewScopeRef = useRef<PreviewScope | null>(null);
  const previewSessionRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const progressRaf = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const rangesRef = useRef(ranges);
  const onRangesChangeRef = useRef(onRangesChange);
  const canPlaySource = Boolean(resolveSourceAudioUrl(source));

  useEffect(() => { rangesRef.current = ranges; }, [ranges]);
  useEffect(() => { onRangesChangeRef.current = onRangesChange; }, [onRangesChange]);

  // Where the handles sit, and which range the pointer is asking about, are both pixel
  // questions, so the rail has to be measured.
  useEffect(() => {
    const rail = rulerRef.current;
    if (!rail) return undefined;
    setRailWidth(rail.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => setRailWidth(entries[0].contentRect.width));
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  const stopPreview = useCallback(() => {
    previewSessionRef.current += 1;
    pendingSeekRef.current = null;
    cancelAnimationFrame(progressRaf.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    previewScopeRef.current = null;
    setPreviewingId(null);
    setPreviewProgress(null);
  }, []);

  const preview = useCallback((fragment: Fragment, startRatio = 0) => {
    const scope = buildFragmentPreviewScope(fragment, source);
    if (!scope) return;
    if (startRatio === 0 && previewingId === fragment.id && audioRef.current) {
      stopPreview();
      return;
    }
    if (previewingId === fragment.id && audioRef.current && startRatio > 0) {
      applyPreviewTime(audioRef.current, scope, startRatio);
      setPreviewProgress(startRatio);
      if (audioRef.current.paused) {
        playMediaElement(audioRef.current, () => stopPreview());
      }
      return;
    }

    stopPreview();
    const sessionId = previewSessionRef.current;
    const audio = new Audio(resolveAudioUrl(scope.url));
    audio.loop = !scope.clip;
    audio.volume = 0.72;
    audioRef.current = audio;
    previewScopeRef.current = scope;
    setPreviewingId(fragment.id);
    pendingSeekRef.current = startRatio > 0 ? startRatio : null;

    const syncPosition = () => {
      if (previewSessionRef.current !== sessionId || audioRef.current !== audio) return;
      const ratio = pendingSeekRef.current ?? startRatio;
      if (applyPreviewTime(audio, scope, ratio)) {
        setPreviewProgress(ratio);
        pendingSeekRef.current = null;
      }
    };

    if (audio.readyState >= 1) syncPosition();
    else {
      audio.addEventListener("loadedmetadata", syncPosition, { once: true });
      audio.addEventListener("canplay", syncPosition, { once: true });
    }

    playMediaElement(audio, () => stopPreview());
  }, [previewingId, source, stopPreview]);

  const seekPreview = useCallback((fragment: Fragment, ratio: number) => {
    const audio = audioRef.current;
    const scope = previewScopeRef.current;
    if (!audio || !scope || previewingId !== fragment.id) return;
    const clamped = Math.min(1, Math.max(0, ratio));
    if (applyPreviewTime(audio, scope, clamped)) {
      setPreviewProgress(clamped);
      pendingSeekRef.current = null;
      return;
    }
    pendingSeekRef.current = clamped;
    setPreviewProgress(clamped);
  }, [previewingId]);

  useEffect(() => {
    if (!previewingId) return undefined;

    const tick = () => {
      const audio = audioRef.current;
      const scope = previewScopeRef.current;
      if (audio && scope && !audio.paused && Number.isFinite(audio.duration) && audio.duration > 0) {
        if (scope.clip && audio.currentTime >= scope.clip.end - 0.02) {
          audio.pause();
          setPreviewProgress(1);
          return;
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

  const beginRangeDrag = (event: ReactPointerEvent<HTMLElement>, range: EditableRange, edge: Edge) => {
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
    () => ranges.map((range, index) => {
      const persisted = fragmentFor(range);
      if (persisted) {
        return { ...persisted, start: range.start, end: range.end };
      }
      return draftFragmentForRange(range, index, source, waveform, analysisMeta?.bpm);
    }),
    [ranges, fragments, source, waveform, analysisMeta?.bpm],
  );

  const boundaryHandles = useMemo(
    () => ranges.flatMap((range, index) => boundaryHandlesFor(range, index, source.duration, railWidth)),
    [ranges, source.duration, railWidth],
  );

  const focusedRangeId = ranges.find((range) => range.fragmentId === focusedFragmentId)?.id ?? null;
  // A drag outranks the pointer, so the chip stays on the boundary being moved even as the
  // pointer runs past other slices.
  const active: ActiveHandle | null = dragged ? { rangeId: dragged.rangeId, edge: dragged.edge } : hovered;
  const revealedRangeId = active?.rangeId ?? focusedRangeId;

  /** The rail and the waveform are one surface: the boundary in reach depends on x alone, so it
   *  makes no difference whether the pointer is over the audio or over the chip above it. */
  const handleAt = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return activeHandleAt(rangesRef.current, event.clientX - rect.left, rect.width, source.duration);
  };

  const trackHover = (event: ReactPointerEvent<HTMLDivElement>) => {
    const next = handleAt(event);
    setHovered((current) => (current?.rangeId === next?.rangeId && current?.edge === next?.edge ? current : next));
  };

  const grabHandle = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const next = handleAt(event);
    if (!next?.edge) return;
    const range = rangesRef.current.find((item) => item.id === next.rangeId);
    if (range) beginRangeDrag(event, range, next.edge);
  };

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
          {SHOW_SENSITIVITY && <SensitivityKnob sensitivity={sensitivity} onSensitivityChange={onSensitivityChange} />}
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
        <div
          className={cn("boundary-hover-surface", active?.edge && "grabbing-edge")}
          onPointerMove={trackHover}
          onPointerLeave={() => setHovered(null)}
          onPointerDown={grabHandle}
        >
          <div className="boundary-rail" ref={rulerRef}>
            {boundaryHandles.map((handle) => {
              const { range, index, edge } = handle;
              const isActive = active?.rangeId === range.id && active.edge === edge;
              return (
                <div
                  className={cn("boundary-mark", isActive && "revealed")}
                  key={`${range.id}-${edge}`}
                  style={{ left: `${handle.ratio * 100}%`, "--fragment-color": range.color } as CSSProperties}
                >
                  <span className="boundary-tick" aria-hidden="true" />
                  <button
                    type="button"
                    className={cn("boundary-handle", dragged?.rangeId === range.id && dragged.edge === edge && "dragging")}
                    style={{ "--handle-shift": `${handle.shift}px` } as CSSProperties}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 1 : 0.25;
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        event.preventDefault();
                        changeEdge(range, edge, handle.time + (event.key === "ArrowLeft" ? -step : step));
                      }
                    }}
                    title={`F${index + 1} ${edge} · ${formatSeconds(handle.time)}`}
                    aria-label={`Adjust ${edge} of fragment ${index + 1}`}
                  >
                    {index + 1}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="continuous-wave-wrap">
            <ContinuousWaveform values={waveform} active={Boolean(previewingId)} />
            {ranges.map((range, index) => (
              <div
                className={cn(
                  "wave-range",
                  range.fragmentId === previewingId && "auditioning",
                  range.fragmentId === focusedFragmentId && "focused",
                  range.id === revealedRangeId && "revealed",
                  dragged?.rangeId === range.id && "adjusting",
                )}
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
        </div>
        <div className="fragment-summary">
          <strong>{ranges.length} fragments</strong>
          <span>Press near a cut and drag to trim it · Tab to a handle, then arrows · Shift for 1 second</span>
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("library-card-action fragment-save-all", unsavedChanges === false && "saved")}
                onClick={onSave}
                disabled={unsavedChanges === false}
                title={unsavedChanges ? "Unsaved changes" : undefined}
              >
                {unsavedChanges === false ? (
                  <><Check className="size-3" /> All fragments saved</>
                ) : (
                  <>{saveLabel}{unsavedChanges ? <em className="unsaved-mark">*</em> : null}</>
                )}
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
                    onDelete={onDeleteFragment ? () => onDeleteFragment(fragment.id) : undefined}
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
