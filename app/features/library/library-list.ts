import { intensityLabel } from "@/lib/audio/measured-labels";
import {
  fragmentKeyLabels,
  matchesKeySelection,
  sourceKeyLabels,
} from "@/lib/audio/source-metadata";
import {
  LibraryFilters,
  matchesMeasuredRange,
  matchesRangeFilter,
} from "../../library-filter-popover";
import type { MeasuredSummary } from "@/lib/view/analysis";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";

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

/**
 * The measured characteristics, which fragments and whole recordings carry in the
 * same shape and so filter identically.
 *
 * Anything without a value for an active filter drops out. That is the filter
 * doing its job rather than losing work: the alternative is showing something as
 * matching "brighter than 2 kHz" when nothing ever measured how bright it is.
 */
function matchesMeasuredFilters(measured: MeasuredSummary | undefined, filters: LibraryFilters) {
  if (!matchesMeasuredRange(measured?.centroidHz, filters.brightness)) return false;
  if (!matchesMeasuredRange(measured?.dynamicComplexity, filters.dynamics)) return false;
  if (filters.intensity.length) {
    // An unmeasured intensity reads as "—", which is never one of the three
    // options, so this is where it drops out.
    if (!filters.intensity.includes(intensityLabel(measured?.intensity))) return false;
  }
  return true;
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
  if (!matchesMeasuredFilters(fragment.measured, filters)) return false;
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
  return matchesMeasuredFilters(source.measured, filters);
}

