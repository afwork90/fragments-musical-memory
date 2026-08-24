// A source recording as the UI renders it.

import type { SourceType } from "./vocabulary";

/** The settings that decide how a source gets sliced and analysed. */
export type AnalysisProfile = {
  name: string;
  sensitivity: number;
  expectedLength: string;
  detectors: string[];
  tempoStrategy: string;
  keyStrategy: string;
  confidenceThreshold: number;
};

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
  analysisProfile: AnalysisProfile;
  /** True once the source has been copied into the managed library. */
  imported?: boolean;
  audioUrl?: string;
  audioCacheKey?: string;
  /** Null means not measured. Never substitute a plausible value. */
  bpm?: number | null;
  key?: string | null;
  scale?: string | null;
  uploadedAt?: string;
};
