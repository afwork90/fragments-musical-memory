import type { Fragment } from "../view/fragment";
import type { SourceFile } from "../view/source-file";

export type PreviewClip = {
  start: number;
  end: number;
};

export type PreviewScope = {
  id: string;
  url: string;
  clip?: PreviewClip;
};

export function resolveSourceAudioUrl(
  source: SourceFile,
  fragmentAudioFor?: (fragmentId: string) => string | undefined,
): string | null {
  if (source.audioUrl) return source.audioUrl;
  const firstId = source.fragmentIds[0];
  if (firstId && fragmentAudioFor) return fragmentAudioFor(firstId) ?? null;
  return null;
}

/**
 * Whether clip positions mean anything against this URL.
 *
 * A `/audio/` asset is one of the demo dataset's per-fragment files, so it *is* already
 * a slice: the demo source's `audioUrl` is its first fragment's file, and the fragment
 * offsets belong to a timeline that file does not have. Seeking a 20-second file to
 * 2:14 fails quietly and playback stays at 0, so every fragment of that source played
 * its first fragment from the top. An `imported` flag used to override this, which is
 * what put the staged demo source — the one with fragments to compare — on that path.
 */
function sourceSupportsSlicing(source: SourceFile | undefined, sourceUrl: string | null): boolean {
  if (!source || !sourceUrl || source.duration <= 0) return false;
  return !sourceUrl.startsWith("/audio/");
}

export function buildFragmentPreviewScope(
  fragment: Fragment,
  source: SourceFile | undefined,
  fragmentAudioFor?: (fragmentId: string) => string | undefined,
): PreviewScope | null {
  const sourceUrl = source ? resolveSourceAudioUrl(source, fragmentAudioFor) : null;
  const canSliceSource = sourceSupportsSlicing(source, sourceUrl);
  if (canSliceSource && source) {
    return {
      id: fragment.id,
      url: sourceUrl!,
      clip: { start: fragment.start, end: fragment.end },
    };
  }
  if (fragment.audio) {
    return { id: fragment.id, url: fragment.audio };
  }
  if (sourceUrl) {
    return { id: fragment.id, url: sourceUrl };
  }
  return null;
}

export function buildSourcePreviewScope(
  source: SourceFile,
  fragmentAudioFor?: (fragmentId: string) => string | undefined,
): PreviewScope | null {
  const url = resolveSourceAudioUrl(source, fragmentAudioFor);
  if (!url) return null;
  return { id: `source:${source.id}`, url };
}

export function clipDuration(scope: PreviewScope) {
  if (!scope.clip) return null;
  return Math.max(0, scope.clip.end - scope.clip.start);
}

export function progressForAudio(scope: PreviewScope, currentTime: number, totalDuration: number) {
  if (scope.clip) {
    const duration = clipDuration(scope);
    if (!duration) return 0;
    return Math.min(1, Math.max(0, (currentTime - scope.clip.start) / duration));
  }
  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return 0;
  return Math.min(1, Math.max(0, currentTime / totalDuration));
}

export function timeForProgress(scope: PreviewScope, ratio: number, totalDuration: number) {
  const clamped = Math.min(1, Math.max(0, ratio));
  if (scope.clip) {
    const duration = clipDuration(scope) ?? 0;
    return scope.clip.start + clamped * duration;
  }
  return clamped * totalDuration;
}

/** Seek the audio element for a preview scope; clip bounds do not require file duration. */
export function applyPreviewTime(audio: HTMLAudioElement, scope: PreviewScope, ratio: number) {
  const clamped = Math.min(1, Math.max(0, ratio));
  if (scope.clip && clipDuration(scope)) {
    audio.currentTime = timeForProgress(scope, clamped, audio.duration);
    return true;
  }
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    audio.currentTime = timeForProgress(scope, clamped, audio.duration);
    return true;
  }
  return false;
}
