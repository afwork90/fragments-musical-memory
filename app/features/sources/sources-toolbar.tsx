import { Button } from "@/lib/ui/button";

type SourcesToolbarProps = {
  importComplete: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onImportClick: () => void;
};

export function SourcesToolbar({ importComplete, query, onQueryChange, onImportClick }: SourcesToolbarProps) {
  return (
    <div className="sources-toolbar">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="library-card-action h-[30px]"
        onClick={onImportClick}
      >
        {importComplete ? "✓ Imported" : "＋ Import"}
      </Button>
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search"
          aria-label="Search sources"
        />
      </label>
    </div>
  );
}
