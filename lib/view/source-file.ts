// A source recording as the UI renders it.

import type { MeasuredSummary } from "./analysis";
import type { SourceType } from "./vocabulary";

export type SourceFile = {
  id: string;
  name: string;
  date: string;
  duration: number;
  format: string;
  device: string;
  fragmentIds: string[];
  waveform: number[];
  sensitivity: number;
  start: number;
  end: number;
  sourceTypes: SourceType[];
  /** True once the source has been copied into the managed library. */
  imported?: boolean;
  audioUrl?: string;
  audioCacheKey?: string;
  /** Null means not measured. Never substitute a plausible value. */
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  uploadedAt?: string;
  /** What analysis measured for the whole recording. Absent if never measured. */
  measured?: MeasuredSummary;
};
