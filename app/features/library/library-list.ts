import { LibraryFilters } from "../../library-filter-popover";
import { Fragment } from "../../prototype-data";
import { LibrarySort } from "./types";

export type LibraryLinkSummary = { total: number; manual: number };

export type LibraryListContext = {
  sourceNameFor: (fragment: Fragment) => string;
  linkSummaryFor: (fragmentId: string) => LibraryLinkSummary;
  relatedTakeCountFor: (fragment: Fragment) => number;
};

const matchesNumericFilter = (actual: number, filter: { comparison: "gt" | "lt"; value: string }) =>
  filter.value.trim() === "" || (filter.comparison === "gt" ? actual > Number(filter.value) : actual < Number(filter.value));

export function matchesLibraryFilters(fragment: Fragment, filters: LibraryFilters, ctx: LibraryListContext) {
  const name = filters.name.trim().toLowerCase();
  const source = filters.source.trim().toLowerCase();
  if (name && !fragment.name.toLowerCase().includes(name)) return false;
  if (source && !ctx.sourceNameFor(fragment).toLowerCase().includes(source)) return false;
  if (!matchesNumericFilter(fragment.brightness, filters.signal)) return false;
  if (filters.date.value) {
    const comparison = fragment.date.localeCompare(filters.date.value);
    if (filters.date.comparison === "after" ? comparison <= 0 : comparison >= 0) return false;
  }
  if (!matchesNumericFilter(fragment.start, filters.start) || !matchesNumericFilter(fragment.end, filters.end) || !matchesNumericFilter(fragment.end - fragment.start, filters.duration)) return false;
  const barsOrBeats = filters.bars.metric === "bars" ? fragment.bars : fragment.beats;
  if (!matchesNumericFilter(barsOrBeats, filters.bars)) return false;
  if (filters.key.length && ![fragment.key, ...fragment.alternateKeys].some((key) => filters.key.includes(key))) return false;
  if (!matchesNumericFilter(fragment.bpm, filters.tempo) || !matchesNumericFilter(fragment.confidence * 100, filters.confidence)) return false;
  if (filters.tags.length && !fragment.userTags.some((tag) => filters.tags.includes(tag))) return false;
  if (filters.role.length && !filters.role.includes(fragment.role)) return false;
  if (!matchesNumericFilter(ctx.linkSummaryFor(fragment.id).total, filters.links)) return false;
  const relatedTakes = ctx.relatedTakeCountFor(fragment);
  const takeCount = relatedTakes > 0 ? relatedTakes + 1 : 0;
  return matchesNumericFilter(takeCount, filters.takes);
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
