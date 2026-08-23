import {
  fragmentKeyLabels,
  matchesKeySelection,
  sourceKeyLabels,
} from "@/lib/audio/source-metadata";
import { LibraryFilters, matchesRangeFilter } from "../../library-filter-popover";
import { Fragment, SourceFile } from "../../prototype-data";
import { LibrarySort } from "./types";

export type LibraryLinkSummary = { total: number; manual: number };

export type LibraryListContext = {
  sourceNameFor: (fragment: Fragment) => string;
  sourceForId: (sourceId: string) => SourceFile | undefined;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  relatedTakeCountFor: (fragment: Fragment) => number;
};

const matchesNumericFilter = (actual: number, filter: { comparison: "gt" | "lt"; value: string }) =>
  filter.value.trim() === "" || (filter.comparison === "gt" ? actual > Number(filter.value) : actual < Number(filter.value));

function effectiveFragmentBpm(fragment: Fragment, source?: SourceFile) {
  if (fragment.bpm > 0) return fragment.bpm;
  return source?.bpm ?? 0;
}

export function matchesLibraryFilters(fragment: Fragment, filters: LibraryFilters, ctx: LibraryListContext) {
  const source = ctx.sourceForId(fragment.sourceId);
  const name = filters.name.trim().toLowerCase();
  const sourceName = filters.source.trim().toLowerCase();
  if (name && !fragment.name.toLowerCase().includes(name)) return false;
  if (sourceName && !ctx.sourceNameFor(fragment).toLowerCase().includes(sourceName)) return false;
  if (!matchesNumericFilter(fragment.brightness, filters.signal)) return false;
  if (filters.date.value) {
    const comparison = fragment.date.localeCompare(filters.date.value);
    if (filters.date.comparison === "after" ? comparison <= 0 : comparison >= 0) return false;
  }
  if (!matchesNumericFilter(fragment.start, filters.start) || !matchesNumericFilter(fragment.end, filters.end)) return false;
  if (!matchesRangeFilter(fragment.end - fragment.start, filters.duration)) return false;
  const barsOrBeats = filters.bars.metric === "bars" ? fragment.bars : fragment.beats;
  if (!matchesNumericFilter(barsOrBeats, filters.bars)) return false;
  if (!matchesKeySelection(fragmentKeyLabels(fragment, source), filters.key)) return false;
  if (!matchesRangeFilter(effectiveFragmentBpm(fragment, source), filters.tempo)) return false;
  if (!matchesNumericFilter(fragment.confidence * 100, filters.confidence)) return false;
  if (filters.tags.length && !fragment.userTags.some((tag) => filters.tags.includes(tag))) return false;
  if (filters.role.length && !filters.role.includes(fragment.role)) return false;
  if (!matchesRangeFilter(ctx.linkSummaryFor(fragment.id).total, filters.links)) return false;
  const relatedTakes = ctx.relatedTakeCountFor(fragment);
  const takeCount = relatedTakes > 0 ? relatedTakes + 1 : 0;
  return matchesNumericFilter(takeCount, filters.takes);
}

export function matchesSourceFilters(source: SourceFile, filters: LibraryFilters, ctx: LibraryListContext) {
  // Source cards don't carry fragment tags/roles — hide them when those filters are active.
  if (filters.tags.length || filters.role.length) return false;
  if (!matchesKeySelection(sourceKeyLabels(source), filters.key)) return false;
  if (!matchesRangeFilter(source.bpm ?? 0, filters.tempo)) return false;
  if (!matchesRangeFilter(source.duration, filters.duration)) return false;
  const links = source.fragmentIds.reduce((sum, id) => sum + ctx.linkSummaryFor(id).total, 0);
  if (!matchesRangeFilter(links, filters.links)) return false;
  return true;
}

export function filterLibraryFragments(fragments: Fragment[], query: string, filters: LibraryFilters, ctx: LibraryListContext) {
  const normalized = query.trim().toLowerCase();
  return fragments.filter((fragment) => {
    if (normalized && !`${fragment.name} ${ctx.sourceNameFor(fragment)} ${fragment.key} ${fragment.roles.join(" ")} ${fragment.userTags.join(" ")}`.toLowerCase().includes(normalized)) return false;
    return matchesLibraryFilters(fragment, filters, ctx);
  });
}

export function sortLibraryFragments(fragments: Fragment[], sort: LibrarySort, ctx: LibraryListContext) {
  return [...fragments].sort((a, b) => {
    let comparison = 0;
    if (sort.column === "name") comparison = a.name.localeCompare(b.name);
    if (sort.column === "source") comparison = ctx.sourceNameFor(a).localeCompare(ctx.sourceNameFor(b));
    if (sort.column === "signal") comparison = a.brightness - b.brightness;
    if (sort.column === "date") comparison = a.date.localeCompare(b.date);
    if (sort.column === "start") comparison = a.start - b.start;
    if (sort.column === "end") comparison = a.end - b.end;
    if (sort.column === "duration") comparison = (a.end - a.start) - (b.end - b.start);
    if (sort.column === "bars") comparison = a.bars - b.bars || a.beats - b.beats;
    if (sort.column === "key") comparison = a.key.localeCompare(b.key);
    if (sort.column === "tempo") comparison = a.bpm - b.bpm;
    if (sort.column === "confidence") comparison = a.confidence - b.confidence;
    if (sort.column === "tags") comparison = a.userTags.join(" ").localeCompare(b.userTags.join(" "));
    if (sort.column === "role") comparison = a.role.localeCompare(b.role);
    if (sort.column === "links") comparison = ctx.linkSummaryFor(a.id).total - ctx.linkSummaryFor(b.id).total;
    if (sort.column === "takes") comparison = ctx.relatedTakeCountFor(a) - ctx.relatedTakeCountFor(b);
    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function visibleLibraryFragments(fragments: Fragment[], query: string, filters: LibraryFilters, sort: LibrarySort, ctx: LibraryListContext) {
  return sortLibraryFragments(filterLibraryFragments(fragments, query, filters, ctx), sort, ctx);
}
