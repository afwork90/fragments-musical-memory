import type { SourceFile } from "@/lib/view/source-file";
import { SourceSort } from "./types";

export function filterSources(sources: SourceFile[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return sources;

  return sources.filter((source) =>
    `${source.name} ${source.date} ${source.format} ${source.bpm ?? ""} ${source.key ?? ""} ${source.scale ?? ""}`.toLowerCase().includes(normalized),
  );
}

function keyLabelOf(source: SourceFile) {
  return source.key && source.scale ? `${source.key} ${source.scale}` : null;
}

export function sortSources(sources: SourceFile[], sort: SourceSort) {
  return [...sources].sort((a, b) => {
    // Unmeasured values sort last in both directions. Treating them as 0 would
    // make an unanalysed source read as the slowest one in the library.
    if (sort.column === "tempo" || sort.column === "key") {
      const left = sort.column === "tempo" ? a.bpm ?? null : keyLabelOf(a);
      const right = sort.column === "tempo" ? b.bpm ?? null : keyLabelOf(b);
      if (left === null || right === null) {
        if (left === right) return 0;
        return left === null ? 1 : -1;
      }
      const ranked = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
      return sort.direction === "asc" ? ranked : -ranked;
    }

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
    if (sort.column === "format") comparison = a.format.localeCompare(b.format);
    if (sort.column === "fragments") comparison = a.fragmentIds.length - b.fragmentIds.length;

    return sort.direction === "asc" ? comparison : -comparison;
  });
}

export function visibleSources(sources: SourceFile[], query: string, sort: SourceSort) {
  return sortSources(filterSources(sources, query), sort);
}
