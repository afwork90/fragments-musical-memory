// The renderer's side of the high-resolution waveform sidecar.
//
// Three places peaks can come from, best first:
//
//   decoded audio in the cache  exact, but the file has to be decoded first
//   the sidecar                 high resolution, one small fetch
//   the 512-point thumbnail     all `source.json` can afford to carry
//
// A source with no sidecar measures its own, once, by decoding its audio here. That
// is not a nicety: `scripts/analyze-library.mjs` reads WAV only, so an MP3's
// waveform can be measured by nothing but the browser, and playback goes through an
// `<audio>` element rather than Web Audio — so without this, nothing would ever
// decode an existing source and its card would be stuck on the thumbnail forever.
//
// No React here, so `audio-service` can reach it. The hook is in
// `use-source-waveform.ts`. Deliberately does not import `audio-service`: that
// module imports this one, and a decode for peaks needs none of its caching.

import { computePeaks, decodeWaveform, encodeWaveform, magnitudes, peaksForRange } from "../analysis/peaks";
import type { WaveformPeaks } from "../analysis/peaks";
import { getFragmentsBridge } from "../web/bridge";

/**
 * Module-level rather than per-component: several cards, the detail panel, and the
 * workbench ask for the same source at once, and a sidecar only changes on
 * re-import. A `null` entry records "asked, there is none", so a source without one
 * is not measured again on every render.
 */
const loaded = new Map<string, number[] | null>();
const inflight = new Map<string, Promise<number[] | null>>();

/**
 * Decoding is serialised through this. A library where nothing has a sidecar yet
 * would otherwise open several `AudioContext`s and decode every file at once on
 * first paint.
 */
let decodeQueue: Promise<unknown> = Promise.resolve();

/** Expands a whole waveform to display magnitudes at its full stored resolution. */
function toMagnitudes(waveform: WaveformPeaks): number[] {
  const points = waveform.pairs.length / 2;
  return magnitudes(peaksForRange(waveform, 0, points / waveform.peaksPerSecond, points));
}

export function cachedSourceWaveform(sourceId: string): number[] | null {
  return loaded.get(sourceId) ?? null;
}

export function hasCheckedSourceWaveform(sourceId: string): boolean {
  return loaded.has(sourceId);
}

async function readSidecar(sourceId: string): Promise<WaveformPeaks | null> {
  const bytes = await getFragmentsBridge()?.readWaveform(sourceId);
  return bytes ? decodeWaveform(new Uint8Array(bytes)) : null;
}

async function writeSidecar(sourceId: string, waveform: WaveformPeaks) {
  const bridge = getFragmentsBridge();
  if (!bridge?.capabilities.persist) return;
  try {
    await bridge.writeWaveform(sourceId, encodeWaveform(waveform).buffer as ArrayBuffer);
  } catch (error) {
    // Cosmetic only: this session already has the measurement in memory, so a
    // failed write costs the next session its instant first paint and nothing more.
    console.warn(`Could not write the waveform for ${sourceId}.`, error);
  }
}

/** Resolves the URL of a source's managed audio through whichever host is present. */
async function audioUrlFor(sourceId: string): Promise<string | null> {
  const sources = await getFragmentsBridge()?.listSources();
  return sources?.find((source) => source.id === sourceId)?.audioUrl || null;
}

/**
 * Decodes a source's audio purely to measure its waveform.
 *
 * `decodeAudioData` is the only decoder in the stack that handles every format the
 * app accepts, which is the whole reason this exists rather than leaving generation
 * to the Node batch pass.
 */
async function measureFromAudio(sourceId: string): Promise<WaveformPeaks | null> {
  const url = await audioUrlFor(sourceId);
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`audio request failed with ${response.status}`);
  const bytes = await response.arrayBuffer();

  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    let mono = buffer.getChannelData(0);
    if (buffer.numberOfChannels > 1) {
      const mixed = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let sample = 0; sample < data.length; sample++) mixed[sample] += data[sample];
      }
      for (let sample = 0; sample < mixed.length; sample++) mixed[sample] /= buffer.numberOfChannels;
      mono = mixed;
    }
    return computePeaks(mono, buffer.sampleRate);
  } finally {
    await context.close();
  }
}

export function loadSourceWaveform(sourceId: string): Promise<number[] | null> {
  const existing = inflight.get(sourceId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const stored = await readSidecar(sourceId);
      if (stored) return toMagnitudes(stored);

      // No sidecar: measure one and keep it, so this cost is paid once per source
      // rather than on every launch.
      const measured = await (decodeQueue = decodeQueue.then(
        () => measureFromAudio(sourceId),
        () => measureFromAudio(sourceId),
      )) as WaveformPeaks | null;
      if (!measured) return null;

      await writeSidecar(sourceId, measured);
      return toMagnitudes(measured);
    } catch (error) {
      // The thumbnail still renders, so this is not worth failing a render over —
      // but it should not be silent either.
      console.warn(`Could not resolve the waveform for ${sourceId}.`, error);
      return null;
    }
  })().then((result) => {
    loaded.set(sourceId, result);
    return result;
  }).finally(() => {
    inflight.delete(sourceId);
  });

  inflight.set(sourceId, promise);
  return promise;
}

/**
 * Records a waveform for a source that has none, from audio already decoded.
 *
 * Import goes through here, where the buffer is in hand anyway, so a fresh import
 * never pays for the decode in `measureFromAudio`.
 */
export async function backfillSourceWaveform(sourceId: string, waveform: WaveformPeaks) {
  if (loaded.get(sourceId)) return;
  try {
    if (await readSidecar(sourceId)) return;
    await writeSidecar(sourceId, waveform);
    loaded.set(sourceId, toMagnitudes(waveform));
  } catch (error) {
    console.warn(`Could not store the waveform for ${sourceId}.`, error);
  }
}
