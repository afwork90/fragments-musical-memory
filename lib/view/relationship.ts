// An affinity between two fragments, as the UI renders it.

import type { RelationshipOrigin, RelationshipStatus } from "./vocabulary";

/** What has to happen to one fragment for it to sit with the other. */
export type Transform = {
  pitch?: number;
  bpm?: number;
  timing?: "half-time" | "double-time";
  beatOffset?: number;
  repeat?: number;
  labels: string[];
  asset: string;
};

export type Relationship = {
  id: string;
  source: string;
  target: string;
  base: number;
  /**
   * Similarity per axis, 0 to 1, or `null` for "not measured" — which must render
   * differently from "scored zero".
   *
   * Mirrors `RelationshipMetrics` on disk, including the absence of a `melody`
   * axis: nothing extracts pitch contour, so it could only have held a fabricated
   * number. The axes that remain each come from a real measurement — `tempo` from
   * BPM once `bpmConfidence` clears the bar, `harmony` from chroma, `timbre` from
   * MFCC means, `brightness` from the spectral centroid, `rhythm` from onset
   * density, `pitch` from key and scale.
   */
  metrics: {
    rhythm: number | null;
    harmony: number | null;
    timbre: number | null;
    tempo: number | null;
    pitch: number | null;
    brightness: number | null;
    flatness: number | null;
    dynamics: number | null;
  };
  transformationCost: number;
  reason: string;
  transform?: Transform;
  experimental?: boolean;
  origin?: RelationshipOrigin;
  status?: RelationshipStatus;
};
