import type { EssentiaAnalysis, ProcessedAudio } from "./types";

type CacheEntry = ProcessedAudio & {
  refCount: number;
};

const entries = new Map<string, CacheEntry>();
const aliases = new Map<string, string>();
const listeners = new Set<(cacheKey: string) => void>();

export function subscribeAudioCache(listener: (cacheKey: string) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(cacheKey: string) {
  for (const listener of listeners) listener(cacheKey);
}

export function resolveCacheKey(keyOrAlias: string) {
  return aliases.get(keyOrAlias) ?? keyOrAlias;
}

export function aliasCacheKey(alias: string, cacheKey: string) {
  aliases.set(alias, cacheKey);
}

export function getCachedAudio(keyOrAlias: string | undefined | null): ProcessedAudio | undefined {
  if (!keyOrAlias) return undefined;
  const cacheKey = resolveCacheKey(keyOrAlias);
  const entry = entries.get(cacheKey);
  if (!entry) return undefined;

  const { refCount: _refCount, ...processed } = entry;
  return processed;
}

export function retainCachedAudio(keyOrAlias: string) {
  const cacheKey = resolveCacheKey(keyOrAlias);
  const entry = entries.get(cacheKey);
  if (!entry) return undefined;
  entry.refCount += 1;
  return getCachedAudio(cacheKey);
}

export function releaseCachedAudio(keyOrAlias: string) {
  const cacheKey = resolveCacheKey(keyOrAlias);
  const entry = entries.get(cacheKey);
  if (!entry) return;
  entry.refCount = Math.max(0, entry.refCount - 1);
}

export function setCachedAudio(entry: ProcessedAudio, initialRefCount = 1) {
  const existing = entries.get(entry.cacheKey);
  if (existing) {
    existing.refCount += initialRefCount;
    notify(entry.cacheKey);
    return existing;
  }

  entries.set(entry.cacheKey, { ...entry, refCount: initialRefCount });
  notify(entry.cacheKey);
  return entries.get(entry.cacheKey)!;
}

export function hasCachedAudio(keyOrAlias: string) {
  const cacheKey = resolveCacheKey(keyOrAlias);
  return entries.has(cacheKey);
}

export function updateCachedAnalysis(cacheKey: string, analysis: EssentiaAnalysis): ProcessedAudio | undefined {
  const entry = entries.get(cacheKey);
  if (!entry) return undefined;
  entry.analysis = analysis;
  notify(cacheKey);
  return getCachedAudio(cacheKey);
}
