import { formatMusicalKey, fragmentKeyLabels } from "@/lib/audio/source-metadata";
import { LibraryFilters } from "../../library-filter-popover";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";
import {
  LibraryLinkSummary,
  LibraryListContext,
  matchesLibraryFilters,
  matchesSourceFilters,
} from "./library-list";
import { LibrarySort } from "./types";

export type LibrarySourceItem = { kind: "source"; id: string; source: SourceFile };
export type LibraryFragmentItem = { kind: "fragment"; id: string; fragment: Fragment };
export type LibraryItem = LibrarySourceItem | LibraryFragmentItem;

export function libraryItemKey(item: LibraryItem) {
  return item.id;
}

export function buildLibraryItems(sources: SourceFile[], fragments: Fragment[]): LibraryItem[] {
  return [
    ...sources.map((source) => ({ kind: "source" as const, id: `source:${source.id}`, source })),
    ...fragments.map((fragment) => ({ kind: "fragment" as const, id: fragment.id, fragment })),
  ];
}

function matchesQuery(item: LibraryItem, query: string, ctx: LibraryListContext) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  if (item.kind === "source") {
    const keyLabel = formatMusicalKey(item.source.key, item.source.scale) ?? "";
    return `${item.source.name} ${keyLabel}`.toLowerCase().includes(normalized);
  }

  const fragment = item.fragment;
  const source = ctx.sourceForId(fragment.sourceId);
  const [keyLabel = ""] = fragmentKeyLabels(fragment, source);
  return `${fragment.name} ${ctx.sourceNameFor(fragment)} ${keyLabel} ${fragment.roles.join(" ")} ${fragment.userTags.join(" ")}`
    .toLowerCase()
    .includes(normalized);
}

function compareItems(a: LibraryItem, b: LibraryItem, sort: LibrarySort, ctx: LibraryListContext) {
  const direction = sort.direction === "asc" ? 1 : -1;

  const sourceLabel = (item: LibraryItem) => (item.kind === "source" ? "" : ctx.sourceNameFor(item.fragment));
  const name = (item: LibraryItem) => (item.kind === "source" ? item.source.name : item.fragment.name);
  const date = (item: LibraryItem) => (item.kind === "source" ? item.source.date : item.fragment.date);
  const uploaded = (item: LibraryItem) =>
    (item.kind === "source" ? item.source.uploadedAt ?? item.source.date : item.fragment.uploadedAt ?? item.fragment.date);
  const start = (item: LibraryItem) => (item.kind === "source" ? 0 : item.fragment.start);
  const end = (item: LibraryItem) => (item.kind === "source" ? item.source.duration : item.fragment.end);
  const duration = (item: LibraryItem) =>
    item.kind === "source" ? item.source.duration : item.fragment.end - item.fragment.start;
  const key = (item: LibraryItem) => {
    if (item.kind === "source") return formatMusicalKey(item.source.key, item.source.scale) ?? "";
    const [label = ""] = fragmentKeyLabels(item.fragment, ctx.sourceForId(item.fragment.sourceId));
    return label;
  };
  const tempo = (item: LibraryItem) => {
    if (item.kind === "source") return item.source.bpm ?? 0;
    const source = ctx.sourceForId(item.fragment.sourceId);
    return item.fragment.bpm > 0 ? item.fragment.bpm : source?.bpm ?? 0;
  };
  const signal = (item: LibraryItem) =>
    item.kind === "source" ? item.source.waveform[0] ?? 0 : item.fragment.brightness;
  const links = (item: LibraryItem) =>
    item.kind === "source"
      ? item.source.fragmentIds.reduce((sum, id) => sum + ctx.linkSummaryFor(id).total, 0)
      : ctx.linkSummaryFor(item.fragment.id).total;

  let comparison = 0;
  switch (sort.column) {
    case "name":
      comparison = name(a).localeCompare(name(b));
      break;
    case "source":
      comparison = sourceLabel(a).localeCompare(sourceLabel(b));
      break;
    case "signal":
      comparison = signal(a) - signal(b);
      break;
    case "date":
      comparison = date(a).localeCompare(date(b));
      break;
    case "uploaded":
      comparison = uploaded(a).localeCompare(uploaded(b));
      break;
    case "start":
      comparison = start(a) - start(b);
      break;
    case "end":
      comparison = end(a) - end(b);
      break;
    case "duration":
      comparison = duration(a) - duration(b);
      break;
    case "key":
      comparison = key(a).localeCompare(key(b));
      break;
    case "tempo":
      comparison = tempo(a) - tempo(b);
      break;
    case "links":
      comparison = links(a) - links(b);
      break;
    default:
      comparison = date(a).localeCompare(date(b));
  }

  if (comparison === 0) {
    comparison = a.kind === b.kind ? 0 : a.kind === "source" ? -1 : 1;
  }

  return comparison * direction;
}

export function visibleLibraryItems(
  sources: SourceFile[],
  fragments: Fragment[],
  query: string,
  filters: LibraryFilters,
  sort: LibrarySort,
  ctx: LibraryListContext,
) {
  const items = buildLibraryItems(sources, fragments).filter((item) => {
    if (!matchesQuery(item, query, ctx)) return false;
    if (item.kind === "source") return matchesSourceFilters(item.source, filters, ctx);
    return matchesLibraryFilters(item.fragment, filters, ctx);
  });

  return [...items].sort((a, b) => compareItems(a, b, sort, ctx));
}

export type { LibraryLinkSummary };
