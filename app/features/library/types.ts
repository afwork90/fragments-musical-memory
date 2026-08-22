import { LibraryColumnId } from "../../library-filter-popover";

export type SortDirection = "asc" | "desc";

export type LibrarySortColumn = LibraryColumnId;

export type LibrarySort = {
  column: LibrarySortColumn;
  direction: SortDirection;
};

export type LibraryColumnDef = {
  id: LibrarySortColumn;
  label: string;
};

export type LibraryFilterMenu = {
  column: LibrarySortColumn;
  left: number;
  top: number;
  trigger: HTMLButtonElement;
};
