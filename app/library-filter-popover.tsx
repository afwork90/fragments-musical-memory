"use client";

import type { MusicalRole } from "@/lib/view/vocabulary";

export type LibraryColumnId =
  | "name"
  | "source"
  | "signal"
  | "date"
  | "uploaded"
  | "start"
  | "end"
  | "duration"
  | "bars"
  | "key"
  | "tempo"
  | "confidence"
  | "tags"
  | "role"
  | "links"
  | "takes"
  | "brightness"
  | "dynamics"
  | "intensity";

export type NumericFilter = { comparison: "gt" | "lt"; value: string };
export type DateFilter = { comparison: "after" | "before"; value: string };
export type BarsFilter = NumericFilter & { metric: "bars" | "beats" };
export type RangeFilter = { min: string; max: string };

export interface LibraryFilters {
  name: string;
  source: string;
  signal: NumericFilter;
  date: DateFilter;
  start: NumericFilter;
  end: NumericFilter;
  duration: RangeFilter;
  bars: BarsFilter;
  key: string[];
  tempo: RangeFilter;
  confidence: NumericFilter;
  tags: string[];
  role: MusicalRole[];
  links: RangeFilter;
  takes: NumericFilter;
  /** Spectral centroid in Hz. */
  brightness: RangeFilter;
  /** Dynamic complexity in dB. */
  dynamics: RangeFilter;
  /** Intensity readings, held as the labels they are shown as. */
  intensity: string[];
}

export const emptyRangeFilter = (): RangeFilter => ({ min: "", max: "" });

export const createLibraryFilters = (): LibraryFilters => ({
  name: "",
  source: "",
  signal: { comparison: "gt", value: "" },
  date: { comparison: "after", value: "" },
  start: { comparison: "gt", value: "" },
  end: { comparison: "gt", value: "" },
  duration: emptyRangeFilter(),
  bars: { comparison: "gt", value: "", metric: "bars" },
  key: [],
  tempo: emptyRangeFilter(),
  confidence: { comparison: "gt", value: "" },
  tags: [],
  role: [],
  links: emptyRangeFilter(),
  takes: { comparison: "gt", value: "" },
  brightness: emptyRangeFilter(),
  dynamics: emptyRangeFilter(),
  intensity: [],
});

const rangeIsActive = (filter: RangeFilter) =>
  filter.min.trim().length > 0 || filter.max.trim().length > 0;

export const libraryFilterIsActive = (filters: LibraryFilters, column: LibraryColumnId) => {
  // "Uploaded" is sort-only for now - it has no dedicated filter UI.
  if (column === "uploaded") return false;
  if (
    column === "duration"
    || column === "tempo"
    || column === "links"
    || column === "brightness"
    || column === "dynamics"
  ) {
    return rangeIsActive(filters[column]);
  }
  const filter = filters[column];
  if (typeof filter === "string") return filter.trim().length > 0;
  if (Array.isArray(filter)) return filter.length > 0;
  if (column === "date") return filter.value.trim().length > 0 && Number.isFinite(Date.parse(filter.value));
  return filter.value.trim().length > 0 && Number.isFinite(Number(filter.value));
};

export const activeLibraryFilterCount = (filters: LibraryFilters) =>
  ([
    "key",
    "tags",
    "role",
    "tempo",
    "duration",
    "links",
    "brightness",
    "dynamics",
    "intensity",
  ] as LibraryColumnId[])
    .filter((column) => libraryFilterIsActive(filters, column)).length;

/**
 * A range filter against a value that may never have been measured.
 *
 * An absent value fails an active filter rather than passing it: asking for
 * "brighter than 2 kHz" is a question about a measurement, and something with no
 * measurement is not an answer to it. Coercing the absence to a number is the
 * mistake `lib/affinity/` is built to avoid — a `?? 0` here would rank every
 * unanalysed recording as the darkest thing in the library and quietly show it
 * under every low-brightness filter.
 *
 * An empty filter is not a question, so everything passes.
 */
export function matchesMeasuredRange(
  actual: number | null | undefined,
  filter: RangeFilter,
) {
  if (!rangeIsActive(filter)) return true;
  if (typeof actual !== "number") return false;
  return matchesRangeFilter(actual, filter);
}

export function matchesRangeFilter(actual: number, filter: RangeFilter) {
  const minRaw = filter.min.trim();
  const maxRaw = filter.max.trim();
  const min = minRaw === "" ? null : Number(minRaw);
  const max = maxRaw === "" ? null : Number(maxRaw);
  if (min != null && Number.isFinite(min) && actual < min) return false;
  if (max != null && Number.isFinite(max) && actual > max) return false;
  return true;
}
