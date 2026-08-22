"use client";

import { useEffect, useState } from "react";
import { getCachedAudio, subscribeAudioCache } from "./audio-service";
import type { ProcessedAudio } from "./types";

export function useCachedAudio(cacheKey: string | undefined | null): ProcessedAudio | undefined {
  const [audio, setAudio] = useState(() => getCachedAudio(cacheKey));

  useEffect(() => {
    setAudio(getCachedAudio(cacheKey));
    if (!cacheKey) return;

    return subscribeAudioCache((updatedKey) => {
      const resolved = getCachedAudio(cacheKey);
      if (resolved?.cacheKey === updatedKey || updatedKey === cacheKey) {
        setAudio(resolved);
      }
    });
  }, [cacheKey]);

  return audio;
}

export function useCachedAudioBySourceId(sourceId: string | undefined | null): ProcessedAudio | undefined {
  return useCachedAudio(sourceId ? `source:${sourceId}` : null);
}
