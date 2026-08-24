import type { MusicalRole } from "@/lib/view/vocabulary";
import { LibraryColumnDef, LibrarySort, LibrarySortColumn } from "./types";

export const LIBRARY_COLUMNS: LibraryColumnDef[] = [
  { id: "name", label: "Name" },
  { id: "source", label: "Source" },
  { id: "signal", label: "Signal" },
  { id: "date", label: "Recorded" },
  { id: "uploaded", label: "Uploaded" },
  { id: "start", label: "Start" },
  { id: "end", label: "End" },
  { id: "duration", label: "Length" },
  // { id: "bars", label: "Bars/Beats" },
  { id: "key", label: "Key" },
  { id: "tempo", label: "BPM" },
  // { id: "confidence", label: "Confidence" },
  // { id: "tags", label: "Tags" },
  // { id: "role", label: "Role" },
  { id: "links", label: "Affinities" },
  // { id: "takes", label: "Takes" },
];

export const LIBRARY_ROLES: ("All" | MusicalRole)[] = [
  "All",
  "Melody",
  "Rhythm",
  "Harmony",
  "Bass",
  "Voice",
  "Texture",
];

const DESCENDING_DEFAULT_COLUMNS: LibrarySortColumn[] = ["date", "uploaded", "signal", "tempo", "links", "takes"];

export function toggleLibrarySort(column: LibrarySortColumn, current: LibrarySort): LibrarySort {
  return {
    column,
    direction:
      current.column === column
        ? current.direction === "asc"
          ? "desc"
          : "asc"
        : DESCENDING_DEFAULT_COLUMNS.includes(column)
          ? "desc"
          : "asc",
  };
}
