import { RefObject } from "react";
import { MusicalRole } from "../../prototype-data";
import { LIBRARY_ROLES } from "./library-columns";

type LibraryToolbarProps = {
  query: string;
  roleFilters: MusicalRole[];
  filterCount: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onRoleFiltersChange: (roles: MusicalRole[]) => void;
  onClearFilters: () => void;
};

export function LibraryToolbar({
  query,
  roleFilters,
  filterCount,
  searchRef,
  onQueryChange,
  onRoleFiltersChange,
  onClearFilters,
}: LibraryToolbarProps) {
  return (
    <div className="toolbar">
      <div className="filter-row" aria-label="Quick filter by musical role">
        {LIBRARY_ROLES.map((role) => {
          const active = role === "All" ? roleFilters.length === 0 : roleFilters.includes(role);
          return (
            <button
              key={role}
              className={active ? "filter-active" : ""}
              aria-pressed={active}
              onClick={() =>
                onRoleFiltersChange(
                  role === "All"
                    ? []
                    : roleFilters.includes(role)
                      ? roleFilters.filter((item) => item !== role)
                      : [...roleFilters, role],
                )
              }
            >
              {role === "All" ? "All fragments" : role}
            </button>
          );
        })}
      </div>
      {filterCount > 0 && (
        <button
          className="filters-summary"
          onClick={onClearFilters}
          aria-label={`Clear ${filterCount} column filters`}
        >
          Filters {filterCount}
          <span>Clear</span>
        </button>
      )}
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
