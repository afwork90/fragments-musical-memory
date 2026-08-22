import { SourceColumnDef, SourceSort, SourceSortColumn } from "./types";

export const SOURCE_COLUMNS: SourceColumnDef[] = [
  { id: "name", label: "Source" },
  { id: "signal", label: "Signal" },
  { id: "date", label: "Recorded" },
  { id: "duration", label: "Length" },
  // { id: "type", label: "Type" },
  // { id: "profile", label: "Profile" },
  // { id: "format", label: "Format" },
  { id: "tempoKey", label: "Tempo · Key" },
  { id: "fragments", label: "Fragments" },
  { id: "actions", label: "" },
];

const DESCENDING_DEFAULT_COLUMNS: SourceSortColumn[] = ["date", "signal", "duration", "fragments"];

export function toggleSourceSort(column: SourceSortColumn, current: SourceSort): SourceSort {
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
