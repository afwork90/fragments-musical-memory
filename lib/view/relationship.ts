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
   * Every axis is required here because that is what the 791 relationships on
   * disk contain. It does not reflect what is measurable: in the current data
   * `rhythm` merely repeats `tempo`, `pitch` repeats `harmony`, and `timbre` and
   * `brightness` are the constant 0.70 for every row. Honest generation will
   * compute some axes and not others, so these must become individually optional
   * — with "absent" rendering differently from "scored zero".
   */
  metrics: {
    rhythm: number;
    harmony: number;
    melody: number;
    timbre: number;
    tempo: number;
    pitch: number;
    brightness: number;
  };
  transformationCost: number;
  reason: string;
  transform?: Transform;
  experimental?: boolean;
  origin?: RelationshipOrigin;
  status?: RelationshipStatus;
};
