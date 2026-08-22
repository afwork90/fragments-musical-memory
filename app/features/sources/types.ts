export type SortDirection = "asc" | "desc";

export type SourceSortColumn =
  | "name"
  | "signal"
  | "date"
  | "duration"
  | "type"
  | "profile"
  | "format"
  | "tempoKey"
  | "fragments";

export type SourceSort = {
  column: SourceSortColumn;
  direction: SortDirection;
};

export type SourceColumnDef = {
  id: SourceSortColumn;
  label: string;
};
