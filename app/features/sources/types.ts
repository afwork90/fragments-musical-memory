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
  | "fragments"
  | "actions";

export type SourceSort = {
  column: SourceSortColumn;
  direction: SortDirection;
};

export type SourceColumnDef = {
  id: SourceSortColumn;
  label: string;
};
