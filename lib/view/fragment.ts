// A fragment as the UI renders it: a named, playable slice of a source.
//
// Note how much of this is display-shaped rather than disk-shaped — `duration` and
// `dateLabel` are formatted strings, and `key` is a human label like "Likely C
// minor" rather than a key plus a scale. `lib/domain/source-document.ts` holds the
// disk form; `fragments-app.tsx` converts between them.

import type { MusicalRole, SearchContext, SourceType } from "./vocabulary";

export type Fragment = {
  id: string;
  name: string;
  /** The source's display name, denormalized for rendering. */
  source: string;
  sourceId: string;
  /** Offsets in seconds within the source recording. */
  start: number;
  end: number;
  date: string;
  dateLabel: string;
  uploadedAt?: string;
  duration: string;
  key: string;
  alternateKeys: string[];
  /**
   * Unknown tempo is 0, not null, because the affinity scorer does arithmetic on
   * this. The UI renders 0 as "—". Worth revisiting once affinities are real.
   */
  bpm: number;
  role: MusicalRole;
  roles: MusicalRole[];
  brightness: number;
  waveform: number[];
  duplicateGroup?: string;
  audio: string;
  /** Pre-rendered stems per search context, when the host has them. */
  objects?: Partial<Record<SearchContext, string>>;
  sourceTypes: SourceType[];

  beats: number;
  bars: number;
  confidence: number;
  userTags: string[];
  /** Bumped whenever the user corrects the analysis, so caches can be busted. */
  analysisRevision: number;
};
