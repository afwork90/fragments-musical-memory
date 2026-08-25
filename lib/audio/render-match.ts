// Rendering a fragment as a file: sliced out of its source, and tempo- or
// pitch-matched to another fragment if asked.
//
// Renderer-only — `AudioContext`, `fetch`, `Blob` — and deliberately the only place
// audio is written. Two reasons it lives here rather than in the Node batch script:
//
//   `decodeAudioData` is the only decoder in the stack that reads every format the
//   app accepts, exactly as with the waveform sidecar; and
//
//   the transform being rendered is a UI decision, made against a candidate the
//   user is auditioning, so there is nothing to batch.
//
// Tempo matching for *playback* does not come through here at all: an `<audio>`
// element's `playbackRate` with `preservesPitch` gives that in realtime for free.
// This exists for the two things that need real audio — a pitch shift, which
// `playbackRate` cannot do, and a file to hand another application.
//
// Results are cached on disk under the source's `renders/`, keyed by a filename
// that spells out the slice and the transform, so dragging the same match twice
// renders once.

import { SimpleFilter, SoundTouch } from "soundtouchjs";
import type { SoundTouchSource } from "soundtouchjs";
import { encodeWav } from "../analysis/wav-encode";
import { isAudibleTransform, renderFileName } from "../affinity/transform";
import { getFragmentsBridge } from "../web/bridge";

export type MatchRenderRequest = {
  sourceId: string;
  fragmentId: string;
  /** The managed source audio. Whole file: a slice is taken after decoding. */
  audioUrl: string;
  /** Seconds within the source. */
  start: number;
  end: number;
  tempoRatio: number;
  semitones: number;
};

export type RenderedMatch = {
  /** A blob URL an `<audio>` element can play. */
  url: string;
  /** The name it is cached under, which is also what a drag hands the main process. */
  fileName: string;
  seconds: number;
  /** False when the audio was rendered but could not be kept — the web preview. */
  persisted: boolean;
};

/**
 * Extra audio taken from past the end of the slice, then trimmed off the output.
 *
 * Not about flushing — that is handled by feeding silence, below. This is so the
 * last analysis window has real audio on both sides of it, rather than blending the
 * fragment's final note into silence and fading it.
 */
const TAIL_SECONDS = 0.25;

/** Frames pulled from the filter per call. */
const EXTRACT_CHUNK = 8192;

/**
 * A stop for the extraction loop that does not depend on the filter reporting the
 * end. Generous: even a 90-second fragment stretched to half speed is under 500
 * calls.
 */
const MAX_EXTRACT_CALLS = 4096;

/** How many rendered blobs to keep alive at once. */
const BLOBS_KEPT = 8;

const rendered = new Map<string, RenderedMatch>();
const inflight = new Map<string, Promise<RenderedMatch | null>>();

/**
 * The last source decoded, kept whole.
 *
 * One entry, not a cache: the candidate is the only fragment ever rendered, and a
 * six-minute stereo recording is over a hundred megabytes of float. Holding one
 * makes nudging the tempo slider cheap; holding several would be careless.
 */
let decoded: { sourceId: string; channels: Float32Array[]; sampleRate: number } | null = null;

/** Serialised so a burst of requests cannot open an `AudioContext` each. */
let renderQueue: Promise<unknown> = Promise.resolve();

export function cachedMatchRender(fileName: string): RenderedMatch | null {
  return rendered.get(fileName) ?? null;
}

export function matchRenderName(request: MatchRenderRequest): string {
  return renderFileName(
    request.fragmentId,
    request.start,
    request.end,
    request.tempoRatio,
    request.semitones,
  );
}

/**
 * Resolves the rendered match, from memory, from disk, or by rendering it.
 *
 * `null` means it could not be produced — no bridge, unreachable audio, a decode
 * the browser refused. Callers fall back to the untransformed slice rather than
 * showing an error: the original is always playable.
 */
export function renderMatch(request: MatchRenderRequest): Promise<RenderedMatch | null> {
  const fileName = matchRenderName(request);

  const ready = rendered.get(fileName);
  if (ready) return Promise.resolve(ready);

  const existing = inflight.get(fileName);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const stored = await readRender(request.sourceId, fileName);
      if (stored) return keep(fileName, stored, true, request);

      const bytes = await (renderQueue = renderQueue.then(
        () => renderToWav(request),
        () => renderToWav(request),
      )) as Uint8Array | null;
      if (!bytes) return null;

      const persisted = await writeRender(request.sourceId, fileName, bytes);
      return keep(fileName, bytes, persisted, request);
    } catch (error) {
      console.warn(`Could not render ${fileName}.`, error);
      return null;
    }
  })().finally(() => {
    inflight.delete(fileName);
  });

  inflight.set(fileName, promise);
  return promise;
}

function keep(
  fileName: string,
  bytes: Uint8Array,
  persisted: boolean,
  request: MatchRenderRequest,
): RenderedMatch {
  const blob = new Blob([bytes as BlobPart], { type: "audio/wav" });
  const match: RenderedMatch = {
    url: URL.createObjectURL(blob),
    fileName,
    seconds: (request.end - request.start) / request.tempoRatio,
    persisted,
  };

  rendered.set(fileName, match);
  while (rendered.size > BLOBS_KEPT) {
    const oldest = rendered.keys().next();
    if (oldest.done) break;
    const evicted = rendered.get(oldest.value);
    if (evicted) URL.revokeObjectURL(evicted.url);
    rendered.delete(oldest.value);
  }

  return match;
}

async function readRender(sourceId: string, fileName: string): Promise<Uint8Array | null> {
  const bytes = await getFragmentsBridge()?.readRender(sourceId, fileName);
  return bytes ? new Uint8Array(bytes) : null;
}

async function writeRender(sourceId: string, fileName: string, bytes: Uint8Array): Promise<boolean> {
  const bridge = getFragmentsBridge();
  if (!bridge?.capabilities.persist) return false;
  try {
    await bridge.writeRender(sourceId, fileName, bytes.slice().buffer as ArrayBuffer);
    return true;
  } catch (error) {
    // The audio is already in hand, so this costs the next session a re-render and
    // nothing else.
    console.warn(`Could not store the render ${fileName}.`, error);
    return false;
  }
}

async function decodeSource(request: MatchRenderRequest) {
  if (decoded?.sourceId === request.sourceId) return decoded;

  const response = await fetch(request.audioUrl);
  if (!response.ok) throw new Error(`audio request failed with ${response.status}`);
  const bytes = await response.arrayBuffer();

  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    // Two channels at most: a DAW gets stereo, and SoundTouch works in stereo
    // regardless, so carrying a third channel through would only widen the buffers.
    const channels: Float32Array[] = [];
    for (let index = 0; index < Math.min(2, buffer.numberOfChannels); index++) {
      channels.push(buffer.getChannelData(index).slice());
    }
    decoded = { sourceId: request.sourceId, channels, sampleRate: buffer.sampleRate };
    return decoded;
  } finally {
    await context.close();
  }
}

async function renderToWav(request: MatchRenderRequest): Promise<Uint8Array | null> {
  const source = await decodeSource(request);
  const { sampleRate } = source;
  const available = source.channels[0]?.length ?? 0;
  if (!available) return null;

  const startFrame = Math.max(0, Math.min(available, Math.round(request.start * sampleRate)));
  const endFrame = Math.max(startFrame, Math.min(available, Math.round(request.end * sampleRate)));
  const sliceFrames = endFrame - startFrame;
  if (sliceFrames <= 0) return null;

  const tail = Math.min(Math.round(TAIL_SECONDS * sampleRate), available - endFrame);
  const fed = sliceFrames + tail;

  // An untransformed render is the slice itself, which is exactly what a fragment
  // drag needs — so it is worth having, and there is no reason to put it through
  // the stretcher to get it.
  const channels = isAudibleTransform(request.tempoRatio, request.semitones)
    ? stretch(source.channels, startFrame, fed, sliceFrames, request)
    : source.channels.map((channel) => channel.slice(startFrame, endFrame));

  return encodeWav(channels, sampleRate);
}

function stretch(
  input: Float32Array[],
  startFrame: number,
  fedFrames: number,
  sliceFrames: number,
  request: MatchRenderRequest,
): Float32Array[] {
  const left = input[0];
  const right = input[1] ?? input[0];

  // Our own source rather than the library's `WebAudioBufferSource`: that one reads
  // past the end of the channel without checking, which writes `undefined` into a
  // Float32Array — a NaN — and it takes an `AudioBuffer` we no longer hold.
  //
  // It always reports a full request, writing silence past the end of the slice.
  // SoundTouch only runs `process()` once its input buffer is full — 16384 frames —
  // and these bindings expose no flush, so a source that simply runs out leaves its
  // last three quarters of a second unprocessed. Measured: a two-second tone came
  // back at 26724 of 42000 frames until silence was fed to push it through.
  const feed: SoundTouchSource = {
    extract(target, numFrames, position) {
      for (let frame = 0; frame < numFrames; frame++) {
        const at = position + frame;
        const inSlice = at < fedFrames;
        target[frame * 2] = inSlice ? left[startFrame + at] : 0;
        target[frame * 2 + 1] = inSlice ? right[startFrame + at] : 0;
      }
      return numFrames;
    },
  };

  const soundtouch = new SoundTouch();
  soundtouch.tempo = request.tempoRatio;
  soundtouch.pitchSemitones = request.semitones;

  const filter = new SimpleFilter(feed, soundtouch);
  const wanted = Math.round(sliceFrames / request.tempoRatio);
  const outLeft = new Float32Array(wanted);
  const outRight = input.length > 1 ? new Float32Array(wanted) : null;
  const chunk = new Float32Array(EXTRACT_CHUNK * 2);

  let written = 0;
  for (let call = 0; written < wanted && call < MAX_EXTRACT_CALLS; call++) {
    const frames = filter.extract(chunk, EXTRACT_CHUNK);
    if (frames <= 0) break;
    const take = Math.min(frames, wanted - written);
    for (let frame = 0; frame < take; frame++) {
      outLeft[written + frame] = chunk[frame * 2];
      if (outRight) outRight[written + frame] = chunk[frame * 2 + 1];
    }
    written += take;
  }

  // Coming up short should not happen now that the pipeline is flushed, but the
  // buffers are zero-filled either way, so anything missing reads as silence rather
  // than as whatever was in memory.
  return outRight ? [outLeft, outRight] : [outLeft];
}
