import { MEASURED_HINTS } from "@/lib/audio/measured-labels";
import { SourceColumnDef, SourceSort, SourceSortColumn } from "./types";

export const SOURCE_COLUMNS: SourceColumnDef[] = [
  { id: "name", label: "Source" },
  { id: "signal", label: "Signal" },
  { id: "date", label: "Imported" },
  { id: "duration", label: "Length" },
  // { id: "type", label: "Type" },
  // { id: "format", label: "Format" },
  { id: "tempo", label: "Tempo" },
  { id: "key", label: "Key" },
  // The measured characteristics sit together, after the two that were already
  // here. Each header carries the same sentence the Info panel uses.
  { id: "brightness", label: "Bright", hint: MEASURED_HINTS.brightness },
  { id: "dynamics", label: "Dynamics", hint: MEASURED_HINTS.dynamics },
  { id: "intensity", label: "Intensity", hint: MEASURED_HINTS.intensity },
  { id: "chroma", label: "Chroma", hint: MEASURED_HINTS.chroma },
  { id: "fragments", label: "Fragments" },
  { id: "actions", label: "" },
];

const DESCENDING_DEFAULT_COLUMNS: SourceSortColumn[] = [
  "date",
  "signal",
  "duration",
  "fragments",
  "tempo",
  // Loudest, busiest and hardest-pushing first: for each of these the interesting
  // end of the range is the high one.
  "brightness",
  "dynamics",
  "intensity",
];

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
