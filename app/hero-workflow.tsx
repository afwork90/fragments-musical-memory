"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Repeat, Volume2, VolumeX } from "lucide-react";
import { playMediaElement } from "@/lib/audio/browser-audio";
import { resolveAudioUrl } from "@/lib/audio/resolve-audio-url";
import {
  PreviewScope,
  applyPreviewTime,
  buildFragmentPreviewScope,
  progressForAudio,
} from "@/lib/audio/source-playback";
import { LibraryCard } from "@/app/features/library/library-card";
import { LibraryLinkSummary } from "@/app/features/library/library-list";
import { Button } from "@/lib/ui/button";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/lib/ui/dialog";
import {
  Fragment,
  Relationship,
  RelationshipStatus,
  SourceFile,
} from "./prototype-data";

export type CombineCandidate = Relationship & { score: number; otherId: string };
type TransformDraft = {
  semitones: number;
  bpm: number;
  timing: "normal" | "half-time" | "double-time";
  beatOffset: number;
  repeat: number;
  transformed: boolean;
};
type PlayPhase = "" | "a" | "b" | "both";
type PlayMode = "A" | "B" | "A→B" | "B→A" | "Together";

const noopLinkSummary = (): LibraryLinkSummary => ({ total: 0, manual: 0 });
const CROSSFADE_GAIN = 0.85;

function playbackScopeForFragment(fragment: Fragment, source: SourceFile | undefined): PreviewScope | null {
  return buildFragmentPreviewScope(fragment, source);
}

function candidatePlaybackScope(
  candidate: Fragment,
  source: SourceFile | undefined,
  transformed: boolean,
  transformAsset?: string,
): PreviewScope | null {
  if (transformed && transformAsset) {
    return { id: candidate.id, url: transformAsset };
  }
  return playbackScopeForFragment(candidate, source);
}

function volumesForCrossfade(crossfade: number) {
  const t = Math.min(1, Math.max(0, crossfade / 100));
  return {
    a: (1 - t) * CROSSFADE_GAIN,
    b: t * CROSSFADE_GAIN,
  };
}

function TrackWaveActions({
  loop,
  mute,
  onLoopToggle,
  onMuteToggle,
}: {
  loop: boolean;
  mute: boolean;
  onLoopToggle: () => void;
  onMuteToggle: () => void;
}) {
  return (
    <div className="affinities-wave-actions">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("library-card-play size-9 shrink-0", loop && "text-[var(--card-action)]")}
        onClick={onLoopToggle}
        aria-label={loop ? "Disable loop" : "Enable loop"}
        aria-pressed={loop}
      >
        <Repeat className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("library-card-play size-9 shrink-0", mute && "text-[var(--card-action)]")}
        onClick={onMuteToggle}
        aria-label={mute ? "Unmute" : "Mute"}
        aria-pressed={mute}
      >
        {mute ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
    </div>
  );
}

export function ExportSheet({
  anchor,
  candidate,
  relationship,
  onClose,
  onSaved,
}: {
  anchor: Fragment;
  candidate: Fragment;
  relationship: CombineCandidate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const manifest = encodeURIComponent(
    JSON.stringify(
      {
        anchor: { id: anchor.id, sourceId: anchor.sourceId, start: anchor.start, end: anchor.end },
        candidate: { id: candidate.id, sourceId: candidate.sourceId, start: candidate.start, end: candidate.end },
        transform: relationship.transform?.labels ?? ["As recorded"],
        fit: relationship.score,
      },
      null,
      2,
    ),
  );
  const outputs = [
    {
      name: "Combined preview.wav",
      asset: relationship.transform?.asset ?? candidate.audio,
      meta: "A + transformed B",
    },
    { name: `${anchor.name}.wav`, asset: anchor.audio, meta: "Anchor · original" },
    {
      name: `${candidate.name} — transformed.wav`,
      asset: relationship.transform?.asset ?? candidate.audio,
      meta: relationship.transform?.labels.join(" · ") ?? "As recorded",
    },
  ];
  const drag = (event: DragEvent, asset: string, name: string) => {
    const url = new URL(asset, window.location.href).href;
    event.dataTransfer.setData("text/uri-list", url);
    event.dataTransfer.setData("DownloadURL", `audio/wav:${name}:${url}`);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <ModalTitlebar
            eyebrow="Export"
            title={<DialogTitle className="modal-titlebar-title">Affinity package</DialogTitle>}
          />
          <DialogDescription>
            Prepared files preserve the scripted transformation and source references. Drag into a DAW when supported, or export each file directly.
          </DialogDescription>
        </DialogHeader>
        <div className="export-files space-y-3">
          {outputs.map((output, index) => (
            <div
              className="export-tile grid gap-3 rounded-md border border-border/70 p-3"
              draggable
              onDragStart={(event) => drag(event, output.asset, output.name)}
              key={output.name}
            >
              <span className="file-icon text-xs font-semibold text-muted-foreground">WAV</span>
              <div>
                <b className="block text-sm">{output.name}</b>
                <small className="text-xs text-muted-foreground">{output.meta}</small>
                <em className="block text-xs text-muted-foreground not-italic">Drag into DAW</em>
              </div>
              <a className="text-sm text-primary underline" href={output.asset} download={output.name}>Export</a>
              {index === 0 && (
                <audio controls src={output.asset}>
                  <track kind="captions" src="/audio/instrumental.vtt" srcLang="en" label="Instrumental audio" />
                </audio>
              )}
            </div>
          ))}
          <div className="export-tile manifest grid gap-3 rounded-md border border-border/70 p-3">
            <span className="file-icon text-xs font-semibold text-muted-foreground">JSON</span>
            <div>
              <b className="block text-sm">transformation-recipe.json</b>
              <small className="text-xs text-muted-foreground">Source ranges, fit, and transformation manifest</small>
            </div>
            <a
              className="text-sm text-primary underline"
              href={`data:application/json;charset=utf-8,${manifest}`}
              download="transformation-recipe.json"
            >
              Export
            </a>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          <Button type="button" variant="lime" onClick={onSaved}>Save affinity & finish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function recommendationFor(relationship: CombineCandidate, fragment: Fragment): TransformDraft {
  return {
    semitones: relationship.transform?.pitch ?? 0,
    bpm: fragment.bpm + (relationship.transform?.bpm ?? 0),
    timing: relationship.transform?.timing ?? "normal",
    beatOffset: relationship.transform?.beatOffset ?? 0,
    repeat: relationship.transform?.repeat ?? 1,
    transformed: true,
  };
}

export function CombineWorkspace({
  anchor,
  candidates,
  fragments,
  sources,
  onClose,
  onAuditioned,
}: {
  anchor: Fragment;
  candidates: CombineCandidate[];
  fragments: Fragment[];
  sources: SourceFile[];
  statuses: Record<string, RelationshipStatus | undefined>;
  onClose: () => void;
  onEdit: (relationship: CombineCandidate) => void;
  onExport: (relationship: CombineCandidate) => void;
  onSave: (relationship: CombineCandidate) => void;
  onReject: (relationship: CombineCandidate) => void;
  onAuditioned: (relationship: CombineCandidate) => void;
}) {
  const [activeId, setActiveId] = useState(candidates[0]?.id ?? "");
  const relationship = candidates.find((item) => item.id === activeId) ?? candidates[0];
  const candidate = fragments.find((item) => item.id === relationship?.otherId);
  const recommendation = useMemo<TransformDraft>(
    () => (relationship && candidate ? recommendationFor(relationship, candidate) : { semitones: 0, bpm: 90, timing: "normal", beatOffset: 0, repeat: 1, transformed: true }),
    [relationship, candidate],
  );
  const [transform, setTransform] = useState<TransformDraft>(recommendation);
  const [playing, setPlaying] = useState<PlayMode | "">("");
  const [playPhase, setPlayPhase] = useState<PlayPhase>("");
  const [progress, setProgress] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [loop, setLoop] = useState({ a: false, b: false });
  const [mute, setMute] = useState({ a: false, b: false });
  const [crossfade, setCrossfade] = useState(50);
  const [transformOpen, setTransformOpen] = useState(false);
  const audios = useRef<HTMLAudioElement[]>([]);
  const scopesByAudio = useRef(new Map<HTMLAudioElement, PreviewScope>());
  const trackCleanups = useRef<Array<() => void>>([]);
  const timers = useRef<number[]>([]);
  const progressRaf = useRef(0);
  const volumes = volumesForCrossfade(crossfade);

  const stop = useCallback(() => {
    cancelAnimationFrame(progressRaf.current);
    trackCleanups.current.forEach((cleanup) => cleanup());
    trackCleanups.current = [];
    scopesByAudio.current.clear();
    audios.current.forEach((audio) => {
      audio.pause();
      audio.currentTime = 0;
    });
    audios.current = [];
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    setPlaying("");
    setPlayPhase("");
    setProgress({ a: null, b: null });
  }, []);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (!playPhase) return undefined;

    const tick = () => {
      setProgress(() => {
        const next: { a: number | null; b: number | null } = { a: null, b: null };
        audios.current.forEach((audio) => {
          const track = audio.dataset.track as "a" | "b" | undefined;
          const scope = scopesByAudio.current.get(audio);
          if (!track || audio.paused) return;
          if (scope) {
            next[track] = progressForAudio(scope, audio.currentTime, audio.duration);
            return;
          }
          if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
          next[track] = audio.currentTime / audio.duration;
        });
        return next;
      });
      progressRaf.current = requestAnimationFrame(tick);
    };

    progressRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(progressRaf.current);
  }, [playPhase]);

  useEffect(() => {
    const levels = volumesForCrossfade(crossfade);
    audios.current.forEach((audio) => {
      const track = audio.dataset.track as "a" | "b" | undefined;
      const scope = scopesByAudio.current.get(audio);
      if (!track) return;
      audio.loop = scope?.clip ? false : loop[track];
      audio.volume = mute[track] ? 0 : levels[track];
    });
  }, [crossfade, loop, mute]);

  const sourceForId = useCallback(
    (sourceId: string) => sources.find((source) => source.id === sourceId),
    [sources],
  );

  const prepareTrackAudio = (scope: PreviewScope | null, track: "a" | "b") => {
    if (!scope?.url) return null;
    const audio = new Audio(resolveAudioUrl(scope.url));
    audio.dataset.track = track;
    audio.volume = mute[track] ? 0 : volumes[track];
    audio.loop = scope.clip ? false : loop[track];
    scopesByAudio.current.set(audio, scope);
    audios.current.push(audio);

    const syncStart = () => {
      if (scope.clip) applyPreviewTime(audio, scope, 0);
    };
    if (audio.readyState >= 1) syncStart();
    else {
      audio.addEventListener("loadedmetadata", syncStart, { once: true });
      audio.addEventListener("canplay", syncStart, { once: true });
    }

    const onTimeUpdate = () => {
      if (!scope.clip || audio.paused) return;
      if (audio.currentTime >= scope.clip.end - 0.02) {
        if (loop[track]) {
          audio.currentTime = scope.clip.start;
        } else {
          audio.pause();
        }
      }
    };
    audio.addEventListener("timeupdate", onTimeUpdate);
    trackCleanups.current.push(() => audio.removeEventListener("timeupdate", onTimeUpdate));

    return audio;
  };

  const play = (mode: PlayMode) => {
    if (!relationship || !candidate) return;
    stop();
    setPlaying(mode);
    onAuditioned(relationship);

    const anchorScope = playbackScopeForFragment(anchor, sourceForId(anchor.sourceId));
    const candidateScope = candidatePlaybackScope(
      candidate,
      sourceForId(candidate.sourceId),
      transform.transformed,
      relationship.transform?.asset,
    );

    const a = prepareTrackAudio(anchorScope, "a");
    const b = prepareTrackAudio(candidateScope, "b");

    const safe = (audio: HTMLAudioElement, onFail?: () => void) => {
      playMediaElement(audio, () => {
        setPlaying("");
        setPlayPhase("");
        onFail?.();
      });
    };

    if (mode === "A") {
      if (!a) return;
      setPlayPhase("a");
      safe(a);
    }
    if (mode === "B") {
      if (!b) return;
      setPlayPhase("b");
      safe(b);
    }
    if (mode === "Together") {
      if (!a || !b) return;
      setPlayPhase("both");
      safe(a);
      safe(b);
    }
    if (mode === "A→B") {
      if (!a || !b) return;
      setPlayPhase("a");
      safe(a);
      timers.current.push(
        window.setTimeout(() => {
          a.pause();
          setPlayPhase("b");
          setProgress((current) => ({ ...current, a: null }));
          safe(b);
        }, 2600),
      );
    }
    if (mode === "B→A") {
      if (!a || !b) return;
      setPlayPhase("b");
      safe(b);
      timers.current.push(
        window.setTimeout(() => {
          b.pause();
          setPlayPhase("a");
          setProgress((current) => ({ ...current, b: null }));
          safe(a);
        }, 2600),
      );
    }
  };

  if (!relationship || !candidate) return null;

  const chooseCandidate = (id: string) => {
    if (id === relationship.id) return;
    stop();
    const next = candidates.find((item) => item.id === id);
    const nextFragment = fragments.find((item) => item.id === next?.otherId);
    if (next && nextFragment) setTransform(recommendationFor(next, nextFragment));
    setActiveId(id);
  };

  const toggleAdapt = () => {
    setTransformOpen((open) => !open);
  };

  const anchorPreviewing = playPhase === "a" || playPhase === "both";
  const candidatePreviewing = playPhase === "b" || playPhase === "both";
  const stubHandlers = {
    sourceNameFor: (fragment: Fragment) => sourceForId(fragment.sourceId)?.name ?? fragment.source,
    sourceForId,
    linkSummaryFor: noopLinkSummary,
    fragmentAudioFor: (fragmentId: string) => fragments.find((item) => item.id === fragmentId)?.audio,
    onSelect: () => {},
    onSeek: () => {},
    onOpenMatches: () => {},
    onOpenInfo: () => {},
  };

  return (
    <section className="combine-workspace affinities-workspace" aria-label="Affinities workspace">
      <ModalTitlebar
        eyebrow="Affinities"
        title={
          <h1 className="modal-titlebar-title">
            {anchor.name} <i>+</i> {candidate.name}
          </h1>
        }
        onClose={onClose}
        closeLabel="Close Affinities and return to library"
      />

      <div className={cn("combine-grid affinities-grid", transformOpen && "affinities-grid-transform-open")}>
        <div className="combine-stage affinities-stage">
          <div className="affinities-track affinities-track-anchor">
            <div className="affinities-track-index" aria-hidden="true">A</div>
            <div className="affinities-track-body">
              <LibraryCard
                item={{ kind: "fragment", id: anchor.id, fragment: anchor }}
                isSelected={false}
                isPreviewing={anchorPreviewing}
                previewProgress={anchorPreviewing ? progress.a : null}
                showActions={false}
                embedded
                {...stubHandlers}
                onPreview={() => (playing === "A" ? stop() : play("A"))}
                waveActions={(
                  <TrackWaveActions
                    loop={loop.a}
                    mute={mute.a}
                    onLoopToggle={() => setLoop((current) => ({ ...current, a: !current.a }))}
                    onMuteToggle={() => setMute((current) => ({ ...current, a: !current.a }))}
                  />
                )}
              />
            </div>
          </div>

          <div className="affinities-track affinities-track-candidate">
            <div className="affinities-track-index" aria-hidden="true">B</div>
            <div className="affinities-track-body">
              <LibraryCard
                item={{ kind: "fragment", id: candidate.id, fragment: candidate }}
                isSelected={false}
                isPreviewing={candidatePreviewing}
                previewProgress={candidatePreviewing ? progress.b : null}
                showActions={false}
                embedded
                {...stubHandlers}
                onPreview={() => (playing === "B" ? stop() : play("B"))}
                waveActions={(
                  <TrackWaveActions
                    loop={loop.b}
                    mute={mute.b}
                    onLoopToggle={() => setLoop((current) => ({ ...current, b: !current.b }))}
                    onMuteToggle={() => setMute((current) => ({ ...current, b: !current.b }))}
                  />
                )}
              />
              <div className="affinities-candidate-bar">
                <div className="candidate-stats">
                  <b>{relationship.score}% fit</b>
                  {relationship.transform?.labels.map((label) => <i key={label}>{label}</i>)}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn("library-card-action", transformOpen && "affinities-adapt-active")}
                  aria-pressed={transformOpen}
                  onClick={toggleAdapt}
                >
                  Adapt
                </Button>
              </div>
            </div>
          </div>

          <div className="affinities-crossfade">
            <span aria-hidden="true">A</span>
            <input
              type="range"
              min="0"
              max="100"
              value={crossfade}
              onChange={(event) => setCrossfade(Number(event.target.value))}
              aria-label="Crossfade between A and B"
            />
            <span aria-hidden="true">B</span>
          </div>

          <div className="playback-modes">
            {(["A", "B", "A→B", "B→A", "Together"] as const).map((mode) => (
              <button
                type="button"
                className={playing === mode ? "active" : ""}
                onClick={() => (playing === mode ? stop() : play(mode))}
                key={mode}
              >
                {playing === mode ? "Ⅱ " : "▶ "}
                {mode}
              </button>
            ))}
          </div>

          <div className="affinities-candidate-list" aria-label="Affinity candidates">
            <div className="affinities-candidate-list-head">
              <span className="eyebrow">Candidates</span>
              <small>{candidates.length} affinities</small>
            </div>
            <div className="library-card-stack">
              {candidates.map((item) => {
                const fragment = fragments.find((entry) => entry.id === item.otherId);
                if (!fragment) return null;
                const isActive = item.id === relationship.id;
                return (
                  <div key={item.id} className="affinities-candidate-item">
                    <LibraryCard
                      item={{ kind: "fragment", id: fragment.id, fragment }}
                      isSelected={isActive}
                      isPreviewing={false}
                      previewProgress={null}
                      showActions={false}
                      {...stubHandlers}
                      onSelect={() => chooseCandidate(item.id)}
                      onPreview={() => chooseCandidate(item.id)}
                    />
                    <div className="affinities-candidate-item-meta">
                      <b>{item.score}% fit</b>
                      {item.transform?.labels.map((label) => <i key={label}>{label}</i>)}
                      {isActive && <span className="affinities-candidate-active">B</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {transformOpen && (
        <aside className="transform-console">
          <div className="console-head">
            <div>
              <span className="eyebrow">Transformation</span>
              <h2>Candidate settings</h2>
            </div>
            <div className="console-head-actions">
              <button type="button" onClick={() => setTransform(recommendation)}>Reset to recommendation</button>
            </div>
          </div>
          <>
              <div className="ab-toggle">
                <button
                  type="button"
                  className={!transform.transformed ? "active" : ""}
                  onClick={() => setTransform((current) => ({ ...current, transformed: false }))}
                >
                  Original
                </button>
                <button
                  type="button"
                  className={transform.transformed ? "active" : ""}
                  onClick={() => setTransform((current) => ({ ...current, transformed: true }))}
                >
                  Transformed
                </button>
              </div>
              <label>
                <span>Pitch <small>semitones</small></span>
                <input
                  type="number"
                  min="-12"
                  max="12"
                  value={transform.semitones}
                  onChange={(event) => setTransform((current) => ({ ...current, semitones: Number(event.target.value) }))}
                />
              </label>
              <label>
                <span>Target BPM <small>time-stretch</small></span>
                <input
                  type="number"
                  min="40"
                  max="220"
                  value={transform.bpm}
                  onChange={(event) => setTransform((current) => ({ ...current, bpm: Number(event.target.value) }))}
                />
              </label>
              <label>
                <span>Time interpretation</span>
                <select
                  value={transform.timing}
                  onChange={(event) => setTransform((current) => ({ ...current, timing: event.target.value as TransformDraft["timing"] }))}
                >
                  <option value="normal">Normal</option>
                  <option value="half-time">Half-time</option>
                  <option value="double-time">Double-time</option>
                </select>
              </label>
              <label>
                <span>Beat offset</span>
                <input
                  type="number"
                  min="-8"
                  max="8"
                  value={transform.beatOffset}
                  onChange={(event) => setTransform((current) => ({ ...current, beatOffset: Number(event.target.value) }))}
                />
              </label>
              <label>
                <span>Repeat</span>
                <input
                  type="number"
                  min="1"
                  max="4"
                  value={transform.repeat}
                  onChange={(event) => setTransform((current) => ({ ...current, repeat: Number(event.target.value) }))}
                />
              </label>
              <div className="console-recommendation">
                <span>Recommended</span>
                <b>
                  {recommendation.semitones} st · {recommendation.bpm} BPM · {recommendation.beatOffset} beat · {recommendation.repeat}×
                </b>
              </div>
          </>
        </aside>
        )}
      </div>
    </section>
  );
}
