import {
  aliasCacheKey,
  getCachedAudio,
  hasCachedAudio,
  releaseCachedAudio,
  retainCachedAudio,
  setCachedAudio,
  subscribeAudioCache,
  updateCachedAnalysis,
} from "./audio-cache";
import type { AudioProcessOptions, ProcessedAudio } from "./types";
import { EMPTY_AUDIO_ANALYSIS } from "./types";
import { analyzeQuick, analyzeSignal } from "./essentia-analyze";

export const QUICK_ANALYSIS_SECONDS = 20;

const inflight = new Map<string, Promise<ProcessedAudio>>();
const quickInflight = new Map<string, Promise<ProcessedAudio>>();
const stagedQuickWindows = new Map<string, { signal: Float32Array; sampleRate: number }>();

function stageQuickWindow(cacheKey: string, buffer: AudioBuffer) {
  const mono = monoFromBuffer(buffer);
  stagedQuickWindows.set(cacheKey, {
    signal: loudestWindow(mono, buffer.sampleRate),
    sampleRate: buffer.sampleRate,
  });
}

function takeQuickWindow(cacheKey: string) {
  const staged = stagedQuickWindows.get(cacheKey);
  stagedQuickWindows.delete(cacheKey);
  return staged;
}

async function hashArrayBuffer(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function monoFromBuffer(buffer: AudioBuffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const mono = new Float32Array(left.length);

  for (let index = 0; index < left.length; index++) {
    mono[index] = (left[index] + right[index]) / 2;
  }

  return mono;
}

function peaksFromBuffer(buffer: AudioBuffer, count: number) {
  const channel = buffer.numberOfChannels === 1
    ? buffer.getChannelData(0)
    : monoFromBuffer(buffer);
  const blockSize = Math.max(1, Math.floor(channel.length / count));
  const peaks: number[] = [];

  for (let index = 0; index < count; index++) {
    const start = index * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    let max = 0;

    for (let sample = start; sample < end; sample++) {
      max = Math.max(max, Math.abs(channel[sample]));
    }

    peaks.push(Math.max(4, Math.round(max * 100)));
  }

  return peaks;
}

function signalForAnalysis(signal: Float32Array, sampleRate: number, maxSeconds = 90) {
  const maxSamples = Math.min(signal.length, Math.floor(sampleRate * maxSeconds));
  return signal.length === maxSamples ? signal : signal.subarray(0, maxSamples);
}

function loudestWindow(signal: Float32Array, sampleRate: number, windowSeconds = QUICK_ANALYSIS_SECONDS) {
  const windowSize = Math.min(signal.length, Math.floor(sampleRate * windowSeconds));
  if (signal.length <= windowSize) return signal;

  const hop = Math.floor(sampleRate * 5);
  let bestStart = 0;
  let bestEnergy = -1;

  for (let start = 0; start <= signal.length - windowSize; start += hop) {
    let energy = 0;
    for (let sample = start; sample < start + windowSize; sample += 2048) {
      energy += signal[sample] * signal[sample];
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = start;
    }
  }

  return signal.subarray(bestStart, bestStart + windowSize);
}

async function decodeMonoFromArrayBuffer(arrayBuffer: ArrayBuffer) {
  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return { mono: monoFromBuffer(buffer), sampleRate: buffer.sampleRate };
  } finally {
    await audioContext.close();
  }
}

function hasQuickMetadata(analysis: ProcessedAudio["analysis"]) {
  return analysis.bpm != null || analysis.key != null;
}

async function decodeAndAnalyze(
  arrayBuffer: ArrayBuffer,
  options: AudioProcessOptions,
): Promise<ProcessedAudio> {
  const cacheKey = options.cacheKey ?? await hashArrayBuffer(arrayBuffer);
  const cached = getCachedAudio(cacheKey);
  if (cached) {
    retainCachedAudio(cacheKey);
    return cached;
  }

  options.onProgress?.("decoding");

  const objectUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: options.format || "audio/wav" }));
  const audioContext = new AudioContext();
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  try {
    const buffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const peaks = peaksFromBuffer(buffer, options.peakCount ?? 512);
    stageQuickWindow(cacheKey, buffer);

    let analysis = EMPTY_AUDIO_ANALYSIS;
    if (options.analyze === "full") {
      options.onProgress?.("analyzing");
      try {
        const mono = signalForAnalysis(monoFromBuffer(buffer), buffer.sampleRate, 90);
        analysis = await analyzeSignal(mono, buffer.sampleRate, "full");
      } catch (error) {
        console.warn("Audio analysis failed; continuing with waveform only.", error);
      }
    }

    const processed: ProcessedAudio = {
      cacheKey,
      name: options.name,
      duration: buffer.duration,
      peaks,
      objectUrl,
      format: options.format || options.name.split(".").pop()?.toUpperCase() || "AUDIO",
      sampleRate: buffer.sampleRate,
      analysis,
    };

    setCachedAudio(processed);
    return getCachedAudio(cacheKey)!;
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  } finally {
    await audioContext.close();
  }
}

export async function processAudioBuffer(
  arrayBuffer: ArrayBuffer,
  options: AudioProcessOptions,
): Promise<ProcessedAudio> {
  const cacheKey = options.cacheKey ?? await hashArrayBuffer(arrayBuffer);
  if (hasCachedAudio(cacheKey)) {
    retainCachedAudio(cacheKey);
    return getCachedAudio(cacheKey)!;
  }

  const existing = inflight.get(cacheKey);
  if (existing) {
    const processed = await existing;
    retainCachedAudio(processed.cacheKey);
    return processed;
  }

  const promise = decodeAndAnalyze(arrayBuffer, { ...options, cacheKey }).finally(() => {
    inflight.delete(cacheKey);
  });
  inflight.set(cacheKey, promise);
  return promise;
}

export async function processAudioFile(file: File, options: Omit<AudioProcessOptions, "name" | "format"> = {}) {
  const arrayBuffer = await file.arrayBuffer();
  return processAudioBuffer(arrayBuffer, {
    ...options,
    name: file.name,
    format: file.type,
  });
}

export async function processAudioUrl(
  url: string,
  name: string,
  options: Omit<AudioProcessOptions, "name"> & { cacheAlias?: string } = {},
) {
  if (options.cacheAlias) {
    const cached = getCachedAudio(options.cacheAlias);
    if (cached) {
      retainCachedAudio(options.cacheAlias);
      return cached;
    }
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${name}`);
  const arrayBuffer = await response.arrayBuffer();
  const format = options.format ?? response.headers.get("content-type") ?? "audio/wav";
  const processed = await processAudioBuffer(arrayBuffer, { ...options, name, format });
  if (options.cacheAlias) aliasCacheKey(options.cacheAlias, processed.cacheKey);
  return processed;
}

async function decodeQuickWindowFromCached(cached: ProcessedAudio) {
  const response = await fetch(cached.objectUrl);
  const arrayBuffer = await response.arrayBuffer();
  const { mono, sampleRate } = await decodeMonoFromArrayBuffer(arrayBuffer);
  return { signal: loudestWindow(mono, sampleRate), sampleRate };
}

export async function quickAnalyzeCached(cacheKey: string): Promise<ProcessedAudio> {
  const cached = getCachedAudio(cacheKey);
  if (!cached) throw new Error("Audio not in cache");
  if (hasQuickMetadata(cached.analysis)) return cached;

  const existing = quickInflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const staged = takeQuickWindow(cacheKey) ?? await decodeQuickWindowFromCached(cached);
    const analysis = await analyzeQuick(staged.signal, staged.sampleRate);
    return updateCachedAnalysis(cacheKey, analysis) ?? cached;
  })().finally(() => {
    quickInflight.delete(cacheKey);
  });

  quickInflight.set(cacheKey, promise);
  return promise;
}

export async function quickAnalyzeFile(file: File, cacheKey: string): Promise<ProcessedAudio> {
  return quickAnalyzeCached(cacheKey);
}

export function bindSourceAudio(sourceId: string, cacheKey: string) {
  aliasCacheKey(`source:${sourceId}`, cacheKey);
}

export {
  aliasCacheKey,
  getCachedAudio,
  hasCachedAudio,
  releaseCachedAudio,
  retainCachedAudio,
  subscribeAudioCache,
  updateCachedAnalysis,
};

export type { ProcessedAudio, EssentiaAnalysis, SonogramData, AudioProcessPhase } from "./types";
