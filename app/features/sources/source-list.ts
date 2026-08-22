import { SourceFile } from "../../prototype-data";
import { SourceSort } from "./types";

export function filterSources(sources: SourceFile[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return sources;

  return sources.filter((source) =>
    `${source.name} ${source.date} ${source.format} ${source.bpm ?? ""} ${source.key ?? ""} ${source.scale ?? ""}`.toLowerCase().includes(normalized),
  );
}

export function sortSources(sources: SourceFile[], sort: SourceSort) {
  return [...sources].sort((a, b) => {
    let comparison = 0;

    if (sort.column === "name") comparison = a.name.localeCompare(b.name);
    if (sort.column === "signal") {
      comparison =
        a.waveform.reduce((sum, value) => sum + value, 0) -
        b.waveform.reduce((sum, value) => sum + value, 0);
    }
    if (sort.column === "date") comparison = Date.parse(a.date) - Date.parse(b.date);
    if (sort.column === "duration") comparison = a.duration - b.duration;
    if (sort.column === "type") comparison = a.sourceTypes.join(" ").localeCompare(b.sourceTypes.join(" "));
    if (sort.column === "profile") comparison = a.analysisProfile.name.localeCompare(b.analysisProfile.name);
    if (sort.column === "format") comparison = a.format.localeCompare(b.format);
    if (sort.column === "tempoKey") comparison = (a.bpm ?? 0) - (b.bpm ?? 0);
    if (sort.column === "fragments") comparison = a.fragmentIds.length - b.fragmentIds.length;

    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function visibleSources(sources: SourceFile[], query: string, sort: SourceSort) {
  return sortSources(filterSources(sources, query), sort);
}
