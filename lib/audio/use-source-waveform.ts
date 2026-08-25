// React access to the waveform sidecar. The cache and the I/O live in
// `waveform-sidecar.ts`, which `audio-service` also uses.

import { useEffect, useState } from "react";

import {
  cachedSourceWaveform,
  hasCheckedSourceWaveform,
  loadSourceWaveform,
} from "./waveform-sidecar";

/**
 * The source's high-resolution peaks, or `null` while loading or when it has none.
 *
 * Returns whole-source peaks at `PEAKS_PER_SECOND`, the same shape and resolution
 * the audio cache exposes, so callers can treat the two interchangeably — including
 * slicing a fragment out of either.
 */
export function useSourceWaveform(sourceId: string | undefined): number[] | null {
  // The value is read from the module cache during render rather than mirrored into
  // component state, so a source another component already loaded is available on
  // the first render. State exists only to schedule a re-render once a fetch lands.
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (!sourceId || hasCheckedSourceWaveform(sourceId)) return;

    let active = true;
    loadSourceWaveform(sourceId).then(() => {
      if (active) setRevision((revision) => revision + 1);
    });

    return () => {
      active = false;
    };
  }, [sourceId]);

  return sourceId ? cachedSourceWaveform(sourceId) : null;
}
