export type SortDirection = "asc" | "desc";

export type SourceSortColumn =
  | "name"
  | "signal"
  | "date"
  | "duration"
  | "type"
  | "format"
  | "tempo"
  | "key"
  | "brightness"
  | "dynamics"
  | "intensity"
  | "chroma"
  | "fragments"
  | "actions";

export type SourceSort = {
  column: SourceSortColumn;
  direction: SortDirection;
};

export type SourceColumnDef = {
  id: SourceSortColumn;
  label: string;
  /** What the column means, for a header the abbreviated label cannot explain. */
  hint?: string;
};
