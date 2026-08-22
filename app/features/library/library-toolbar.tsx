import { RefObject } from "react";

type LibraryToolbarProps = {
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
};

export function LibraryToolbar({ query, searchRef, onQueryChange }: LibraryToolbarProps) {
  return (
    <div className="sources-toolbar">
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search"
          aria-label="Search fragments"
        />
        <kbd>⌘ K</kbd>
      </label>
    </div>
  );
}
