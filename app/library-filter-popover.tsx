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
  | "takes";

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
});

const rangeIsActive = (filter: RangeFilter) =>
  filter.min.trim().length > 0 || filter.max.trim().length > 0;

export const libraryFilterIsActive = (filters: LibraryFilters, column: LibraryColumnId) => {
  // "Uploaded" is sort-only for now - it has no dedicated filter UI.
  if (column === "uploaded") return false;
  if (column === "duration" || column === "tempo" || column === "links") {
    return rangeIsActive(filters[column]);
  }
  const filter = filters[column];
  if (typeof filter === "string") return filter.trim().length > 0;
  if (Array.isArray(filter)) return filter.length > 0;
  if (column === "date") return filter.value.trim().length > 0 && Number.isFinite(Date.parse(filter.value));
  return filter.value.trim().length > 0 && Number.isFinite(Number(filter.value));
};

export const activeLibraryFilterCount = (filters: LibraryFilters) =>
  (["key", "tags", "role", "tempo", "duration", "links"] as LibraryColumnId[])
    .filter((column) => libraryFilterIsActive(filters, column)).length;

export function matchesRangeFilter(actual: number, filter: RangeFilter) {
  const minRaw = filter.min.trim();
  const maxRaw = filter.max.trim();
  const min = minRaw === "" ? null : Number(minRaw);
  const max = maxRaw === "" ? null : Number(maxRaw);
  if (min != null && Number.isFinite(min) && actual < min) return false;
  if (max != null && Number.isFinite(max) && actual > max) return false;
  return true;
}
