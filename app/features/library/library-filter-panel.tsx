"use client";

import type { MusicalRole } from "@/lib/view/vocabulary";
import {
  LibraryFilters,
  RangeFilter,
  activeLibraryFilterCount,
  createLibraryFilters,
} from "../../library-filter-popover";
import { ModalTitlebar } from "@/lib/ui/modal-titlebar";
import { Button } from "@/lib/ui/button";
import { cn } from "@/lib/utils";

type LibraryFilterPanelProps = {
  filters: LibraryFilters;
  keyOptions: string[];
  tagOptions: string[];
  roleOptions: MusicalRole[];
  resultCount: number;
  totalCount: number;
  onChange: (filters: LibraryFilters) => void;
  onClose: () => void;
};

function PillGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <section className="library-filter-section" aria-label={label}>
      <h3>{label}</h3>
      <div className="library-filter-pills" role="group">
        {options.length === 0 ? (
          <p className="library-filter-empty">No values yet</p>
        ) : options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              className={cn("library-filter-pill", active && "library-filter-pill-active")}
              aria-pressed={active}
              onClick={() => onToggle(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function RangeFields({
  label,
  unit,
  filter,
  onChange,
  minPlaceholder = "Min",
  maxPlaceholder = "Max",
}: {
  label: string;
  unit?: string;
  filter: RangeFilter;
  onChange: (next: RangeFilter) => void;
  minPlaceholder?: string;
  maxPlaceholder?: string;
}) {
  return (
    <section className="library-filter-section" aria-label={label}>
      <h3>{label}{unit ? ` · ${unit}` : ""}</h3>
      <div className="library-filter-range">
        <label>
          <span className="sr-only">{label} minimum</span>
          <input
            type="number"
            inputMode="decimal"
            value={filter.min}
            placeholder={minPlaceholder}
            onChange={(event) => onChange({ ...filter, min: event.target.value })}
          />
        </label>
        <span aria-hidden="true">to</span>
        <label>
          <span className="sr-only">{label} maximum</span>
          <input
            type="number"
            inputMode="decimal"
            value={filter.max}
            placeholder={maxPlaceholder}
            onChange={(event) => onChange({ ...filter, max: event.target.value })}
          />
        </label>
      </div>
    </section>
  );
}

export function LibraryFilterPanel({
  filters,
  keyOptions,
  tagOptions,
  resultCount,
  totalCount,
  onChange,
  onClose,
}: LibraryFilterPanelProps) {
  const replace = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleMulti = (key: "key" | "tags" | "role", value: string) => {
    const current = filters[key] as string[];
    replace(
      key,
      (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]) as LibraryFilters[typeof key],
    );
  };

  const activeCount = activeLibraryFilterCount(filters);

  return (
    <aside className="source-editor library-filter-panel" aria-label="Library filters">
      <ModalTitlebar
        eyebrow="Filter"
        title="Narrow the library"
        onClose={onClose}
        closeLabel="Close filter panel"
      />

      <p className="library-filter-count" aria-live="polite">
        Showing <strong>{resultCount}</strong> of {totalCount}
      </p>

      <div className="library-filter-body">
        <PillGroup
          label="Key"
          options={keyOptions}
          selected={filters.key}
          onToggle={(value) => toggleMulti("key", value)}
        />
        {/* <PillGroup
          label="Role"
          options={roleOptions}
          selected={filters.role}
          onToggle={(value) => toggleMulti("role", value)}
        /> */}
        <PillGroup
          label="Tags"
          options={tagOptions}
          selected={filters.tags}
          onToggle={(value) => toggleMulti("tags", value)}
        />
        <RangeFields
          label="BPM"
          filter={filters.tempo}
          onChange={(tempo) => replace("tempo", tempo)}
          minPlaceholder="60"
          maxPlaceholder="140"
        />
        <RangeFields
          label="Length"
          unit="seconds"
          filter={filters.duration}
          onChange={(duration) => replace("duration", duration)}
          minPlaceholder="0"
          maxPlaceholder="60"
        />
        <RangeFields
          label="Affinities"
          unit="count"
          filter={filters.links}
          onChange={(links) => replace("links", links)}
          minPlaceholder="0"
          maxPlaceholder="10"
        />
      </div>

      <footer className="library-filter-footer">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={activeCount === 0}
          onClick={() => onChange(createLibraryFilters())}
        >
          Clear filters
        </Button>
      </footer>
    </aside>
  );
}
